package requestdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

// ErrDisabled is returned by query helpers when the request database is not enabled.
var ErrDisabled = errors.New("requestdb: request database is disabled")

// Entry is one stored request record. Blob fields carry zstd-compressed JSON
// (headers, token breakdown) or raw truncated bytes (error body, previews) and
// are only populated by detail reads; list queries leave them nil.
type Entry struct {
	ID int64

	// RequestedAtMS is the request timestamp in unix milliseconds.
	RequestedAtMS int64

	RequestID                string
	TraceID                  string
	Endpoint                 string
	ClientIP                 string
	ResolvedClientIP         string
	XForwardedFor            string
	UserAgent                string
	SessionID                string
	ParentSessionID          string
	APIKey                   string
	AccessProvider           string
	IsNativeKey              bool
	Provider                 string
	ProviderName             string
	ExecutorType             string
	AuthID                   string
	AuthIndex                string
	AuthType                 string
	Source                   string
	BaseURL                  string
	Model                    string
	Alias                    string
	ResponseModel            string
	ReasoningEffort          string
	RequestedReasoningEffort string
	ServiceTier              string
	EffectiveServiceTier     string
	ResponseServiceTier      string
	Generate                 bool
	Stream                   bool
	Failed                   bool
	StatusCode               int
	LatencyMS                int64
	TTFTMS                   int64

	InputTokens         int64
	OutputTokens        int64
	ReasoningTokens     int64
	CachedTokens        int64
	CacheReadTokens     int64
	CacheCreationTokens int64
	TotalTokens         int64

	TokenBreakdown  []byte
	RequestHeaders  []byte
	ResponseHeaders []byte
	ErrorBody       []byte
	RequestPreview  []byte
	ResponsePreview []byte
}

// Query selects stored entries. Zero time bounds and empty filters match everything.
// BeforeID enables keyset pagination ("load older"): rows with id < BeforeID only.
type Query struct {
	FromMS    int64
	ToMS      int64
	Model     string
	Models    []string
	APIKey    string
	APIKeys   []string
	Provider  string
	Providers []string
	// ProviderMatchKeys holds extra exact provider instance keys matched by live
	// config resolution for a free-text Provider filter (e.g. searching a newly
	// assigned provider name against historical rows that predate provider_name).
	ProviderMatchKeys []string
	SessionID         string
	RequestID         string
	TraceID           string
	Failed            *bool
	StatusCode        int
	BeforeID          int64
	Limit             int
	Offset            int
}

