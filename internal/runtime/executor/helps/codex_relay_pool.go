package helps

import (
	"container/list"
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// CodexRelayPool retains only idle resources under a shared byte budget.
// Active leases are request-owned and cannot be evicted for capacity or age.
type CodexRelayPool[T any] struct {
	mu      sync.Mutex
	entries map[string]*codexRelayEntry[T]
	idle    list.List
	bytes   int64
	policy  config.CodexWebsocketRelayPolicy
	now     func() time.Time
	timer   *time.Timer
	cost    func(T) int64
	close   func(T)
	retain  func(T) bool
}

type codexRelayEntry[T any] struct {
	key, authID string
	value       T
	busy        bool
	retired     bool
	done        chan struct{}
	idleAt      time.Time
	cost        int64
	element     *list.Element
	closeOnce   sync.Once
}

// CodexRelayLease exclusively owns a resource until Release. Waiters use their
// request contexts, not the upstream socket's lifetime, for cancellation.
type CodexRelayLease[T any] struct {
	Value T
	pool  *CodexRelayPool[T]
	entry *codexRelayEntry[T]
	once  sync.Once
}

// NewCodexRelayPool creates an empty pool. closeResource always runs outside mu.
func NewCodexRelayPool[T any](policy config.CodexWebsocketRelayPolicy, cost func(T) int64, closeResource func(T)) *CodexRelayPool[T] {
	return &CodexRelayPool[T]{entries: make(map[string]*codexRelayEntry[T]), policy: policy, now: time.Now, cost: cost, close: closeResource}
}

// Acquire serializes a named session. An empty key is never retained.
// create must not perform network I/O or call back into this pool.
func (p *CodexRelayPool[T]) Acquire(ctx context.Context, key, authID string, create func() T) (*CodexRelayLease[T], error) {
	transient := key == ""
	if transient {
		key = "transient:" + uuid.NewString()
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		p.mu.Lock()
		evicted := p.trimLocked()
		e := p.entries[key]
		if e != nil && e.busy {
			done := e.done
			p.scheduleLocked()
			p.mu.Unlock()
			p.closeEntries(evicted)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-done:
				continue
			}
		}
		if e == nil {
			e = &codexRelayEntry[T]{key: key, authID: authID, value: create(), retired: transient}
			p.entries[key] = e
		} else {
			p.removeIdleLocked(e)
		}
		e.busy = true
		e.done = make(chan struct{})
		p.scheduleLocked()
		p.mu.Unlock()
		p.closeEntries(evicted)
		return &CodexRelayLease[T]{Value: e.value, pool: p, entry: e}, nil
	}
}

// Release retains successful resources only. A failed or retired resource closes.
func (l *CodexRelayLease[T]) Release(healthy bool) {
	l.once.Do(func() {
		p, e := l.pool, l.entry
		cost := p.cost(e.value)
		p.mu.Lock()
		e.busy = false
		var evicted []*codexRelayEntry[T]
		if p.retain != nil && !p.retain(e.value) {
			e.retired = true
		}
		if !healthy || e.retired || p.policy.IdleTTL == 0 || cost <= 0 || cost > p.policy.MaxMemory {
			if p.entries[e.key] == e {
				delete(p.entries, e.key)
			}
			evicted = append(evicted, e)
		} else {
			e.cost, e.idleAt = cost, p.now()
			// Trim before adding to avoid overflow even with a MaxInt64 budget.
			for p.bytes > p.policy.MaxMemory-cost {
				old := p.idle.Back().Value.(*codexRelayEntry[T])
				p.evictLocked(old)
				evicted = append(evicted, old)
			}
			e.element = p.idle.PushFront(e)
			p.bytes += cost
		}
		close(e.done)
		evicted = append(evicted, p.trimLocked()...)
		p.scheduleLocked()
		p.mu.Unlock()
		p.closeEntries(evicted)
	})
}

// Configure applies budgets immediately and retires resources whose transport
// configuration changed. Active retired resources close when their leases end.
func (p *CodexRelayPool[T]) Configure(policy config.CodexWebsocketRelayPolicy, retain func(T) bool) {
	p.mu.Lock()
	p.policy, p.retain = policy, retain
	var evicted []*codexRelayEntry[T]
	if retain != nil {
		for _, e := range p.entries {
			if retain(e.value) {
				continue
			}
			e.retired = true
			if !e.busy {
				p.evictLocked(e)
				evicted = append(evicted, e)
			}
		}
	}
	evicted = append(evicted, p.trimLocked()...)
	p.scheduleLocked()
	p.mu.Unlock()
	p.closeEntries(evicted)
}

// CloseAuth closes the given credential's resources, including active sockets.
// An empty authID closes the whole pool, but the pool may be used after shutdown.
func (p *CodexRelayPool[T]) CloseAuth(authID string) {
	p.mu.Lock()
	var evicted []*codexRelayEntry[T]
	for _, e := range p.entries {
		if authID != "" && e.authID != authID {
			continue
		}
		e.retired = true
		if !e.busy {
			p.evictLocked(e)
		}
		evicted = append(evicted, e)
	}
	p.scheduleLocked()
	p.mu.Unlock()
	p.closeEntries(evicted)
}

func (p *CodexRelayPool[T]) removeIdleLocked(e *codexRelayEntry[T]) {
	if e.element != nil {
		p.idle.Remove(e.element)
		e.element = nil
		p.bytes -= e.cost
	}
}

func (p *CodexRelayPool[T]) evictLocked(e *codexRelayEntry[T]) {
	p.removeIdleLocked(e)
	delete(p.entries, e.key)
}

func (p *CodexRelayPool[T]) trimLocked() []*codexRelayEntry[T] {
	var evicted []*codexRelayEntry[T]
	now := p.now()
	for p.idle.Len() > 0 {
		e := p.idle.Back().Value.(*codexRelayEntry[T])
		if p.bytes <= p.policy.MaxMemory && p.policy.IdleTTL > 0 && now.Sub(e.idleAt) < p.policy.IdleTTL {
			break
		}
		p.evictLocked(e)
		evicted = append(evicted, e)
	}
	// Release the map's high-water allocation once all sessions have gone.
	if len(p.entries) == 0 {
		p.entries = make(map[string]*codexRelayEntry[T])
	}
	return evicted
}

func (p *CodexRelayPool[T]) scheduleLocked() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
	if oldest := p.idle.Back(); oldest != nil {
		d := p.policy.IdleTTL - p.now().Sub(oldest.Value.(*codexRelayEntry[T]).idleAt)
		p.timer = time.AfterFunc(d, p.expire)
	}
}

func (p *CodexRelayPool[T]) expire() {
	p.mu.Lock()
	evicted := p.trimLocked()
	p.scheduleLocked()
	p.mu.Unlock()
	p.closeEntries(evicted)
}

func (p *CodexRelayPool[T]) closeEntries(entries []*codexRelayEntry[T]) {
	for _, e := range entries {
		e.closeOnce.Do(func() { p.close(e.value) })
	}
}
