package helps

import (
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

// httpTimingTracker aggregates per-phase network timings across one or more
// upstream HTTP RoundTrips executed under a single UsageReporter.
type httpTimingTracker struct {
	mu                sync.Mutex
	roundTrips        int
	requestBytes      int64
	dnsDur            time.Duration
	connectDur        time.Duration
	tlsDur            time.Duration
	connAcquireDur    time.Duration
	requestWriteDur   time.Duration
	serverWaitDur     time.Duration
	lastFirstRespByte time.Time
	connReused        bool
	connWasIdle       bool
	connIdleDur       time.Duration
	upstreamTransport string
}

// httpTripTiming captures httptrace milestones for a single RoundTrip invocation.
// Concurrent DNS/Connect dials (e.g. Happy Eyeballs) are tracked as active spans
// so parallel attempts never double-count wall time.
type httpTripTiming struct {
	mu sync.Mutex

	tripStart time.Time

	tGetConn       time.Time
	tGotConn       time.Time
	tWroteRequest  time.Time
	tFirstRespByte time.Time

	activeDNS    int
	dnsSpanStart time.Time
	dnsDur       time.Duration

	activeConnect    int
	connectSpanStart time.Time
	connectDur       time.Duration

	activeTLS    int
	tlsSpanStart time.Time
	tlsDur       time.Duration

	gotConn     bool
	connReused  bool
	connWasIdle bool
	connIdleDur time.Duration
}

func newHTTPTripTiming(start time.Time) *httpTripTiming {
	return &httpTripTiming{tripStart: start}
}

func (t *httpTripTiming) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		GetConn: func(string) {
			now := time.Now()
			t.mu.Lock()
			if t.tGetConn.IsZero() {
				t.tGetConn = now
			}
			t.mu.Unlock()
		},
		DNSStart: func(httptrace.DNSStartInfo) {
			now := time.Now()
			t.mu.Lock()
			if t.activeDNS == 0 {
				t.dnsSpanStart = now
			}
			t.activeDNS++
			t.mu.Unlock()
		},
		DNSDone: func(httptrace.DNSDoneInfo) {
			now := time.Now()
			t.mu.Lock()
			if t.activeDNS > 0 {
				t.activeDNS--
				if t.activeDNS == 0 && !t.dnsSpanStart.IsZero() {
					if d := now.Sub(t.dnsSpanStart); d > 0 {
						t.dnsDur += d
					}
					t.dnsSpanStart = time.Time{}
				}
			}
			t.mu.Unlock()
		},
		ConnectStart: func(string, string) {
			now := time.Now()
			t.mu.Lock()
			if t.activeConnect == 0 {
				t.connectSpanStart = now
			}
			t.activeConnect++
			t.mu.Unlock()
		},
		ConnectDone: func(string, string, error) {
			now := time.Now()
			t.mu.Lock()
			if t.activeConnect > 0 {
				t.activeConnect--
				if t.activeConnect == 0 && !t.connectSpanStart.IsZero() {
					if d := now.Sub(t.connectSpanStart); d > 0 {
						t.connectDur += d
					}
					t.connectSpanStart = time.Time{}
				}
			}
			t.mu.Unlock()
		},
		TLSHandshakeStart: func() {
			now := time.Now()
			t.mu.Lock()
			if t.activeTLS == 0 {
				t.tlsSpanStart = now
			}
			t.activeTLS++
			t.mu.Unlock()
		},
		TLSHandshakeDone: func(tls.ConnectionState, error) {
			now := time.Now()
			t.mu.Lock()
			if t.activeTLS > 0 {
				t.activeTLS--
				if t.activeTLS == 0 && !t.tlsSpanStart.IsZero() {
					if d := now.Sub(t.tlsSpanStart); d > 0 {
						t.tlsDur += d
					}
					t.tlsSpanStart = time.Time{}
				}
			}
			t.mu.Unlock()
		},
		GotConn: func(info httptrace.GotConnInfo) {
			now := time.Now()
			t.mu.Lock()
			if !t.gotConn {
				t.tGotConn = now
				t.gotConn = true
				t.connReused = info.Reused
				t.connWasIdle = info.WasIdle
				t.connIdleDur = info.IdleTime
			}
			t.mu.Unlock()
		},
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			now := time.Now()
			t.mu.Lock()
			if t.tWroteRequest.IsZero() || info.Err == nil {
				t.tWroteRequest = now
			}
			t.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			now := time.Now()
			t.mu.Lock()
			if t.tFirstRespByte.IsZero() {
				t.tFirstRespByte = now
			}
			t.mu.Unlock()
		},
	}
}