// Store wraps the SQLite handle. Writes are funneled through a single writer
// goroutine (SQLite single-writer model); reads may use pooled connections
// thanks to WAL mode.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database file and migrates the schema.
func Open(path string) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("requestdb: open database: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("requestdb: ping database: %w", err)
	}
	if err := migrate(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close closes the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

const insertColumns = `requested_at, request_id, trace_id, endpoint, client_ip, resolved_client_ip, x_forwarded_for, user_agent,
	session_id, parent_session_id, api_key, access_provider, is_native_key,
	provider, provider_name, executor_type, auth_id, auth_index, auth_type, source, base_url,
	model, alias, response_model, reasoning_effort, requested_reasoning_effort,
	service_tier, effective_service_tier, response_service_tier,
	generate, stream, failed, status_code, latency_ms, ttft_ms,
	input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
	token_breakdown_zst, request_headers_zst, response_headers_zst, error_body_zst, request_preview_zst, response_preview_zst`

// InsertBatch stores entries in one transaction. Compressed blob fields are
// expected to be already compressed by the writer goroutine.
func (s *Store) InsertBatch(ctx context.Context, entries []Entry) error {
	if s == nil || s.db == nil {
		return ErrDisabled
	}
	if len(entries) == 0 {
		return nil
	}
	placeholders := "(" + strings.TrimSuffix(strings.Repeat("?,", 48), ",") + ")"
	stmtText := "INSERT INTO request_logs (" + insertColumns + ") VALUES " + placeholders
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("requestdb: begin insert transaction: %w", err)
	}
	stmt, err := tx.PrepareContext(ctx, stmtText)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("requestdb: prepare insert: %w", err)
	}
	for i := range entries {
		e := &entries[i]
		res, errExec := stmt.ExecContext(ctx,
			e.RequestedAtMS, e.RequestID, e.TraceID, e.Endpoint, e.ClientIP, e.ResolvedClientIP, e.XForwardedFor, e.UserAgent,
			e.SessionID, e.ParentSessionID, e.APIKey, e.AccessProvider, boolToInt(e.IsNativeKey),
			e.Provider, e.ProviderName, e.ExecutorType, e.AuthID, e.AuthIndex, e.AuthType, e.Source, e.BaseURL,
			e.Model, e.Alias, e.ResponseModel, e.ReasoningEffort, e.RequestedReasoningEffort,
			e.ServiceTier, e.EffectiveServiceTier, e.ResponseServiceTier,
			boolToInt(e.Generate), boolToInt(e.Stream), boolToInt(e.Failed), e.StatusCode, e.LatencyMS, e.TTFTMS,
			e.InputTokens, e.OutputTokens, e.ReasoningTokens, e.CachedTokens, e.CacheReadTokens, e.CacheCreationTokens, e.TotalTokens,
			nullableBytes(e.TokenBreakdown), nullableBytes(e.RequestHeaders), nullableBytes(e.ResponseHeaders),
			nullableBytes(e.ErrorBody), nullableBytes(e.RequestPreview), nullableBytes(e.ResponsePreview),
		)
		if errExec != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			return fmt.Errorf("requestdb: insert entry: %w", errExec)
		}
		if id, errID := res.LastInsertId(); errID == nil && id > 0 {
			e.ID = id
		}
	}
	if errClose := stmt.Close(); errClose != nil {
		_ = tx.Rollback()
		return fmt.Errorf("requestdb: close insert statement: %w", errClose)
	}
	if errCommit := tx.Commit(); errCommit != nil {
		return fmt.Errorf("requestdb: commit insert: %w", errCommit)
	}
	return nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func nullableBytes(payload []byte) any {
	if len(payload) == 0 {
		return nil
	}
	return payload
}

