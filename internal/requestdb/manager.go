package requestdb

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	log "github.com/sirupsen/logrus"
)

const (
	// writeBufferSize bounds the pending-entry queue. Overflow drops entries
	// (counted and logged) instead of blocking the usage dispatcher, which is
	// shared with other consumers; 4096 entries is ample for burst absorption
	// while capping memory to a few MB.
	writeBufferSize = 4096
	// writeBatchLimit and writeFlushInterval trade insert throughput (one
	// transaction per batch) against visibility delay for queries.
	writeBatchLimit     = 256
	writeFlushInterval  = 100 * time.Millisecond
	retentionSweepEvery = time.Hour
	// defaultRetentionDays / defaultErrorBodyMaxBytes mirror the config defaults.
	defaultRetentionDays     = 0
	defaultErrorBodyMaxBytes = 8192
)

// Options is the resolved runtime configuration of the request database.
type Options struct {
	Enabled           bool
	Path              string
	RetentionDays     int // 0 keeps entries forever
	PreviewBytes      int // 0 stores no body previews
	ErrorBodyMaxBytes int
}

// manager owns the open store, the async writer and the retention loop.
type manager struct {
	store         *Store
	writer        *writer
	path          string
	retentionDays atomic.Int64 // 0 keeps entries forever
	stopRetention chan struct{}
	retentionDone chan struct{}
}

var (
	mu              sync.Mutex
	active          *manager
	cfgPreviewBytes atomic.Int64
	cfgErrorBodyMax atomic.Int64
)

// ApplyConfig resolves the request-db config section (default path under the
// auth dir) and applies it. Called at startup and on every config reload.
func ApplyConfig(cfg *config.Config) {
	if cfg == nil {
		return
	}
	opts := Options{
		Enabled:           cfg.RequestDBEnabled,
		RetentionDays:     cfg.RequestDBRetentionDays,
		PreviewBytes:      cfg.RequestDBPreviewBytes,
		ErrorBodyMaxBytes: cfg.RequestDBErrorBodyMaxBytes,
		Path:              strings.TrimSpace(cfg.RequestDBPath),
	}
	authDir, err := util.ResolveAuthDir(cfg.AuthDir)
	if err != nil {
		log.WithError(err).Warn("requestdb: failed to resolve auth dir; falling back to working directory")
		authDir = ""
	}
	if opts.Path == "" {
		opts.Path = filepath.Join(authDir, "requestlog.db")
	} else if !filepath.IsAbs(opts.Path) {
		opts.Path = filepath.Join(authDir, opts.Path)
	}
	SetConfig(opts)
}

// SetConfig applies new options, opening/closing/reopening the store as needed.
func SetConfig(opts Options) {
	cfgPreviewBytes.Store(int64(opts.PreviewBytes))
	if opts.ErrorBodyMaxBytes <= 0 {
		opts.ErrorBodyMaxBytes = defaultErrorBodyMaxBytes
	}
	cfgErrorBodyMax.Store(int64(opts.ErrorBodyMaxBytes))

	mu.Lock()
	defer mu.Unlock()
	if !opts.Enabled {
		closeActiveLocked()
		return
	}
	if active != nil && active.path == opts.Path {
		active.retentionDays.Store(int64(opts.RetentionDays))
		return
	}
	closeActiveLocked()
	mgr, err := newManager(opts)
	if err != nil {
		log.WithError(err).Errorf("requestdb: failed to open request database at %s; request-db stays disabled", opts.Path)
		return
	}
	active = mgr
}

// Shutdown flushes pending entries and closes the store. Safe to call repeatedly.
func Shutdown() {
	mu.Lock()
	defer mu.Unlock()
	closeActiveLocked()
}

// PreviewBytes reports the configured body preview limit; 0 when previews are
// disabled. The middleware uses this to decide whether to capture previews.
func PreviewBytes() int {
	if !enabled() {
		return 0
	}
	return int(cfgPreviewBytes.Load())
}

// Enabled reports whether the request database is currently open.
func Enabled() bool {
	return enabled()
}

func enabled() bool {
	mu.Lock()
	defer mu.Unlock()
	return active != nil
}

func closeActiveLocked() {
	if active == nil {
		return
	}
	active.close()
	active = nil
}

func newManager(opts Options) (*manager, error) {
	store, err := Open(opts.Path)
	if err != nil {
		return nil, err
	}
	mgr := &manager{
		store: store,
		path:  opts.Path,
	}
	mgr.retentionDays.Store(int64(opts.RetentionDays))
	mgr.writer = newWriter(store)
	mgr.startRetention()
	return mgr, nil
}

