package usage

// TimingBreakdown records per-phase durations (in milliseconds) for a single
// upstream execution attempt so local CPA proxy overhead can be separated from
// upstream connection setup, request upload, server wait, and streaming transfer.
type TimingBreakdown struct {
	// InboundQueueMS is elapsed time from when the HTTP server received the
	// inbound request until this executor attempt started (body read, auth,
	// routing, credential selection, and any prior retry attempts).
	// It precedes the attempt's LatencyMS window.
	InboundQueueMS int64 `json:"inbound_queue_ms,omitempty"`
	// CPAOverheadMS is local proxy preprocessing inside the executor before the
	// first upstream RoundTrip/send (translation, thinking, cloaking, payload rules).
	CPAOverheadMS int64 `json:"cpa_overhead_ms,omitempty"`
	// DNSMS is DNS lookup duration observed via httptrace.
	DNSMS int64 `json:"dns_ms,omitempty"`
	// ConnectMS is TCP/proxy dial duration observed via httptrace.
	ConnectMS int64 `json:"connect_ms,omitempty"`
	// TLSMS is TLS handshake duration observed via httptrace.
	TLSMS int64 `json:"tls_ms,omitempty"`
	// ConnAcquireMS is total wall time spent acquiring an upstream connection
	// (GetConn -> GotConn), including DNS, TCP, TLS, proxy tunnel, and pool wait.
	ConnAcquireMS int64 `json:"conn_acquire_ms,omitempty"`
	// RequestWriteMS is time spent writing request headers and body to the
	// upstream connection (GotConn -> WroteRequest).
	RequestWriteMS int64 `json:"request_write_ms,omitempty"`
	// ServerWaitMS is time from finishing request write until the first upstream
	// HTTP response header byte arrives (WroteRequest -> GotFirstResponseByte).
	ServerWaitMS int64 `json:"server_wait_ms,omitempty"`
	// FirstTokenWaitMS is time from the first response header byte until the
	// first substantive token or body byte recorded as TTFT.
	FirstTokenWaitMS int64 `json:"first_token_wait_ms,omitempty"`
	// StreamTransferMS is time from TTFT (or first response byte) until the
	// attempt finished and published usage.
	StreamTransferMS int64 `json:"stream_transfer_ms,omitempty"`

	// ConnReused reports whether the upstream connection was reused from a pool.
	ConnReused bool `json:"conn_reused,omitempty"`
	// ConnWasIdle reports whether a reused connection was previously idle.
	ConnWasIdle bool `json:"conn_was_idle,omitempty"`
	// ConnIdleMS is how long a reused idle connection had been idle.
	ConnIdleMS int64 `json:"conn_idle_ms,omitempty"`
	// RequestBytes is the outbound upstream request body size in bytes when known.
	RequestBytes int64 `json:"request_bytes,omitempty"`
	// RoundTrips counts HTTP RoundTrip invocations performed under this attempt.
	RoundTrips int `json:"round_trips,omitempty"`
	// UpstreamTransport identifies the upstream transport mode ("http", "websocket").
	UpstreamTransport string `json:"upstream_transport,omitempty"`
}

// Valid reports whether the breakdown contains any meaningful timing data.
func (t *TimingBreakdown) Valid() bool {
	if t == nil {
		return false
	}
	return t.InboundQueueMS > 0 ||
		t.CPAOverheadMS > 0 ||
		t.DNSMS > 0 ||
		t.ConnectMS > 0 ||
		t.TLSMS > 0 ||
		t.ConnAcquireMS > 0 ||
		t.RequestWriteMS > 0 ||
		t.ServerWaitMS > 0 ||
		t.FirstTokenWaitMS > 0 ||
		t.StreamTransferMS > 0 ||
		t.ConnReused ||
		t.RequestBytes > 0 ||
		t.RoundTrips > 0 ||
		t.UpstreamTransport != ""
}