// DeleteBefore removes entries older than cutoffMS and returns the row count.
func (s *Store) DeleteBefore(ctx context.Context, cutoffMS int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM request_logs WHERE requested_at < ?`, cutoffMS)
	if err != nil {
		return 0, fmt.Errorf("requestdb: delete expired entries: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("requestdb: read delete count: %w", err)
	}
	return deleted, nil
}

// StorageInfo summarizes the disk and row usage of the request database.
type StorageInfo struct {
	Enabled                    bool    `json:"enabled"`
	Path                       string  `json:"path"`
	RetentionDays              int64   `json:"retention_days"`
	TotalRecords               int64   `json:"total_records"`
	FailedRecords              int64   `json:"failed_records"`
	PayloadRecords             int64   `json:"payload_records"`
	EarliestRecordMS           int64   `json:"earliest_record_ms"`
	LatestRecordMS             int64   `json:"latest_record_ms"`
	FileSizeBytes              int64   `json:"file_size_bytes"`
	WALSizeBytes               int64   `json:"wal_size_bytes"`
	TotalFileSizeBytes         int64   `json:"total_file_size_bytes"`
	CompressedPayloadBytes     int64   `json:"compressed_payload_bytes"`
	EstimatedUncompressedBytes int64   `json:"estimated_uncompressed_bytes"`
	CompressionRatio           float64 `json:"compression_ratio"`
}

// StorageInfo computes storage statistics including disk file size, compressed payload bytes,
// and estimated uncompressed theoretical size.
func (s *Store) StorageInfo(ctx context.Context, dbPath string, retentionDays int64) (*StorageInfo, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	info := &StorageInfo{
		Enabled:       true,
		Path:          dbPath,
		RetentionDays: retentionDays,
	}

	if fi, err := os.Stat(dbPath); err == nil {
		info.FileSizeBytes = fi.Size()
	}
	if fi, err := os.Stat(dbPath + "-wal"); err == nil {
		info.WALSizeBytes = fi.Size()
	}
	info.TotalFileSizeBytes = info.FileSizeBytes + info.WALSizeBytes

	row := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN token_breakdown_zst IS NOT NULL OR request_headers_zst IS NOT NULL OR response_headers_zst IS NOT NULL OR error_body_zst IS NOT NULL OR request_preview_zst IS NOT NULL OR response_preview_zst IS NOT NULL THEN 1 ELSE 0 END), 0),
			COALESCE(MIN(requested_at), 0),
			COALESCE(MAX(requested_at), 0),
			COALESCE(SUM(LENGTH(COALESCE(token_breakdown_zst, '')) + LENGTH(COALESCE(request_headers_zst, '')) + LENGTH(COALESCE(response_headers_zst, '')) + LENGTH(COALESCE(error_body_zst, '')) + LENGTH(COALESCE(request_preview_zst, '')) + LENGTH(COALESCE(response_preview_zst, ''))), 0)
		FROM request_logs
	`)
	if err := row.Scan(
		&info.TotalRecords,
		&info.FailedRecords,
		&info.PayloadRecords,
		&info.EarliestRecordMS,
		&info.LatestRecordMS,
		&info.CompressedPayloadBytes,
	); err != nil {
		return nil, fmt.Errorf("requestdb: query storage metrics: %w", err)
	}

	// Sample up to 25 rows with non-empty payloads to compute empirical compression ratio
	ratio := 3.5
	if info.PayloadRecords > 0 {
		rows, err := s.db.QueryContext(ctx, `
			SELECT token_breakdown_zst, request_headers_zst, response_headers_zst, error_body_zst, request_preview_zst, response_preview_zst
			FROM request_logs
			WHERE request_headers_zst IS NOT NULL OR token_breakdown_zst IS NOT NULL OR error_body_zst IS NOT NULL
			LIMIT 25
		`)
		if err == nil {
			var sampleCompressed int64
			var sampleUncompressed int64
			for rows.Next() {
				var tb, reqH, respH, errB, reqP, respP []byte
				if errScan := rows.Scan(&tb, &reqH, &respH, &errB, &reqP, &respP); errScan == nil {
					for _, b := range [][]byte{tb, reqH, respH, errB, reqP, respP} {
						if len(b) > 0 {
							sampleCompressed += int64(len(b))
							raw, errDecomp := decompressBlob(b)
							if errDecomp == nil && len(raw) > 0 {
								sampleUncompressed += int64(len(raw))
							} else {
								sampleUncompressed += int64(len(b)) * 3
							}
						}
					}
				}
			}
			_ = rows.Close()
			if sampleCompressed > 0 && sampleUncompressed > 0 {
				ratio = float64(sampleUncompressed) / float64(sampleCompressed)
			}
		}
	}
	info.CompressionRatio = ratio
	info.EstimatedUncompressedBytes = int64(float64(info.CompressedPayloadBytes)*ratio) + info.TotalRecords*320
	if info.EstimatedUncompressedBytes < info.TotalFileSizeBytes && info.TotalRecords > 0 {
		info.EstimatedUncompressedBytes = int64(float64(info.TotalFileSizeBytes) * 1.5)
	}
	return info, nil
}

// DeleteFailed removes failed entries (optionally older than cutoffMS if cutoffMS > 0).
func (s *Store) DeleteFailed(ctx context.Context, cutoffMS int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	query := "DELETE FROM request_logs WHERE failed = 1"
	var args []any
	if cutoffMS > 0 {
		query += " AND requested_at < ?"
		args = append(args, cutoffMS)
	}
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("requestdb: delete failed entries: %w", err)
	}
	return res.RowsAffected()
}

// StripPayloads clears large blob columns (headers, previews, error body, token breakdown)
// for records older than cutoffMS, preserving metadata and token counts for long-term analytics.
func (s *Store) StripPayloads(ctx context.Context, cutoffMS int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	query := `UPDATE request_logs
		SET token_breakdown_zst = NULL,
		    request_headers_zst = NULL,
		    response_headers_zst = NULL,
		    error_body_zst = NULL,
		    request_preview_zst = NULL,
		    response_preview_zst = NULL
		WHERE (token_breakdown_zst IS NOT NULL
		    OR request_headers_zst IS NOT NULL
		    OR response_headers_zst IS NOT NULL
		    OR error_body_zst IS NOT NULL
		    OR request_preview_zst IS NOT NULL
		    OR response_preview_zst IS NOT NULL)`
	var args []any
	if cutoffMS > 0 {
		query += " AND requested_at < ?"
		args = append(args, cutoffMS)
	}
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("requestdb: strip payloads: %w", err)
	}
	return res.RowsAffected()
}

