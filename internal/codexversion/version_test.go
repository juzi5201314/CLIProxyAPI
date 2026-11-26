package codexversion

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func isolateLatestReleaseState(t *testing.T) {
	t.Helper()
	reset := func() {
		ConfigureLatestVersionUpdater(context.Background(), "", false)
		latestReleaseState.Lock()
		latestReleaseState.version = ""
		latestReleaseState.etag = ""
		latestReleaseState.cachePath = ""
		latestReleaseState.cacheLoaded = false
		latestReleaseState.proxyURL = ""
		latestReleaseState.apiURL = defaultGitHubLatestReleaseURL
		latestReleaseState.updaterOn = false
		latestReleaseState.parentDone = nil
		latestReleaseState.refreshed = nil
		latestReleaseState.Unlock()
	}
	reset()
	t.Cleanup(reset)
}

func TestReleaseVersionFromTag(t *testing.T) {
	tests := map[string]string{
		"rust-v0.173.0": "0.173.0",
		"v0.173.0":      "0.173.0",
		"0.173.0":       "0.173.0",
		"rust-v0.173":   "",
		"nightly":       "",
	}
	for tag, want := range tests {
		if got := releaseVersionFromTag(tag); got != want {
			t.Errorf("releaseVersionFromTag(%q) = %q, want %q", tag, got, want)
		}
	}
}

func TestFetchLatestReleaseUsesPublicAPIHeadersAndETag(t *testing.T) {
	var sawIfNoneMatch bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIfNoneMatch = r.Header.Get("If-None-Match") == `"old-etag"`
		if r.Header.Get("Accept") != "application/vnd.github+json" || r.Header.Get("User-Agent") == "" {
			t.Errorf("missing GitHub API headers: %#v", r.Header)
		}
		w.Header().Set("ETag", `"new-etag"`)
		_, _ = w.Write([]byte(`{"tag_name":"rust-v0.173.0"}`))
	}))
	defer server.Close()

	result, errFetch := fetchLatestRelease(context.Background(), server.Client(), server.URL, `"old-etag"`)
	if errFetch != nil {
		t.Fatalf("fetchLatestRelease() error = %v", errFetch)
	}
	if result.version != "0.173.0" || result.etag != `"new-etag"` || result.notModified {
		t.Fatalf("fetchLatestRelease() = %+v", result)
	}
	if !sawIfNoneMatch {
		t.Fatal("fetchLatestRelease() did not send If-None-Match")
	}
}

func TestFetchLatestReleaseNotModified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()

	result, errFetch := fetchLatestRelease(context.Background(), server.Client(), server.URL, `"cached"`)
	if errFetch != nil || !result.notModified {
		t.Fatalf("fetchLatestRelease() = %+v, %v", result, errFetch)
	}
}

func TestResolveLatestUsesPersistentCacheBeforeFallback(t *testing.T) {
	isolateLatestReleaseState(t)
	dir := t.TempDir()
	t.Setenv("WRITABLE_PATH", dir)
	cachePath := filepath.Join(dir, "cache", "codex-client-version.json")
	persistCache(cachePath, cachedRelease{Version: "0.173.0", ETag: `"etag"`})

	if got := ResolveLatest("0.172.0"); got != "0.173.0" {
		t.Fatalf("ResolveLatest() = %q, want cached 0.173.0", got)
	}
}

func TestResolveLatestFallsBackWithoutCache(t *testing.T) {
	isolateLatestReleaseState(t)
	t.Setenv("WRITABLE_PATH", t.TempDir())
	if got := ResolveLatest(" 0.172.0 "); got != "0.172.0" {
		t.Fatalf("ResolveLatest() = %q, want fallback 0.172.0", got)
	}
}

func TestLatestVersionUpdaterFetchesImmediatelyAndStops(t *testing.T) {
	isolateLatestReleaseState(t)
	t.Setenv("WRITABLE_PATH", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("ETag", `"release-etag"`)
		_, _ = w.Write([]byte(`{"tag_name":"rust-v0.174.0"}`))
	}))
	defer server.Close()

	latestReleaseState.Lock()
	latestReleaseState.apiURL = server.URL
	latestReleaseState.refreshed = make(chan struct{}, 1)
	latestReleaseState.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ConfigureLatestVersionUpdater(ctx, "", true)

	latestReleaseState.RLock()
	refreshed := latestReleaseState.refreshed
	latestReleaseState.RUnlock()
	select {
	case <-refreshed:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for initial Codex version refresh")
	}
	if got := ResolveLatest("0.172.0"); got != "0.174.0" {
		t.Fatalf("ResolveLatest() = %q, want 0.174.0", got)
	}
	ConfigureLatestVersionUpdater(ctx, "", false)

	cachePath := filepath.Join(os.Getenv("WRITABLE_PATH"), "cache", "codex-client-version.json")
	if _, errStat := os.Stat(cachePath); errStat != nil {
		t.Fatalf("expected persistent version cache: %v", errStat)
	}
}