func (m *manager) close() {
	m.writer.close()
	if m.stopRetention != nil {
		close(m.stopRetention)
		<-m.retentionDone
	}
	if err := m.store.Close(); err != nil {
		log.WithError(err).Warn("requestdb: failed to close request database")
	}
}

func (m *manager) enqueue(entry Entry) {
	m.writer.enqueue(entry)
}

// startRetention launches the hourly sweep that deletes entries older than the
// configured retention window. It runs even when retention is currently
// disabled so a hot reload can enable it without reopening the store.
func (m *manager) startRetention() {
	m.stopRetention = make(chan struct{})
	m.retentionDone = make(chan struct{})
	go func() {
		defer close(m.retentionDone)
		m.sweepRetention()
		ticker := time.NewTicker(retentionSweepEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.sweepRetention()
			case <-m.stopRetention:
				return
			}
		}
	}()
}

func (m *manager) sweepRetention() {
	retentionDays := m.retentionDays.Load()
	if retentionDays <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).UnixMilli()
	deleted, err := m.store.DeleteBefore(context.Background(), cutoff)
	if err != nil {
		if !errors.Is(err, ErrDisabled) {
			log.WithError(err).Warn("requestdb: retention sweep failed")
		}
		return
	}
	if deleted > 0 {
		log.WithField("deleted", deleted).Infof("requestdb: retention removed entries older than %d days", retentionDays)
	}
}