// ClearAll deletes all request records from request_logs.
func (s *Store) ClearAll(ctx context.Context) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	res, err := s.db.ExecContext(ctx, "DELETE FROM request_logs")
	if err != nil {
		return 0, fmt.Errorf("requestdb: clear all: %w", err)
	}
	return res.RowsAffected()
}

// PruneToSize deletes oldest records to bring total file size down towards targetBytes.
func (s *Store) PruneToSize(ctx context.Context, targetBytes int64, currentBytes int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	if currentBytes <= targetBytes || targetBytes <= 0 {
		return 0, nil
	}
	var totalRows int64
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM request_logs").Scan(&totalRows); err != nil {
		return 0, fmt.Errorf("requestdb: prune count: %w", err)
	}
	if totalRows == 0 {
		return 0, nil
	}
	excess := currentBytes - targetBytes
	avgPerRow := currentBytes / totalRows
	if avgPerRow <= 0 {
		avgPerRow = 512
	}
	rowsToDelete := (excess / avgPerRow) * 115 / 100
	if rowsToDelete < 1 {
		rowsToDelete = 1
	}
	if rowsToDelete >= totalRows {
		return s.ClearAll(ctx)
	}

	var cutoffID int64
	err := s.db.QueryRowContext(ctx, "SELECT id FROM request_logs ORDER BY requested_at ASC, id ASC LIMIT 1 OFFSET ?", rowsToDelete-1).Scan(&cutoffID)
	if err != nil {
		return 0, fmt.Errorf("requestdb: prune find cutoff: %w", err)
	}

	res, err := s.db.ExecContext(ctx, "DELETE FROM request_logs WHERE id <= ?", cutoffID)
	if err != nil {
		return 0, fmt.Errorf("requestdb: prune delete: %w", err)
	}
	return res.RowsAffected()
}

// Vacuum checkpoints WAL and vacuums the SQLite database to reclaim free disk space.
func (s *Store) Vacuum(ctx context.Context) error {
	if s == nil || s.db == nil {
		return ErrDisabled
	}
	_, _ = s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	if _, err := s.db.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("requestdb: vacuum: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	return nil
}

// Count returns the number of entries matching q.
func (s *Store) Count(ctx context.Context, q Query) (int64, error) {
	if s == nil || s.db == nil {
		return 0, ErrDisabled
	}
	where, args := buildWhere(q)
	var total int64
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM request_logs"+where, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("requestdb: count entries: %w", err)
	}
	return total, nil
}

// Query returns a page of entries ordered newest-first, without blob columns.
func (s *Store) Query(ctx context.Context, q Query) ([]Entry, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	where, args := buildWhere(q)
	stmt := `SELECT id, requested_at, request_id, trace_id, endpoint, client_ip, resolved_client_ip, x_forwarded_for, user_agent,
		session_id, parent_session_id, api_key, access_provider, is_native_key,
		provider, provider_name, executor_type, auth_id, auth_index, auth_type, source, base_url,
		model, alias, response_model, reasoning_effort, requested_reasoning_effort,
		service_tier, effective_service_tier, response_service_tier,
		generate, stream, failed, status_code, latency_ms, ttft_ms,
		input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens
		FROM request_logs` + where + ` ORDER BY id DESC`
	// Limit <= 0 means unlimited; otherwise a paged window.
	if q.Limit > 0 {
		stmt += ` LIMIT ? OFFSET ?`
		args = append(args, q.Limit, q.Offset)
	}
	rows, err := s.db.QueryContext(ctx, stmt, args...)
	if err != nil {
		return nil, fmt.Errorf("requestdb: query entries: %w", err)
	}
	defer func() {
		if errClose := rows.Close(); errClose != nil {
			// best-effort; read errors surface via rows.Err below
			_ = errClose
		}
	}()
	var out []Entry
	for rows.Next() {
		var e Entry
		var isNativeKey, generate, stream, failed int
		if errScan := rows.Scan(&e.ID, &e.RequestedAtMS, &e.RequestID, &e.TraceID, &e.Endpoint, &e.ClientIP, &e.ResolvedClientIP, &e.XForwardedFor, &e.UserAgent,
			&e.SessionID, &e.ParentSessionID, &e.APIKey, &e.AccessProvider, &isNativeKey,
			&e.Provider, &e.ProviderName, &e.ExecutorType, &e.AuthID, &e.AuthIndex, &e.AuthType, &e.Source, &e.BaseURL,
			&e.Model, &e.Alias, &e.ResponseModel, &e.ReasoningEffort, &e.RequestedReasoningEffort,
			&e.ServiceTier, &e.EffectiveServiceTier, &e.ResponseServiceTier,
			&generate, &stream, &failed, &e.StatusCode, &e.LatencyMS, &e.TTFTMS,
			&e.InputTokens, &e.OutputTokens, &e.ReasoningTokens, &e.CachedTokens, &e.CacheReadTokens, &e.CacheCreationTokens, &e.TotalTokens,
		); errScan != nil {
			return nil, fmt.Errorf("requestdb: scan entry: %w", errScan)
		}
		e.IsNativeKey = isNativeKey != 0
		e.Generate = generate != 0
		e.Stream = stream != 0
		e.Failed = failed != 0
		out = append(out, e)
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("requestdb: iterate entries: %w", errRows)
	}
	return out, nil
}

