package auth

import (
	"sync"
)

type authConcurrencyTracker struct {
	mu            sync.Mutex
	authInFlight  map[string]int64
	groupInFlight map[string]int64
}

func newAuthConcurrencyTracker() *authConcurrencyTracker {
	return &authConcurrencyTracker{
		authInFlight:  make(map[string]int64),
		groupInFlight: make(map[string]int64),
	}
}

type concurrencyLease struct {
	tracker  *authConcurrencyTracker
	authID   string
	groupKey string
	once     sync.Once
}

// Release releases any concurrency slots held by this lease exactly once.
func (l *concurrencyLease) Release() {
	if l == nil || l.tracker == nil {
		return
	}
	l.once.Do(func() {
		l.tracker.release(l.authID, l.groupKey)
	})
}

func (t *authConcurrencyTracker) CanAcquire(auth *Auth) bool {
	if t == nil || auth == nil {
		return true
	}
	authLimit := authMaxConcurrency(auth)
	groupKey, groupLimit := authProviderConcurrencyLimit(auth)
	if authLimit <= 0 && groupLimit <= 0 {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if authLimit > 0 && t.authInFlight[auth.ID] >= authLimit {
		return false
	}
	if groupLimit > 0 && groupKey != "" && t.groupInFlight[groupKey] >= groupLimit {
		return false
	}
	return true
}

func (t *authConcurrencyTracker) AllowPredicate(base func(*scheduledAuth) bool) func(*scheduledAuth) bool {
	if t == nil {
		return base
	}
	return func(entry *scheduledAuth) bool {
		if base != nil && !base(entry) {
			return false
		}
		if entry == nil || entry.auth == nil {
			return false
		}
		return t.CanAcquire(entry.auth)
	}
}

func (t *authConcurrencyTracker) TryAcquire(auth *Auth) (*concurrencyLease, bool) {
	if t == nil || auth == nil {
		return nil, true
	}
	authLimit := authMaxConcurrency(auth)
	groupKey, groupLimit := authProviderConcurrencyLimit(auth)

	heldAuthID := auth.ID
	heldGroupKey := ""
	if groupKey != "" {
		heldGroupKey = groupKey
	}

	t.mu.Lock()
	if authLimit > 0 && t.authInFlight[auth.ID] >= authLimit {
		t.mu.Unlock()
		return nil, false
	}
	if groupLimit > 0 && heldGroupKey != "" && t.groupInFlight[heldGroupKey] >= groupLimit {
		t.mu.Unlock()
		return nil, false
	}
	if heldAuthID != "" {
		t.authInFlight[heldAuthID]++
	}
	if heldGroupKey != "" {
		t.groupInFlight[heldGroupKey]++
	}
	t.mu.Unlock()

	if heldAuthID == "" && heldGroupKey == "" {
		return nil, true
	}
	return &concurrencyLease{
		tracker:  t,
		authID:   heldAuthID,
		groupKey: heldGroupKey,
	}, true
}

func (t *authConcurrencyTracker) release(authID, groupKey string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if authID != "" {
		if cur := t.authInFlight[authID]; cur <= 1 {
			delete(t.authInFlight, authID)
		} else {
			t.authInFlight[authID] = cur - 1
		}
	}
	if groupKey != "" {
		if cur := t.groupInFlight[groupKey]; cur <= 1 {
			delete(t.groupInFlight, groupKey)
		} else {
			t.groupInFlight[groupKey] = cur - 1
		}
	}
}

func (m *Manager) concurrencyTracker() *authConcurrencyTracker {
	if m == nil {
		return nil
	}
	if tracker := m.concurrency.Load(); tracker != nil {
		return tracker
	}
	created := newAuthConcurrencyTracker()
	if m.concurrency.CompareAndSwap(nil, created) {
		return created
	}
	return m.concurrency.Load()
}

func (m *Manager) canAcquireConcurrency(auth *Auth) bool {
	if m == nil || auth == nil {
		return true
	}
	return m.concurrencyTracker().CanAcquire(auth)
}

func (m *Manager) tryAcquireConcurrency(auth *Auth) (*concurrencyLease, bool) {
	if m == nil || auth == nil {
		return nil, true
	}
	return m.concurrencyTracker().TryAcquire(auth)
}