// QueryEntries returns a page of entries plus the total match count.
func QueryEntries(ctx context.Context, q Query) ([]Entry, int64, error) {
	mu.Lock()
	mgr := active
	mu.Unlock()
	if mgr == nil {
		return nil, 0, ErrDisabled
	}
	total, err := mgr.store.Count(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	entries, err := mgr.store.Query(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	return entries, total, nil
}

// GetEntryDetail returns one entry with decompressed blobs; nil when not found.
func GetEntryDetail(ctx context.Context, id int64) (*Entry, error) {
	mu.Lock()
	mgr := active
	mu.Unlock()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.GetByID(ctx, id)
}

// CleanOptions configures a maintenance or cleanup operation.
type CleanOptions struct {
	Action       string `json:"action"` // "delete_before", "delete_failed", "strip_payloads", "cap_size", "clear_all", "vacuum"
	BeforeDays   int    `json:"before_days,omitempty"`
	BeforeMS     int64  `json:"before_ms,omitempty"`
	TargetSizeMB int64  `json:"target_size_mb,omitempty"`
	Vacuum       bool   `json:"vacuum,omitempty"`
}

// CleanResult reports the outcome of a cleanup operation.
type CleanResult struct {
	Action              string `json:"action"`
	AffectedRows        int64  `json:"affected_rows"`
	VacuumRun           bool   `json:"vacuum_run"`
	FileSizeBytesBefore int64  `json:"file_size_bytes_before"`
	FileSizeBytesAfter  int64  `json:"file_size_bytes_after"`
}

// GetStorageInfo returns disk and row usage statistics of the request database.
func GetStorageInfo(ctx context.Context) (*StorageInfo, error) {
	mu.Lock()
	mgr := active
	mu.Unlock()
	if mgr == nil {
		return nil, ErrDisabled
	}
	return mgr.store.StorageInfo(ctx, mgr.path, mgr.retentionDays.Load())
}

// Clean performs a storage maintenance/cleanup operation.
func Clean(ctx context.Context, opts CleanOptions) (*CleanResult, error) {
	mu.Lock()
	mgr := active
	mu.Unlock()
	if mgr == nil {
		return nil, ErrDisabled
	}

	infoBefore, err := mgr.store.StorageInfo(ctx, mgr.path, mgr.retentionDays.Load())
	var sizeBefore int64
	if err == nil && infoBefore != nil {
		sizeBefore = infoBefore.TotalFileSizeBytes
	}

	var cutoffMS int64
	if opts.BeforeDays > 0 {
		cutoffMS = time.Now().Add(-time.Duration(opts.BeforeDays) * 24 * time.Hour).UnixMilli()
	} else if opts.BeforeMS > 0 {
		cutoffMS = opts.BeforeMS
	}

	var affected int64
	var errClean error

	switch opts.Action {
	case "delete_before":
		affected, errClean = mgr.store.DeleteBefore(ctx, cutoffMS)
	case "delete_failed":
		affected, errClean = mgr.store.DeleteFailed(ctx, cutoffMS)
	case "strip_payloads":
		affected, errClean = mgr.store.StripPayloads(ctx, cutoffMS)
	case "cap_size":
		targetBytes := opts.TargetSizeMB * 1024 * 1024
		affected, errClean = mgr.store.PruneToSize(ctx, targetBytes, sizeBefore)
	case "clear_all":
		affected, errClean = mgr.store.ClearAll(ctx)
	case "vacuum":
		// Only vacuum
		affected = 0
	default:
		return nil, fmt.Errorf("requestdb: unknown clean action: %s", opts.Action)
	}

	if errClean != nil {
		return nil, errClean
	}

	vacuumRun := false
	if opts.Vacuum || opts.Action == "vacuum" {
		if errVac := mgr.store.Vacuum(ctx); errVac != nil {
			log.WithError(errVac).Warn("requestdb: vacuum after cleanup failed")
		} else {
			vacuumRun = true
		}
	}

	infoAfter, err := mgr.store.StorageInfo(ctx, mgr.path, mgr.retentionDays.Load())
	var sizeAfter int64
	if err == nil && infoAfter != nil {
		sizeAfter = infoAfter.TotalFileSizeBytes
	}

	return &CleanResult{
		Action:              opts.Action,
		AffectedRows:        affected,
		VacuumRun:           vacuumRun,
		FileSizeBytesBefore: sizeBefore,
		FileSizeBytesAfter:  sizeAfter,
	}, nil
}

// writer batches entries and inserts them in background transactions.
type writer struct {
	store   *Store
	ch      chan Entry
	stop    chan struct{}
	done    chan struct{}
	dropped atomic.Int64
}

func newWriter(store *Store) *writer {
	w := &writer{
		store: store,
		ch:    make(chan Entry, writeBufferSize),
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
	}
	go w.run()
	return w
}

// enqueue stores an entry without ever blocking the caller; overflow is dropped.
func (w *writer) enqueue(entry Entry) {
	select {
	case w.ch <- entry:
	default:
		dropped := w.dropped.Add(1)
		if dropped == 1 || dropped%1000 == 0 {
			log.WithField("dropped_total", dropped).Warn("requestdb: write buffer full, dropping request log entries")
		}
	}
}

func (w *writer) close() {
	close(w.stop)
	<-w.done
}

func (w *writer) run() {
	defer close(w.done)
	ticker := time.NewTicker(writeFlushInterval)
	defer ticker.Stop()
	batch := make([]Entry, 0, writeBatchLimit)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		w.insertBatch(batch)
		batch = batch[:0]
	}
	for {
		select {
		case entry := <-w.ch:
			batch = append(batch, entry)
			if len(batch) >= writeBatchLimit {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-w.stop:
			// Drain whatever is buffered so a graceful shutdown loses nothing.
			for {
				select {
				case entry := <-w.ch:
					batch = append(batch, entry)
					if len(batch) >= writeBatchLimit {
						flush()
					}
				default:
					flush()
					return
				}
			}
		}
	}
}

// insertBatch compresses blob payloads (off the usage dispatcher goroutine) and
// writes the batch in a single transaction.
func (w *writer) insertBatch(batch []Entry) {
	compressed := make([]Entry, len(batch))
	for i := range batch {
		compressed[i] = batch[i]
		compressed[i].TokenBreakdown = compressBlob(batch[i].TokenBreakdown)
		compressed[i].TimingBreakdown = compressBlob(batch[i].TimingBreakdown)
		compressed[i].RequestHeaders = compressBlob(batch[i].RequestHeaders)
		compressed[i].ResponseHeaders = compressBlob(batch[i].ResponseHeaders)
		compressed[i].ErrorBody = compressBlob(batch[i].ErrorBody)
		compressed[i].RequestPreview = compressBlob(batch[i].RequestPreview)
		compressed[i].ResponsePreview = compressBlob(batch[i].ResponsePreview)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := w.store.InsertBatch(ctx, compressed); err != nil {
		if errors.Is(err, ErrDisabled) {
			return
		}
		log.WithError(err).WithField("entries", len(compressed)).Error("requestdb: failed to insert request log batch")
		return
	}
	for i := range compressed {
		batch[i].ID = compressed[i].ID
		publishStreamEntry(&batch[i])
	}
}
