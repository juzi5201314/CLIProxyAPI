package requestdb

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func TestBuildEntryMapsRecordFields(t *testing.T) {
	ctx := context.Background()
	ctx = internallogging.WithEndpoint(ctx, "POST /v1/chat/completions")
	// A canonical UUID survives session normalization unchanged.
	sessionUUID := "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
	ctx = internallogging.WithClientRequestMetadata(ctx, internallogging.ClientRequestMetadata{
		ClientIP:  "10.0.0.1",
		UserAgent: "ua",
		SessionID: sessionUUID,
		Headers:   internallogging.MaskedHeaderClone(http.Header{"Authorization": {"Bearer secret"}}),
	})
	// The context carries the client-requested effort; the record carries the
	// post-translation effort actually sent upstream.
	ctx = coreusage.WithReasoningEffort(ctx, "xhigh")
	ctx = coreusage.WithStream(ctx, true)

	record := coreusage.Record{
		RequestID:       "exec-1",
		TraceID:         "trace-1",
		Provider:        "codex",
		ExecutorType:    "codex",
		Model:           "gpt-upstream",
		Alias:           "gpt-alias",
		ResponseModel:   "gpt-reported",
		ReasoningEffort: "high",
		ServiceTier:     "auto",
		Stream:          false,
		RequestedAt:     time.UnixMilli(1000),
		Latency:         150 * time.Millisecond,
		TTFT:            30 * time.Millisecond,
		APIKey:          "key-1",
		IsNativeKey:     true,
		Detail: coreusage.Detail{
			InputTokens:  10,
			OutputTokens: 5,
			TotalTokens:  15,
		},
	}

	entry := buildEntry(ctx, record)

	if entry.RequestedAtMS != 1000 {
		t.Fatalf("RequestedAtMS = %d, want 1000", entry.RequestedAtMS)
	}
	if entry.RequestID != "exec-1" || entry.TraceID != "trace-1" {
		t.Fatalf("request/trace id mismatch: %q %q", entry.RequestID, entry.TraceID)
	}
	if entry.Endpoint != "POST /v1/chat/completions" {
		t.Fatalf("Endpoint = %q", entry.Endpoint)
	}
	if entry.SessionID != sessionUUID {
		t.Fatalf("SessionID = %q, want %q", entry.SessionID, sessionUUID)
	}
	// Requested effort comes from context, translated effort from the record.
	if entry.RequestedReasoningEffort != "xhigh" || entry.ReasoningEffort != "high" {
		t.Fatalf("effort mismatch: requested=%q translated=%q", entry.RequestedReasoningEffort, entry.ReasoningEffort)
	}
	// Stream is true when either the record or the context says so.
	if !entry.Stream {
		t.Fatal("Stream = false, want true (from context)")
	}
	if entry.Failed || entry.StatusCode != 200 {
		t.Fatalf("success entry = failed=%v status=%d, want false/200", entry.Failed, entry.StatusCode)
	}
	if entry.InputTokens != 10 || entry.OutputTokens != 5 || entry.TotalTokens != 15 {
		t.Fatalf("token counts mismatch: %+v", entry)
	}
	if entry.TokenBreakdown == nil || !strings.Contains(string(entry.TokenBreakdown), `"total_tokens":15`) {
		t.Fatalf("TokenBreakdown = %s", entry.TokenBreakdown)
	}
	var headers map[string][]string
	if err := json.Unmarshal(entry.RequestHeaders, &headers); err != nil {
		t.Fatalf("RequestHeaders not valid JSON: %v", err)
	}
	if got := headers["Authorization"][0]; strings.Contains(got, "secret") {
		t.Fatalf("request headers not masked: %q", got)
	}
}

func TestBuildEntryFailureStatus(t *testing.T) {
	ctx := internallogging.WithResponseStatusHolder(context.Background())
	internallogging.SetResponseStatus(ctx, 502)

	record := coreusage.Record{
		RequestedAt: time.UnixMilli(1000),
		Failed:      true,
		Fail:        coreusage.Failure{StatusCode: 0, Body: strings.Repeat("x", 100)},
	}
	entry := buildEntry(ctx, record)
	if !entry.Failed || entry.StatusCode != 502 {
		t.Fatalf("failed entry = failed=%v status=%d, want true/502 (from response status)", entry.Failed, entry.StatusCode)
	}
	if len(entry.ErrorBody) != 100 {
		t.Fatalf("ErrorBody length = %d, want 100", len(entry.ErrorBody))
	}

	// Explicit failure status wins over the downstream response status.
	record.Fail.StatusCode = 429
	entry = buildEntry(ctx, record)
	if entry.StatusCode != 429 {
		t.Fatalf("StatusCode = %d, want 429", entry.StatusCode)
	}
}