// GetByID returns one entry with all blob fields decompressed.
func (s *Store) GetByID(ctx context.Context, id int64) (*Entry, error) {
	if s == nil || s.db == nil {
		return nil, ErrDisabled
	}
	stmt := `SELECT id, requested_at, request_id, trace_id, endpoint, client_ip, resolved_client_ip, x_forwarded_for, user_agent,
		session_id, parent_session_id, api_key, access_provider, is_native_key,
		provider, provider_name, executor_type, auth_id, auth_index, auth_type, source, base_url,
		model, alias, response_model, reasoning_effort, requested_reasoning_effort,
		service_tier, effective_service_tier, response_service_tier,
		generate, stream, failed, status_code, latency_ms, ttft_ms,
		input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
		token_breakdown_zst, request_headers_zst, response_headers_zst, error_body_zst, request_preview_zst, response_preview_zst
		FROM request_logs WHERE id = ?`
	var e Entry
	var isNativeKey, generate, stream, failed int
	var tokenBreakdown, requestHeaders, responseHeaders, errorBody, requestPreview, responsePreview []byte
	err := s.db.QueryRowContext(ctx, stmt, id).Scan(&e.ID, &e.RequestedAtMS, &e.RequestID, &e.TraceID, &e.Endpoint, &e.ClientIP, &e.ResolvedClientIP, &e.XForwardedFor, &e.UserAgent,
		&e.SessionID, &e.ParentSessionID, &e.APIKey, &e.AccessProvider, &isNativeKey,
		&e.Provider, &e.ProviderName, &e.ExecutorType, &e.AuthID, &e.AuthIndex, &e.AuthType, &e.Source, &e.BaseURL,
		&e.Model, &e.Alias, &e.ResponseModel, &e.ReasoningEffort, &e.RequestedReasoningEffort,
		&e.ServiceTier, &e.EffectiveServiceTier, &e.ResponseServiceTier,
		&generate, &stream, &failed, &e.StatusCode, &e.LatencyMS, &e.TTFTMS,
		&e.InputTokens, &e.OutputTokens, &e.ReasoningTokens, &e.CachedTokens, &e.CacheReadTokens, &e.CacheCreationTokens, &e.TotalTokens,
		&tokenBreakdown, &requestHeaders, &responseHeaders, &errorBody, &requestPreview, &responsePreview,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("requestdb: get entry: %w", err)
	}
	e.IsNativeKey = isNativeKey != 0
	e.Generate = generate != 0
	e.Stream = stream != 0
	e.Failed = failed != 0
	if e.TokenBreakdown, err = decompressBlob(tokenBreakdown); err != nil {
		return nil, fmt.Errorf("requestdb: decompress token breakdown: %w", err)
	}
	if e.RequestHeaders, err = decompressBlob(requestHeaders); err != nil {
		return nil, fmt.Errorf("requestdb: decompress request headers: %w", err)
	}
	if e.ResponseHeaders, err = decompressBlob(responseHeaders); err != nil {
		return nil, fmt.Errorf("requestdb: decompress response headers: %w", err)
	}
	if e.ErrorBody, err = decompressBlob(errorBody); err != nil {
		return nil, fmt.Errorf("requestdb: decompress error body: %w", err)
	}
	if e.RequestPreview, err = decompressBlob(requestPreview); err != nil {
		return nil, fmt.Errorf("requestdb: decompress request preview: %w", err)
	}
	if e.ResponsePreview, err = decompressBlob(responsePreview); err != nil {
		return nil, fmt.Errorf("requestdb: decompress response preview: %w", err)
	}
	return &e, nil
}

