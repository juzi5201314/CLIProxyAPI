package helps

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"sync/atomic"
	"testing"
	"time"

	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func TestUsageReporterCapturesHTTPTimingBreakdownAndConnReuse(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	baseClient := srv.Client()
	payload := []byte(`{"messages":[{"role":"user","content":"hello world"}]}`)

	// First request establishes a fresh TLS connection and preserves any existing ClientTrace.
	var outerGotConn atomic.Int32
	ctx1 := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
		GotConn: func(httptrace.GotConnInfo) {
			outerGotConn.Add(1)
		},
	})
	reporter1 := NewUsageReporter(ctx1, "openai", "gpt-5.4", nil)
	client1 := reporter1.TrackHTTPClient(baseClient)
	req1, err := http.NewRequestWithContext(ctx1, http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequestWithContext(1): %v", err)
	}
	resp1, err := client1.Do(req1)
	if err != nil {
		t.Fatalf("client1.Do: %v", err)
	}
	_, _ = io.ReadAll(resp1.Body)
	_ = resp1.Body.Close()

	rec1 := reporter1.buildRecord(usage.Detail{OutputTokens: 1}, false)
	if rec1.Timing == nil {
		t.Fatal("rec1.Timing = nil, want populated timing breakdown")
	}
	if rec1.Timing.UpstreamTransport != "http" {
		t.Errorf("rec1.Timing.UpstreamTransport = %q, want http", rec1.Timing.UpstreamTransport)
	}
	if rec1.Timing.RoundTrips != 1 {
		t.Errorf("rec1.Timing.RoundTrips = %d, want 1", rec1.Timing.RoundTrips)
	}
	if rec1.Timing.RequestBytes != int64(len(payload)) {
		t.Errorf("rec1.Timing.RequestBytes = %d, want %d", rec1.Timing.RequestBytes, len(payload))
	}
	if rec1.Timing.ConnReused {
		t.Errorf("rec1.Timing.ConnReused = true on cold connection, want false")
	}
	if outerGotConn.Load() != 1 {
		t.Errorf("outerGotConn = %d, want 1 (existing ClientTrace must be preserved)", outerGotConn.Load())
	}

	// Second request reuses the pooled connection from baseClient.Transport.
	reporter2 := NewUsageReporter(context.Background(), "openai", "gpt-5.4", nil)
	client2 := reporter2.TrackHTTPClient(baseClient)
	req2, err := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequestWithContext(2): %v", err)
	}
	resp2, err := client2.Do(req2)
	if err != nil {
		t.Fatalf("client2.Do: %v", err)
	}
	_, _ = io.ReadAll(resp2.Body)
	_ = resp2.Body.Close()

	rec2 := reporter2.buildRecord(usage.Detail{OutputTokens: 1}, false)
	if rec2.Timing == nil {
		t.Fatal("rec2.Timing = nil, want populated timing breakdown")
	}
	if !rec2.Timing.ConnReused {
		t.Errorf("rec2.Timing.ConnReused = false on pooled connection, want true")
	}
	if rec2.Timing.RoundTrips != 1 {
		t.Errorf("rec2.Timing.RoundTrips = %d, want 1", rec2.Timing.RoundTrips)
	}
}