func TestBuildEntryTruncatesErrorBody(t *testing.T) {
	cfgErrorBodyMax.Store(8192)
	record := coreusage.Record{
		RequestedAt: time.UnixMilli(1000),
		Failed:      true,
		Fail:        coreusage.Failure{StatusCode: 500, Body: strings.Repeat("y", 10000)},
	}
	entry := buildEntry(context.Background(), record)
	if len(entry.ErrorBody) != 8192 {
		t.Fatalf("ErrorBody length = %d, want 8192", len(entry.ErrorBody))
	}
}

func TestBuildEntryCapturesPreviews(t *testing.T) {
	ctx := internallogging.WithContentPreviewHolder(context.Background(), 8)
	holder := internallogging.GetContentPreviewHolder(ctx)
	holder.SetRequestPreview([]byte("0123456789"))
	holder.AppendResponsePreview([]byte("abcdefghijk"))

	record := coreusage.Record{RequestedAt: time.UnixMilli(1000)}
	entry := buildEntry(ctx, record)
	if string(entry.RequestPreview) != "01234567" {
		t.Fatalf("RequestPreview = %q, want 01234567", entry.RequestPreview)
	}
	if string(entry.ResponsePreview) != "abcdefgh" {
		t.Fatalf("ResponsePreview = %q, want abcdefgh", entry.ResponsePreview)
	}

	// Without a holder, previews stay nil.
	entry = buildEntry(context.Background(), coreusage.Record{RequestedAt: time.UnixMilli(1000)})
	if entry.RequestPreview != nil || entry.ResponsePreview != nil {
		t.Fatalf("previews without holder = %q/%q, want nil", entry.RequestPreview, entry.ResponsePreview)
	}
}

func TestBuildEntryNormalizesTotalInputTokensForIndependentAccounting(t *testing.T) {
	record := coreusage.Record{
		Provider:     "claude",
		ExecutorType: "claude",
		RequestedAt:  time.UnixMilli(1000),
		Detail: coreusage.Detail{
			InputTokens:         0,
			OutputTokens:        5947,
			CacheReadTokens:     266072,
			CacheCreationTokens: 100,
			TotalTokens:         272119,
			TokenBreakdown: coreusage.NewIndependentTokenBreakdown(
				0,
				266072,
				100,
				5947,
				0,
				272119,
			),
		},
	}

	entry := buildEntry(context.Background(), record)

	// Total input should be uncached (0) + cacheRead (266072) + cacheCreation (100) = 266172
	if entry.InputTokens != 266172 {
		t.Fatalf("InputTokens = %d, want 266172", entry.InputTokens)
	}
	if entry.OutputTokens != 5947 {
		t.Fatalf("OutputTokens = %d, want 5947", entry.OutputTokens)
	}
	if entry.TotalTokens != 272119 {
		t.Fatalf("TotalTokens = %d, want 272119", entry.TotalTokens)
	}
}

func TestBuildEntryMapsTimingBreakdown(t *testing.T) {
	record := coreusage.Record{
		RequestedAt: time.UnixMilli(1000),
		Timing: &coreusage.TimingBreakdown{
			InboundQueueMS:    12,
			CPAOverheadMS:     8,
			DNSMS:             5,
			ConnectMS:         20,
			TLSMS:             35,
			ConnAcquireMS:     60,
			RequestWriteMS:    45,
			ServerWaitMS:      300,
			FirstTokenWaitMS:  15,
			StreamTransferMS:  900,
			ConnReused:        false,
			RequestBytes:      2048,
			RoundTrips:        1,
			UpstreamTransport: "http",
		},
	}

	entry := buildEntry(context.Background(), record)
	if len(entry.TimingBreakdown) == 0 {
		t.Fatal("TimingBreakdown = empty, want serialized JSON")
	}
	var decoded coreusage.TimingBreakdown
	if err := json.Unmarshal(entry.TimingBreakdown, &decoded); err != nil {
		t.Fatalf("json.Unmarshal(TimingBreakdown): %v", err)
	}
	if decoded.ConnAcquireMS != 60 || decoded.RequestWriteMS != 45 || decoded.ServerWaitMS != 300 || decoded.RequestBytes != 2048 {
		t.Fatalf("decoded TimingBreakdown = %+v", decoded)
	}

	emptyEntry := buildEntry(context.Background(), coreusage.Record{
		RequestedAt: time.UnixMilli(1000),
		Timing:      &coreusage.TimingBreakdown{},
	})
	if len(emptyEntry.TimingBreakdown) != 0 {
		t.Fatalf("empty TimingBreakdown = %s, want nil", emptyEntry.TimingBreakdown)
	}
}
