package auth

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/clienterror"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

type concurrencyStubExecutor struct {
	id       string
	execFn   func(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (cliproxyexecutor.Response, error)
	streamFn func(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error)
	countFn  func(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (cliproxyexecutor.Response, error)
}

func (e *concurrencyStubExecutor) Identifier() string { return e.id }
func (e *concurrencyStubExecutor) Execute(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	if e.execFn != nil {
		return e.execFn(ctx, auth, req, opts)
	}
	return cliproxyexecutor.Response{Payload: []byte(`{"ok":true}`)}, nil
}
func (e *concurrencyStubExecutor) ExecuteStream(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	if e.streamFn != nil {
		return e.streamFn(ctx, auth, req, opts)
	}
	ch := make(chan cliproxyexecutor.StreamChunk, 1)
	ch <- cliproxyexecutor.StreamChunk{Payload: []byte("data: ok\n\n")}
	close(ch)
	return &cliproxyexecutor.StreamResult{Chunks: ch}, nil
}
func (e *concurrencyStubExecutor) Refresh(context.Context, *Auth) (*Auth, error) { return nil, nil }
func (e *concurrencyStubExecutor) CountTokens(ctx context.Context, auth *Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	if e.countFn != nil {
		return e.countFn(ctx, auth, req, opts)
	}
	return cliproxyexecutor.Response{Payload: []byte(`{"tokens":1}`)}, nil
}
func (e *concurrencyStubExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, nil
}

func registerTestAuth(t *testing.T, m *Manager, auth *Auth, model string) {
	t.Helper()
	reg := registry.GetGlobalRegistry()
	reg.RegisterClient(auth.ID, auth.Provider, []*registry.ModelInfo{{ID: model}})
	t.Cleanup(func() { reg.UnregisterClient(auth.ID) })
	if _, err := m.Register(context.Background(), auth); err != nil {
		t.Fatalf("Register(%s) error = %v", auth.ID, err)
	}
}

func assertConcurrencyBusy429(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !isConcurrencyBusyError(err) {
		t.Fatalf("expected ConcurrencyBusyError, got %T: %v", err, err)
	}
	if status := clienterror.HTTPStatusFromError(err); status != http.StatusTooManyRequests {
		t.Fatalf("HTTP status = %d, want 429 (err=%v)", status, err)
	}
}

func TestConcurrencyLimit_SingleKeySkipAndFailoverThen429(t *testing.T) {
	const model = "concurrency-gemini-single-key"
	m := NewManager(nil, &RoundRobinSelector{}, nil)
	m.SetRetryConfig(2, 0, 0) // Ensure 429 does not spin in retry rounds.

	enteredCh := make(chan string, 2)
	release := make(chan struct{})

	var activeA, activeB atomic.Int64
	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "gemini",
		execFn: func(ctx context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
			switch auth.ID {
			case "auth-a":
				if activeA.Add(1) > 1 {
					return cliproxyexecutor.Response{}, errors.New("overshot auth-a limit")
				}
				enteredCh <- auth.ID
				<-release
				activeA.Add(-1)
			case "auth-b":
				if activeB.Add(1) > 1 {
					return cliproxyexecutor.Response{}, errors.New("overshot auth-b limit")
				}
				enteredCh <- auth.ID
				<-release
				activeB.Add(-1)
			}
			return cliproxyexecutor.Response{Payload: []byte(auth.ID)}, nil
		},
	})

	registerTestAuth(t, m, &Auth{
		ID:         "auth-a",
		Provider:   "gemini",
		Attributes: map[string]string{AttributeMaxConcurrency: "1"},
	}, model)
	registerTestAuth(t, m, &Auth{
		ID:         "auth-b",
		Provider:   "gemini",
		Attributes: map[string]string{AttributeMaxConcurrency: "1"},
	}, model)

	var wg sync.WaitGroup
	errCh := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := m.Execute(context.Background(), []string{"gemini"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
			if err != nil {
				errCh <- err
			}
		}()
	}

	seen := map[string]bool{}
	for len(seen) < 2 {
		select {
		case id := <-enteredCh:
			seen[id] = true
		case err := <-errCh:
			close(release)
			wg.Wait()
			t.Fatalf("unexpected Execute failure before reaching concurrency limit: %v", err)
		}
	}
	if !seen["auth-a"] || !seen["auth-b"] {
		close(release)
		wg.Wait()
		t.Fatalf("expected both auth-a and auth-b to handle concurrent requests, got %v", seen)
	}

	// Both keys are busy; third request must return 429 immediately.
	_, errThird := m.Execute(context.Background(), []string{"gemini"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	assertConcurrencyBusy429(t, errThird)

	close(release)
	wg.Wait()
	select {
	case err := <-errCh:
		t.Fatalf("in-flight request error = %v", err)
	default:
	}

	// After release, requests succeed again cleanly.
	resp, errAfter := m.Execute(context.Background(), []string{"gemini"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	if errAfter != nil || len(resp.Payload) == 0 {
		t.Fatalf("after release Execute() resp=%v err=%v", resp, errAfter)
	}
}

func TestConcurrencyLimit_OpenAICompatDualProviderAndPerKeyLimits(t *testing.T) {
	const model = "concurrency-compat-dual"
	m := NewManager(nil, &FillFirstSelector{}, nil)

	enteredCh := make(chan string, 2)
	errCh := make(chan error, 2)
	release := make(chan struct{})

	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "compat-a",
		execFn: func(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
			enteredCh <- auth.ID
			<-release
			return cliproxyexecutor.Response{Payload: []byte(auth.ID)}, nil
		},
	})
	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "compat-b",
		execFn: func(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
			return cliproxyexecutor.Response{Payload: []byte(auth.ID)}, nil
		},
	})

	// compat-a has provider limit 2; k1 limit 1; k2 limit 2. Priority higher than compat-b.
	registerTestAuth(t, m, &Auth{
		ID:       "compat-a-k1",
		Provider: "compat-a",
		Attributes: map[string]string{
			"priority":                      "10",
			AttributeMaxConcurrency:         "1",
			AttributeProviderConcurrencyKey: "group-a",
			AttributeProviderMaxConcurrency: "2",
		},
	}, model)
	registerTestAuth(t, m, &Auth{
		ID:       "compat-a-k2",
		Provider: "compat-a",
		Attributes: map[string]string{
			"priority":                      "10",
			AttributeMaxConcurrency:         "2",
			AttributeProviderConcurrencyKey: "group-a",
			AttributeProviderMaxConcurrency: "2",
		},
	}, model)
	registerTestAuth(t, m, &Auth{
		ID:       "compat-b-k1",
		Provider: "compat-b",
		Attributes: map[string]string{
			"priority":              "1",
			AttributeMaxConcurrency: "1",
		},
	}, model)

	var wg sync.WaitGroup
	// Request 1 acquires compat-a-k1 first (sorted lexically by auth ID under FillFirst).
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := m.Execute(context.Background(), []string{"compat-a", "compat-b"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{}); err != nil {
			errCh <- err
		}
	}()
	select {
	case id := <-enteredCh:
		if id != "compat-a-k1" {
			close(release)
			wg.Wait()
			t.Fatalf("req1 picked %q, want compat-a-k1", id)
		}
	case err := <-errCh:
		close(release)
		wg.Wait()
		t.Fatalf("req1 failed: %v", err)
	}

	// Request 2 must skip compat-a-k1 (per-key limit=1 saturated!) and pick compat-a-k2 (provider limit=2 still has 1 free).
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := m.Execute(context.Background(), []string{"compat-a", "compat-b"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{}); err != nil {
			errCh <- err
		}
	}()
	select {
	case id := <-enteredCh:
		if id != "compat-a-k2" {
			close(release)
			wg.Wait()
			t.Fatalf("req2 picked %q, want compat-a-k2", id)
		}
	case err := <-errCh:
		close(release)
		wg.Wait()
		t.Fatalf("req2 failed: %v", err)
	}

	// Third request cannot use k2 (even though k2's per-key limit is 2) because group-a provider limit is 2!
	// So it must switch to compat-b-k1.
	resp3, err3 := m.Execute(context.Background(), []string{"compat-a", "compat-b"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	if err3 != nil {
		close(release)
		wg.Wait()
		t.Fatalf("req3 error = %v", err3)
	}
	if string(resp3.Payload) != "compat-b-k1" {
		close(release)
		wg.Wait()
		t.Fatalf("req3 picked %q, want compat-b-k1", string(resp3.Payload))
	}

	close(release)
	wg.Wait()
}

func TestConcurrencyLimit_PriorityFailoverAndLegacyPath(t *testing.T) {
	const model = "concurrency-codex-legacy"
	// SessionAffinitySelector forces legacy pickNextMixedLegacy path.
	selector := NewSessionAffinitySelector(&RoundRobinSelector{})
	m := NewManager(nil, selector, nil)

	enteredHigh := make(chan struct{})
	errHigh := make(chan error, 1)
	releaseHigh := make(chan struct{})
	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "codex",
		execFn: func(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
			if auth.ID == "high" {
				close(enteredHigh)
				<-releaseHigh
			}
			return cliproxyexecutor.Response{Payload: []byte(auth.ID)}, nil
		},
	})

	registerTestAuth(t, m, &Auth{
		ID:       "high",
		Provider: "codex",
		Metadata: map[string]any{"max_concurrency": 1},
		Attributes: map[string]string{
			"priority": "10",
		},
	}, model)
	registerTestAuth(t, m, &Auth{
		ID:       "low",
		Provider: "codex",
		Metadata: map[string]any{"max_concurrency": 1},
		Attributes: map[string]string{
			"priority": "1",
		},
	}, model)

	opts := cliproxyexecutor.Options{Metadata: map[string]any{cliproxyexecutor.DerivedSessionIDMetadataKey: "sess-1"}}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := m.Execute(context.Background(), []string{"codex"}, cliproxyexecutor.Request{Model: model}, opts); err != nil {
			errHigh <- err
		}
	}()
	select {
	case <-enteredHigh:
	case err := <-errHigh:
		close(releaseHigh)
		wg.Wait()
		t.Fatalf("high req failed: %v", err)
	}

	// Legacy SessionAffinitySelector skips saturated priority-10 auth and switches to priority-1 auth.
	respLow, errLow := m.Execute(context.Background(), []string{"codex"}, cliproxyexecutor.Request{Model: model}, opts)
	if errLow != nil {
		close(releaseHigh)
		wg.Wait()
		t.Fatalf("fallback req error = %v", errLow)
	}
	if string(respLow.Payload) != "low" {
		close(releaseHigh)
		wg.Wait()
		t.Fatalf("fallback picked %q, want low", string(respLow.Payload))
	}

	close(releaseHigh)
	wg.Wait()
}

