// Package codexversion resolves and caches the latest public Codex CLI release.
package codexversion

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MoeForge/moego/json"
	"github.com/MoeForge/moego/regexp"
	log "github.com/sirupsen/logrus"
)

const (
	// RefreshInterval is the periodic interval used to poll GitHub's public releases API.
	RefreshInterval = 6 * time.Hour
	// FetchTimeout bounds one metadata lookup so a stuck GitHub connection cannot block future refreshes.
	FetchTimeout = 10 * time.Second
)

const defaultGitHubLatestReleaseURL = "https://api.github.com/repos/openai/codex/releases/latest"

var releaseVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`)

type cachedRelease struct {
	Version string `json:"version"`
	ETag    string `json:"etag,omitempty"`
}

type releaseResponse struct {
	TagName string `json:"tag_name"`
}

type releaseFetchResult struct {
	version     string
	etag        string
	notModified bool
}

var latestReleaseState = struct {
	sync.RWMutex
	version     string
	etag        string
	cachePath   string
	cacheLoaded bool
	proxyURL    string
	apiURL      string
	updaterOn   bool
	cancel      context.CancelFunc
	parentDone  <-chan struct{}
	generation  uint64
	refreshed   chan struct{}
}{
	apiURL: defaultGitHubLatestReleaseURL,
}

// ResolveLatest returns the cached GitHub latest release version, or fallback
// when no release has been fetched yet or the persistent cache is unavailable.
func ResolveLatest(fallback string) string {
	ensureCacheLoaded()
	latestReleaseState.RLock()
	version := latestReleaseState.version
	latestReleaseState.RUnlock()
	if version != "" {
		return version
	}
	return strings.TrimSpace(fallback)
}

// ConfigureLatestVersionUpdater controls the optional periodic GitHub release updater.
// Calls with the same enabled state and proxy are idempotent, so hot configuration
// reloads do not cause an immediate extra GitHub request.
func ConfigureLatestVersionUpdater(ctx context.Context, proxyURL string, enabled bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	proxyURL = strings.TrimSpace(proxyURL)

	latestReleaseState.Lock()
	if !enabled {
		if latestReleaseState.cancel != nil {
			latestReleaseState.cancel()
		}
		latestReleaseState.cancel = nil
		latestReleaseState.updaterOn = false
		latestReleaseState.proxyURL = ""
		latestReleaseState.Unlock()
		return
	}
	if latestReleaseState.updaterOn && latestReleaseState.cancel != nil && latestReleaseState.proxyURL == proxyURL && latestReleaseState.parentDone == ctx.Done() {
		latestReleaseState.Unlock()
		return
	}
	if latestReleaseState.cancel != nil {
		latestReleaseState.cancel()
	}
	runCtx, cancel := context.WithCancel(ctx)
	latestReleaseState.cancel = cancel
	latestReleaseState.parentDone = ctx.Done()
	latestReleaseState.updaterOn = true
	latestReleaseState.proxyURL = proxyURL
	latestReleaseState.generation++
	generation := latestReleaseState.generation
	latestReleaseState.Unlock()

	go runLatestVersionUpdater(runCtx, generation)
}

func runLatestVersionUpdater(ctx context.Context, generation uint64) {
	defer func() {
		latestReleaseState.Lock()
		if latestReleaseState.generation == generation {
			latestReleaseState.cancel = nil
			latestReleaseState.updaterOn = false
		}
		latestReleaseState.Unlock()
	}()

	refreshLatestVersion(ctx)

	ticker := time.NewTicker(RefreshInterval)
	defer ticker.Stop()
	log.Infof("periodic Codex client version refresh started (interval=%s)", RefreshInterval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refreshLatestVersion(ctx)
		}
	}
}

func refreshLatestVersion(ctx context.Context) {
	defer notifyLatestVersionRefreshed()
	ensureCacheLoaded()

	latestReleaseState.RLock()
	etag := latestReleaseState.etag
	proxyURL := latestReleaseState.proxyURL
	apiURL := latestReleaseState.apiURL
	latestReleaseState.RUnlock()

	result, errFetch := fetchLatestRelease(ctx, versionHTTPClient(proxyURL), apiURL, etag)
	if errFetch != nil {
		if ctx.Err() == nil {
			log.WithError(errFetch).Warn("failed to fetch latest Codex client version from GitHub; keeping cached/fallback version")
		}
		return
	}
	if result.notModified {
		return
	}

	latestReleaseState.Lock()
	changed := latestReleaseState.version != result.version
	latestReleaseState.version = result.version
	latestReleaseState.etag = result.etag
	cachePath := latestReleaseState.cachePath
	latestReleaseState.Unlock()

	persistCache(cachePath, cachedRelease{Version: result.version, ETag: result.etag})
	if changed {
		log.WithField("version", result.version).Info("updated Codex client version from GitHub latest release")
	}
}

func fetchLatestRelease(ctx context.Context, client *http.Client, apiURL, etag string) (releaseFetchResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	fetchCtx, cancel := context.WithTimeout(ctx, FetchTimeout)
	defer cancel()

	req, errReq := http.NewRequestWithContext(fetchCtx, http.MethodGet, apiURL, nil)
	if errReq != nil {
		return releaseFetchResult{}, fmt.Errorf("create GitHub release request: %w", errReq)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "CLIProxyAPI")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if client == nil {
		client = &http.Client{Timeout: FetchTimeout}
	}

	resp, errDo := client.Do(req)
	if errDo != nil {
		return releaseFetchResult{}, fmt.Errorf("GitHub release request failed: %w", errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("failed to close GitHub release response body: %v", errClose)
		}
	}()

	if resp.StatusCode == http.StatusNotModified {
		return releaseFetchResult{notModified: true}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return releaseFetchResult{}, fmt.Errorf("GitHub release API returned HTTP %d", resp.StatusCode)
	}

	body, errRead := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if errRead != nil {
		return releaseFetchResult{}, fmt.Errorf("read GitHub release response: %w", errRead)
	}
	var payload releaseResponse
	if errUnmarshal := json.Unmarshal(body, &payload); errUnmarshal != nil {
		return releaseFetchResult{}, fmt.Errorf("decode GitHub release response: %w", errUnmarshal)
	}
	version := releaseVersionFromTag(payload.TagName)
	if version == "" {
		return releaseFetchResult{}, fmt.Errorf("GitHub release tag %s does not contain a Codex version", strconv.Quote(payload.TagName))
	}
	return releaseFetchResult{version: version, etag: resp.Header.Get("ETag")}, nil
}

func releaseVersionFromTag(tag string) string {
	version := strings.TrimSpace(tag)
	version = strings.TrimPrefix(version, "rust-")
	version = strings.TrimPrefix(version, "v")
	if !releaseVersionPattern.MatchString(version) {
		return ""
	}
	return version
}

func versionHTTPClient(proxyURL string) *http.Client {
	if strings.TrimSpace(proxyURL) == "" {
		return &http.Client{Timeout: FetchTimeout}
	}
	parsed, errParse := url.Parse(proxyURL)
	if errParse != nil || parsed.Scheme == "" || parsed.Host == "" {
		return &http.Client{Timeout: FetchTimeout}
	}
	transport := &http.Transport{}
	if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = defaultTransport.Clone()
	}
	transport.Proxy = http.ProxyURL(parsed)
	return &http.Client{Transport: transport, Timeout: FetchTimeout}
}

func ensureCacheLoaded() {
	latestReleaseState.RLock()
	loaded := latestReleaseState.cacheLoaded
	latestReleaseState.RUnlock()
	if loaded {
		return
	}

	latestReleaseState.Lock()
	defer latestReleaseState.Unlock()
	if latestReleaseState.cacheLoaded {
		return
	}
	latestReleaseState.cacheLoaded = true
	path := cacheFilePath()
	latestReleaseState.cachePath = path
	if path == "" {
		return
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		if !errors.Is(errRead, os.ErrNotExist) {
			log.WithError(errRead).Debug("failed to read Codex client version cache")
		}
		return
	}
	var cached cachedRelease
	if errUnmarshal := json.Unmarshal(data, &cached); errUnmarshal != nil {
		log.WithError(errUnmarshal).Debug("ignored invalid Codex client version cache")
		return
	}
	if releaseVersionPattern.MatchString(strings.TrimSpace(cached.Version)) {
		latestReleaseState.version = strings.TrimSpace(cached.Version)
		latestReleaseState.etag = strings.TrimSpace(cached.ETag)
	}
}

func persistCache(path string, cached cachedRelease) {
	if path == "" {
		return
	}
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		log.WithError(errMkdir).Debug("failed to create Codex client version cache directory")
		return
	}
	data, errMarshal := json.Marshal(cached)
	if errMarshal != nil {
		log.WithError(errMarshal).Debug("failed to encode Codex client version cache")
		return
	}
	if errWrite := os.WriteFile(path, data, 0o600); errWrite != nil {
		log.WithError(errWrite).Debug("failed to write Codex client version cache")
	}
}

func cacheFilePath() string {
	for _, key := range []string{"WRITABLE_PATH", "writable_path"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return filepath.Join(filepath.Clean(value), "cache", "codex-client-version.json")
		}
	}
	cacheDir, errCache := os.UserCacheDir()
	if errCache != nil || strings.TrimSpace(cacheDir) == "" {
		return ""
	}
	return filepath.Join(cacheDir, "cliproxyapi", "codex-client-version.json")
}

func notifyLatestVersionRefreshed() {
	latestReleaseState.RLock()
	ch := latestReleaseState.refreshed
	latestReleaseState.RUnlock()
	if ch == nil {
		return
	}
	select {
	case ch <- struct{}{}:
	default:
	}
}