func (tr *httpTimingTracker) beginTrip(req *http.Request) (*http.Request, *httpTripTiming) {
	now := time.Now()
	trip := newHTTPTripTiming(now)
	var contentLen int64
	if req != nil && req.ContentLength > 0 {
		contentLen = req.ContentLength
	}
	tr.mu.Lock()
	tr.roundTrips++
	tr.upstreamTransport = "http"
	if contentLen > 0 {
		tr.requestBytes = contentLen
	}
	tr.mu.Unlock()

	if req == nil {
		return nil, trip
	}
	tracedCtx := httptrace.WithClientTrace(req.Context(), trip.clientTrace())
	return req.WithContext(tracedCtx), trip
}

func (tr *httpTimingTracker) finishTrip(trip *httpTripTiming, errRoundTrip error) {
	if trip == nil {
		return
	}
	end := time.Now()
	trip.mu.Lock()
	// Close any spans left open on aborted/errored dials so failed attempts still
	// report where time was spent before the error occurred.
	if trip.activeDNS > 0 && !trip.dnsSpanStart.IsZero() {
		if d := end.Sub(trip.dnsSpanStart); d > 0 {
			trip.dnsDur += d
		}
		trip.activeDNS = 0
		trip.dnsSpanStart = time.Time{}
	}
	if trip.activeConnect > 0 && !trip.connectSpanStart.IsZero() {
		if d := end.Sub(trip.connectSpanStart); d > 0 {
			trip.connectDur += d
		}
		trip.activeConnect = 0
		trip.connectSpanStart = time.Time{}
	}
	if trip.activeTLS > 0 && !trip.tlsSpanStart.IsZero() {
		if d := end.Sub(trip.tlsSpanStart); d > 0 {
			trip.tlsDur += d
		}
		trip.activeTLS = 0
		trip.tlsSpanStart = time.Time{}
	}

	connStart := trip.tGetConn
	if connStart.IsZero() {
		connStart = trip.tripStart
	}

	var connAcquire time.Duration
	if trip.gotConn {
		connAcquire = clampPositiveDuration(trip.tGotConn.Sub(connStart))
	} else if errRoundTrip != nil && !connStart.IsZero() {
		// Dial/handshake failed before GotConn; attribute elapsed time to connection acquisition.
		connAcquire = clampPositiveDuration(end.Sub(connStart))
	}

	var reqWrite time.Duration
	if trip.gotConn && !trip.tWroteRequest.IsZero() {
		reqWrite = clampPositiveDuration(trip.tWroteRequest.Sub(trip.tGotConn))
	}

	var serverWait time.Duration
	if !trip.tFirstRespByte.IsZero() {
		switch {
		case !trip.tWroteRequest.IsZero():
			serverWait = clampPositiveDuration(trip.tFirstRespByte.Sub(trip.tWroteRequest))
		case trip.gotConn:
			serverWait = clampPositiveDuration(trip.tFirstRespByte.Sub(trip.tGotConn))
		default:
			serverWait = clampPositiveDuration(trip.tFirstRespByte.Sub(trip.tripStart))
		}
	}

	dnsDur := trip.dnsDur
	connectDur := trip.connectDur
	tlsDur := trip.tlsDur
	firstRespByte := trip.tFirstRespByte
	gotConn := trip.gotConn
	connReused := trip.connReused
	connWasIdle := trip.connWasIdle
	connIdleDur := trip.connIdleDur
	trip.mu.Unlock()

	tr.mu.Lock()
	tr.dnsDur += dnsDur
	tr.connectDur += connectDur
	tr.tlsDur += tlsDur
	tr.connAcquireDur += connAcquire
	tr.requestWriteDur += reqWrite
	tr.serverWaitDur += serverWait
	if !firstRespByte.IsZero() {
		tr.lastFirstRespByte = firstRespByte
	}
	if gotConn {
		tr.connReused = connReused
		tr.connWasIdle = connWasIdle
		tr.connIdleDur = connIdleDur
	}
	tr.mu.Unlock()
}

