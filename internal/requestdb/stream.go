package requestdb

import (
	"sync"
	"sync/atomic"
)

// streamSubscriberBuffer bounds each subscriber's event queue. A subscriber
// that cannot keep up is dropped (channel closed) instead of blocking the
// usage dispatcher; the SSE client reconnects and re-plays the backlog.
const streamSubscriberBuffer = 256

// streamSubscriber is one live-tail consumer. The filter reuses the Query
// struct; only its equality-filter fields are evaluated.
type streamSubscriber struct {
	id     uint64
	filter Query
	ch     chan *Entry
}

// Channel exposes the event queue; it is closed when the subscriber is
// dropped for being too slow or after UnsubscribeStream.
func (s *streamSubscriber) Channel() <-chan *Entry {
	return s.ch
}

var (
	streamMu     sync.Mutex
	streamNextID atomic.Uint64
	streamSubs   = map[uint64]*streamSubscriber{}
)

// SubscribeStream registers a live-tail subscriber matching filter.
func SubscribeStream(filter Query) *streamSubscriber {
	sub := &streamSubscriber{
		id:     streamNextID.Add(1),
		filter: filter,
		ch:     make(chan *Entry, streamSubscriberBuffer),
	}
	streamMu.Lock()
	streamSubs[sub.id] = sub
	streamMu.Unlock()
	return sub
}

// UnsubscribeStream removes a subscriber and closes its channel.
func UnsubscribeStream(sub *streamSubscriber) {
	if sub == nil {
		return
	}
	streamMu.Lock()
	_, ok := streamSubs[sub.id]
	delete(streamSubs, sub.id)
	streamMu.Unlock()
	if ok {
		close(sub.ch)
	}
}

// streamSubscriberCount reports how many live-tail consumers exist.
func streamSubscriberCount() int {
	streamMu.Lock()
	defer streamMu.Unlock()
	return len(streamSubs)
}

// matchesStreamFilter evaluates the subscriber's equality filters.
func matchesStreamFilter(q Query, e *Entry) bool {
	if len(q.Models) > 0 {
		matched := false
		for _, m := range q.Models {
			if m == e.Model {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	} else if q.Model != "" && q.Model != e.Model {
		return false
	}
	if len(q.Providers) > 0 {
		matched := false
		for _, p := range q.Providers {
			if MatchesProviderFilterKey(p, e) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	} else if q.Provider != "" {
		if IsStructuredProviderKey(q.Provider) {
			if !MatchesProviderFilterKey(q.Provider, e) {
				return false
			}
		} else {
			matched := MatchesProviderSearch(q.Provider, e)
			if !matched {
				for _, key := range q.ProviderMatchKeys {
					if MatchesProviderFilterKey(key, e) {
						matched = true
						break
					}
				}
			}
			if !matched {
				return false
			}
		}
	}
	if q.APIKey != "" && q.APIKey != e.APIKey {
		return false
	}
	if q.SessionID != "" && q.SessionID != e.SessionID {
		return false
	}
	if q.Failed != nil && *q.Failed != e.Failed {
		return false
	}
	if q.StatusCode > 0 && q.StatusCode != e.StatusCode {
		return false
	}
	if q.FromMS > 0 && e.RequestedAtMS < q.FromMS {
		return false
	}
	if q.ToMS > 0 && e.RequestedAtMS > q.ToMS {
		return false
	}
	return true
}

// publishStreamEntry fans an entry out to all matching subscribers without
// ever blocking the caller; slow consumers are dropped and closed.
func publishStreamEntry(entry *Entry) {
	streamMu.Lock()
	defer streamMu.Unlock()
	for _, sub := range streamSubs {
		if !matchesStreamFilter(sub.filter, entry) {
			continue
		}
		select {
		case sub.ch <- entry:
		default:
			delete(streamSubs, sub.id)
			close(sub.ch)
		}
	}
}