func buildWhere(q Query) (string, []any) {
	var clauses []string
	var args []any
	if q.FromMS > 0 {
		clauses = append(clauses, "requested_at >= ?")
		args = append(args, q.FromMS)
	}
	if q.ToMS > 0 {
		clauses = append(clauses, "requested_at <= ?")
		args = append(args, q.ToMS)
	}
	// Multi-select list takes precedence; otherwise fallback to single text filter matching by substring.
	if len(q.Models) > 0 {
		placeholders := make([]string, len(q.Models))
		for i, m := range q.Models {
			placeholders[i] = "?"
			args = append(args, m)
		}
		clauses = append(clauses, "model IN ("+strings.Join(placeholders, ",")+")")
	} else if q.Model != "" {
		clauses = append(clauses, "model LIKE ? ESCAPE '\\'")
		args = append(args, likeSubstring(q.Model))
	}
	if len(q.APIKeys) > 0 {
		placeholders := make([]string, len(q.APIKeys))
		for i, k := range q.APIKeys {
			placeholders[i] = "?"
			args = append(args, k)
		}
		clauses = append(clauses, "api_key IN ("+strings.Join(placeholders, ",")+")")
	} else if q.APIKey != "" {
		clauses = append(clauses, "api_key LIKE ? ESCAPE '\\'")
		args = append(args, likeSubstring(q.APIKey))
	}
	if len(q.Providers) > 0 {
		subClauses := make([]string, 0, len(q.Providers))
		for _, p := range q.Providers {
			clause, pArgs := providerFilterSQL(p)
			subClauses = append(subClauses, clause)
			args = append(args, pArgs...)
		}
		clauses = append(clauses, "("+strings.Join(subClauses, " OR ")+")")
	} else if q.Provider != "" {
		if IsStructuredProviderKey(q.Provider) {
			clause, pArgs := providerFilterSQL(q.Provider)
			clauses = append(clauses, clause)
			args = append(args, pArgs...)
		} else {
			pattern := likeSubstring(q.Provider)
			subClauses := []string{
				"provider LIKE ? ESCAPE '\\'",
				"provider_name LIKE ? ESCAPE '\\'",
				"auth_id LIKE ? ESCAPE '\\'",
				"auth_type LIKE ? ESCAPE '\\'",
				"base_url LIKE ? ESCAPE '\\'",
				"(LOWER(auth_type) = 'oauth' AND source != '' AND source != api_key AND source LIKE ? ESCAPE '\\')",
			}
			args = append(args, pattern, pattern, pattern, pattern, pattern, pattern)
			for _, key := range q.ProviderMatchKeys {
				clause, pArgs := providerFilterSQL(key)
				subClauses = append(subClauses, clause)
				args = append(args, pArgs...)
			}
			clauses = append(clauses, "("+strings.Join(subClauses, " OR ")+")")
		}
	}
	if q.SessionID != "" {
		clauses = append(clauses, "session_id LIKE ? ESCAPE '\\'")
		args = append(args, likeSubstring(q.SessionID))
	}
	if q.RequestID != "" {
		clauses = append(clauses, "request_id LIKE ? ESCAPE '\\'")
		args = append(args, likeSubstring(q.RequestID))
	}
	if q.TraceID != "" {
		clauses = append(clauses, "trace_id LIKE ? ESCAPE '\\'")
		args = append(args, likeSubstring(q.TraceID))
	}
	if q.BeforeID > 0 {
		clauses = append(clauses, "id < ?")
		args = append(args, q.BeforeID)
	}
	if q.Failed != nil {
		clauses = append(clauses, "failed = ?")
		args = append(args, boolToInt(*q.Failed))
	}
	if q.StatusCode > 0 {
		clauses = append(clauses, "status_code = ?")
		args = append(args, q.StatusCode)
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// likeSubstring wraps value with LIKE wildcards, escaping the wildcard and
// escape characters so user input matches literally.
func likeSubstring(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `%`, `\%`)
	escaped = strings.ReplaceAll(escaped, `_`, `\_`)
	return "%" + escaped + "%"
}