func (r *UsageReporter) buildTimingBreakdown(now time.Time, ttft time.Duration, hasTTFT bool) *usage.TimingBreakdown {
	if r == nil {
		return nil
	}

	r.ttftMu.RLock()
	firstSendAt := r.firstSendAt
	r.ttftMu.RUnlock()

	r.timing.mu.Lock()
	roundTrips := r.timing.roundTrips
	requestBytes := r.timing.requestBytes
	dnsDur := r.timing.dnsDur
	connectDur := r.timing.connectDur
	tlsDur := r.timing.tlsDur
	connAcquireDur := r.timing.connAcquireDur
	requestWriteDur := r.timing.requestWriteDur
	serverWaitDur := r.timing.serverWaitDur
	lastFirstRespByte := r.timing.lastFirstRespByte
	connReused := r.timing.connReused
	connWasIdle := r.timing.connWasIdle
	connIdleDur := r.timing.connIdleDur
	transport := r.timing.upstreamTransport
	r.timing.mu.Unlock()

	if transport == "" && strings.Contains(strings.ToLower(r.executorType), "websocket") {
		transport = "websocket"
	}

	tb := &usage.TimingBreakdown{
		DNSMS:             durationToMS(dnsDur),
		ConnectMS:         durationToMS(connectDur),
		TLSMS:             durationToMS(tlsDur),
		ConnAcquireMS:     durationToMS(connAcquireDur),
		RequestWriteMS:    durationToMS(requestWriteDur),
		ServerWaitMS:      durationToMS(serverWaitDur),
		ConnReused:        connReused,
		ConnWasIdle:       connWasIdle,
		ConnIdleMS:        durationToMS(connIdleDur),
		RequestBytes:      requestBytes,
		RoundTrips:        roundTrips,
		UpstreamTransport: transport,
	}

	if !r.inboundStart.IsZero() && !r.requestedAt.IsZero() && !r.requestedAt.Before(r.inboundStart) {
		tb.InboundQueueMS = durationToMS(r.requestedAt.Sub(r.inboundStart))
	}
	if !firstSendAt.IsZero() && !r.requestedAt.IsZero() && !firstSendAt.Before(r.requestedAt) {
		tb.CPAOverheadMS = durationToMS(firstSendAt.Sub(r.requestedAt))
	}

	if hasTTFT && !firstSendAt.IsZero() {
		ttftAt := firstSendAt.Add(ttft)
		if !lastFirstRespByte.IsZero() && ttftAt.After(lastFirstRespByte) {
			tb.FirstTokenWaitMS = durationToMS(ttftAt.Sub(lastFirstRespByte))
		}
		if now.After(ttftAt) {
			tb.StreamTransferMS = durationToMS(now.Sub(ttftAt))
		}
	} else if !lastFirstRespByte.IsZero() && now.After(lastFirstRespByte) {
		tb.StreamTransferMS = durationToMS(now.Sub(lastFirstRespByte))
	}

	if !tb.Valid() {
		return nil
	}
	return tb
}

func clampPositiveDuration(d time.Duration) time.Duration {
	if d < 0 {
		return 0
	}
	return d
}

func durationToMS(d time.Duration) int64 {
	if d <= 0 {
		return 0
	}
	return d.Milliseconds()
}