func TestConcurrencyLimit_StreamLifecycleAndCancelRelease(t *testing.T) {
	const model = "concurrency-claude-stream"
	m := NewManager(nil, &RoundRobinSelector{}, nil)
	m.SetRetryConfig(2, 0, 0)

	var streamChMu sync.Mutex
	var closeUpstream func()
	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "claude",
		streamFn: func(streamCtx context.Context, _ *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
			ch := make(chan cliproxyexecutor.StreamChunk, 4)
			ch <- cliproxyexecutor.StreamChunk{Payload: []byte("first")}
			var closeOnce sync.Once
			closeFn := func() { closeOnce.Do(func() { close(ch) }) }
			streamChMu.Lock()
			closeUpstream = closeFn
			streamChMu.Unlock()
			go func() {
				<-streamCtx.Done()
				closeFn()
			}()
			return &cliproxyexecutor.StreamResult{Chunks: ch}, nil
		},
	})

	registerTestAuth(t, m, &Auth{
		ID:         "claude-1",
		Provider:   "claude",
		Attributes: map[string]string{AttributeMaxConcurrency: "1"},
	}, model)

	// 1. Start stream -> holds concurrency slot until stream ends.
	res1, err1 := m.ExecuteStream(context.Background(), []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{Stream: true})
	if err1 != nil {
		t.Fatalf("ExecuteStream(1) error = %v", err1)
	}

	// 2. While stream 1 is open, ExecuteCount and ExecuteStream must return 429.
	_, errCountBusy := m.ExecuteCount(context.Background(), []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	assertConcurrencyBusy429(t, errCountBusy)
	_, errStreamBusy := m.ExecuteStream(context.Background(), []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{Stream: true})
	assertConcurrencyBusy429(t, errStreamBusy)

	// 3. Close upstream stream 1 and drain res1.Chunks to EOF; slot must be free before EOF returns!
	streamChMu.Lock()
	closeUpstream()
	streamChMu.Unlock()
	for range res1.Chunks {
	}

	// 4. Start stream 2 with cancelable context, verify 429 while active, then cancel ctx -> releases slot.
	ctx2, cancel2 := context.WithCancel(context.Background())
	res2, err2 := m.ExecuteStream(ctx2, []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{Stream: true})
	if err2 != nil {
		t.Fatalf("ExecuteStream(2) error = %v", err2)
	}
	_, errBusy2 := m.Execute(context.Background(), []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	assertConcurrencyBusy429(t, errBusy2)

	cancel2()
	for range res2.Chunks {
	}

	// 5. Slot is free after canceled stream exits.
	_, err3 := m.Execute(context.Background(), []string{"claude"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
	if err3 != nil {
		t.Fatalf("Execute after canceled stream error = %v", err3)
	}
}

func TestConcurrencyLimit_RaceSafetyUnderContention(t *testing.T) {
	const model = "concurrency-gemini-race"
	m := NewManager(nil, &RoundRobinSelector{}, nil)

	const authLimit = 2
	const workers = 12
	var currentInFlight atomic.Int64
	var maxObserved atomic.Int64
	allAtCap := make(chan struct{})
	var capOnce sync.Once
	release := make(chan struct{})
	errCh := make(chan error, workers)

	m.RegisterExecutor(&concurrencyStubExecutor{
		id: "gemini",
		execFn: func(_ context.Context, _ *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
			cur := currentInFlight.Add(1)
			defer currentInFlight.Add(-1)
			for {
				prev := maxObserved.Load()
				if cur <= prev || maxObserved.CompareAndSwap(prev, cur) {
					break
				}
			}
			if cur == authLimit {
				capOnce.Do(func() { close(allAtCap) })
			}
			<-release
			return cliproxyexecutor.Response{Payload: []byte("ok")}, nil
		},
	})

	registerTestAuth(t, m, &Auth{
		ID:         "race-auth",
		Provider:   "gemini",
		Attributes: map[string]string{AttributeMaxConcurrency: "2"},
	}, model)

	var succeeded atomic.Int64
	var busy429 atomic.Int64
	var wg sync.WaitGroup
	startGate := make(chan struct{})

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startGate
			_, err := m.Execute(context.Background(), []string{"gemini"}, cliproxyexecutor.Request{Model: model}, cliproxyexecutor.Options{})
			if err == nil {
				succeeded.Add(1)
				return
			}
			if isConcurrencyBusyError(err) && clienterror.HTTPStatusFromError(err) == http.StatusTooManyRequests {
				busy429.Add(1)
				return
			}
			errCh <- err
		}()
	}

	close(startGate)
	select {
	case <-allAtCap:
	case err := <-errCh:
		close(release)
		wg.Wait()
		t.Fatalf("unexpected error before cap: %v", err)
	}
	close(release)
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("unexpected error under contention: %v", err)
	}

	if maxObserved.Load() > authLimit {
		t.Fatalf("maxObserved = %d exceeded limit %d", maxObserved.Load(), authLimit)
	}
	if succeeded.Load() == 0 || succeeded.Load()+busy429.Load() != workers {
		t.Fatalf("unexpected outcomes: succeeded=%d busy429=%d total=%d", succeeded.Load(), busy429.Load(), workers)
	}
}
