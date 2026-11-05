package helps

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

type relayPoolTestResource struct {
	cost   int64
	closes atomic.Int32
}

func relayTestPool(t *testing.T, budget int64) *CodexRelayPool[*relayPoolTestResource] {
	t.Helper()
	p := NewCodexRelayPool(config.CodexWebsocketRelayPolicy{IdleTTL: time.Hour, MaxMemory: budget}, func(v *relayPoolTestResource) int64 { return v.cost }, func(v *relayPoolTestResource) { v.closes.Add(1) })
	t.Cleanup(func() { p.CloseAuth("") })
	return p
}

func TestCodexRelayPoolByteBudget(t *testing.T) {
	p := relayTestPool(t, 100)
	acquire := func(key string, cost int64) *CodexRelayLease[*relayPoolTestResource] {
		t.Helper()
		lease, err := p.Acquire(t.Context(), key, "auth", func() *relayPoolTestResource { return &relayPoolTestResource{cost: cost} })
		if err != nil {
			t.Fatal(err)
		}
		return lease
	}
	a, b := acquire("a", 30), acquire("b", 60)
	a.Release(true)
	b.Release(true)
	if p.bytes != 90 {
		t.Fatalf("bytes = %d", p.bytes)
	}
	a = acquire("a", 0)
	if p.bytes != 60 {
		t.Fatalf("borrowed bytes still charged: %d", p.bytes)
	}
	a.Release(true)
	c := acquire("c", 70)
	c.Release(true)
	if p.bytes != 100 || b.Value.closes.Load() != 1 || a.Value.closes.Load() != 0 {
		t.Fatalf("LRU accounting = %d, closes a/b = %d/%d", p.bytes, a.Value.closes.Load(), b.Value.closes.Load())
	}
	huge := acquire("huge", 101)
	huge.Release(true)
	if huge.Value.closes.Load() != 1 || p.bytes != 100 {
		t.Fatal("oversize entry retained or evicted existing entries")
	}
	p.Configure(config.CodexWebsocketRelayPolicy{IdleTTL: time.Hour, MaxMemory: 70}, nil)
	if p.bytes != 70 || a.Value.closes.Load() != 1 {
		t.Fatal("shrinking budget did not evict LRU")
	}
	p.Configure(config.CodexWebsocketRelayPolicy{IdleTTL: time.Hour}, nil)
	if p.bytes != 0 || c.Value.closes.Load() != 1 {
		t.Fatal("zero budget did not drain")
	}
}

func TestCodexRelayPoolExpiryAndActiveLease(t *testing.T) {
	p := relayTestPool(t, 100)
	now := time.Unix(10000, 0)
	p.now = func() time.Time { return now }
	idle, err := p.Acquire(t.Context(), "idle", "a", func() *relayPoolTestResource { return &relayPoolTestResource{cost: 40} })
	if err != nil {
		t.Fatal(err)
	}
	active, err := p.Acquire(t.Context(), "active", "b", func() *relayPoolTestResource { return &relayPoolTestResource{cost: 40} })
	if err != nil {
		t.Fatal(err)
	}
	idle.Release(true)
	now = now.Add(time.Hour)
	p.expire()
	if idle.Value.closes.Load() != 1 || active.Value.closes.Load() != 0 {
		t.Fatal("expiry must affect only idle resources")
	}
	p.Configure(config.CodexWebsocketRelayPolicy{}, nil)
	if active.Value.closes.Load() != 0 {
		t.Fatal("budget change interrupted active request")
	}
	active.Release(true)
	if active.Value.closes.Load() != 1 {
		t.Fatal("active resource retained after zero budget")
	}
}

func TestCodexRelayPoolCancellationAndRetirement(t *testing.T) {
	p := relayTestPool(t, 100)
	first, err := p.Acquire(t.Context(), "session", "auth", func() *relayPoolTestResource { return &relayPoolTestResource{cost: 40} })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	waiting := make(chan error, 1)
	go func() {
		_, err := p.Acquire(ctx, "session", "auth", func() *relayPoolTestResource { panic("must wait for active lease") })
		waiting <- err
	}()
	cancel()
	if err := <-waiting; !errors.Is(err, context.Canceled) {
		t.Fatalf("wait error = %v", err)
	}
	p.Configure(config.CodexWebsocketRelayPolicy{IdleTTL: time.Hour, MaxMemory: 100}, func(*relayPoolTestResource) bool { return false })
	if first.Value.closes.Load() != 0 {
		t.Fatal("retirement interrupted request")
	}
	first.Release(true)
	first.Release(true)
	if first.Value.closes.Load() != 1 {
		t.Fatal("resource must close exactly once")
	}
	second, err := p.Acquire(t.Context(), "session", "auth", func() *relayPoolTestResource { return &relayPoolTestResource{cost: 40} })
	if err != nil {
		t.Fatal(err)
	}
	p.CloseAuth("auth")
	second.Release(true)
	if second.Value.closes.Load() != 1 || len(p.entries) != 0 {
		t.Fatal("auth removal did not release resource")
	}
}

func TestCodexRelayPoolReusesAndClosesOutsideLock(t *testing.T) {
	p := relayTestPool(t, 100)
	p.close = func(v *relayPoolTestResource) { p.mu.Lock(); p.mu.Unlock(); v.closes.Add(1) }
	first, err := p.Acquire(t.Context(), "a", "auth", func() *relayPoolTestResource { return &relayPoolTestResource{cost: 50} })
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan *CodexRelayLease[*relayPoolTestResource], 1)
	go func() {
		second, err := p.Acquire(t.Context(), "a", "auth", func() *relayPoolTestResource { panic("must reuse first") })
		if err != nil {
			got <- nil
			return
		}
		got <- second
	}()
	first.Release(true)
	second := <-got
	if second == nil || second.Value != first.Value {
		t.Fatal("did not reuse session")
	}
	second.Release(false)
	if first.Value.closes.Load() != 1 {
		t.Fatal("failed session not closed")
	}
}