func TestUsageReporterTimingBreakdownDeterministicPhases(t *testing.T) {
	base := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	ctx := internallogging.WithInboundStartTime(context.Background(), base)
	reporter := NewUsageReporter(ctx, "openai", "gpt-5.4", nil)
	// Anchor monotonic timestamps deterministically without wall-clock sleeps.
	reporter.inboundStart = base
	reporter.requestedAt = base.Add(120 * time.Millisecond)
	reporter.firstSendAt = base.Add(170 * time.Millisecond)

	reporter.timing.roundTrips = 2
	reporter.timing.upstreamTransport = "http"
	reporter.timing.requestBytes = 4096
	reporter.timing.dnsDur = 15 * time.Millisecond
	reporter.timing.connectDur = 40 * time.Millisecond
	reporter.timing.tlsDur = 65 * time.Millisecond
	reporter.timing.connAcquireDur = 130 * time.Millisecond
	reporter.timing.requestWriteDur = 80 * time.Millisecond
	reporter.timing.serverWaitDur = 500 * time.Millisecond
	reporter.timing.lastFirstRespByte = base.Add(880 * time.Millisecond)
	reporter.timing.connReused = true
	reporter.timing.connWasIdle = true
	reporter.timing.connIdleDur = 2500 * time.Millisecond

	ttft := 910 * time.Millisecond // firstSendAt + 910ms = base + 1080ms => FirstTokenWait = 200ms
	publishAt := base.Add(1880 * time.Millisecond)

	tb := reporter.buildTimingBreakdown(publishAt, ttft, true)
	if tb == nil {
		t.Fatal("buildTimingBreakdown() = nil, want non-nil")
	}
	if tb.InboundQueueMS != 120 {
		t.Errorf("InboundQueueMS = %d, want 120", tb.InboundQueueMS)
	}
	if tb.CPAOverheadMS != 50 {
		t.Errorf("CPAOverheadMS = %d, want 50", tb.CPAOverheadMS)
	}
	if tb.DNSMS != 15 || tb.ConnectMS != 40 || tb.TLSMS != 65 || tb.ConnAcquireMS != 130 {
		t.Errorf("conn timings = dns:%d connect:%d tls:%d acquire:%d, want 15/40/65/130", tb.DNSMS, tb.ConnectMS, tb.TLSMS, tb.ConnAcquireMS)
	}
	if tb.RequestWriteMS != 80 || tb.ServerWaitMS != 500 {
		t.Errorf("write/wait = %d/%d, want 80/500", tb.RequestWriteMS, tb.ServerWaitMS)
	}
	if tb.FirstTokenWaitMS != 200 {
		t.Errorf("FirstTokenWaitMS = %d, want 200", tb.FirstTokenWaitMS)
	}
	if tb.StreamTransferMS != 800 {
		t.Errorf("StreamTransferMS = %d, want 800", tb.StreamTransferMS)
	}
	if !tb.ConnReused || !tb.ConnWasIdle || tb.ConnIdleMS != 2500 {
		t.Errorf("conn reuse metadata = reused:%v idle:%v idleMS:%d", tb.ConnReused, tb.ConnWasIdle, tb.ConnIdleMS)
	}
	if tb.RoundTrips != 2 || tb.RequestBytes != 4096 || tb.UpstreamTransport != "http" {
		t.Errorf("meta = trips:%d bytes:%d transport:%q", tb.RoundTrips, tb.RequestBytes, tb.UpstreamTransport)
	}
}

func TestHTTPTripTimingConcurrentConnectSpansAndFailedDial(t *testing.T) {
	base := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	trip := newHTTPTripTiming(base)

	// Simulate two parallel Happy Eyeballs ConnectStart calls overlapping in time.
	trip.mu.Lock()
	trip.tGetConn = base
	trip.connectSpanStart = base
	trip.activeConnect = 2
	// First finishes while second is still active -> activeConnect drops to 1, span stays open.
	trip.activeConnect--
	// Second finishes -> activeConnect drops to 0, closes single wall span of 90ms.
	trip.activeConnect--
	trip.connectDur += 90 * time.Millisecond
	trip.connectSpanStart = time.Time{}
	trip.tGotConn = base.Add(100 * time.Millisecond)
	trip.gotConn = true
	trip.tWroteRequest = base.Add(150 * time.Millisecond)
	trip.tFirstRespByte = base.Add(400 * time.Millisecond)
	trip.mu.Unlock()

	var tracker httpTimingTracker
	tracker.finishTrip(trip, nil)

	if tracker.connectDur != 90*time.Millisecond {
		t.Fatalf("connectDur = %v, want 90ms", tracker.connectDur)
	}
	if tracker.connAcquireDur != 100*time.Millisecond {
		t.Fatalf("connAcquireDur = %v, want 100ms", tracker.connAcquireDur)
	}
	if tracker.requestWriteDur != 50*time.Millisecond {
		t.Fatalf("requestWriteDur = %v, want 50ms", tracker.requestWriteDur)
	}
	if tracker.serverWaitDur != 250*time.Millisecond {
		t.Fatalf("serverWaitDur = %v, want 250ms", tracker.serverWaitDur)
	}
}

func TestUsageReporterEmptyReturnsNilTiming(t *testing.T) {
	reporter := NewUsageReporter(context.Background(), "openai", "gpt-5.4", nil)
	rec := reporter.buildRecord(usage.Detail{}, false)
	if rec.Timing != nil {
		t.Fatalf("rec.Timing = %+v, want nil when no timing milestones were observed", rec.Timing)
	}
}
