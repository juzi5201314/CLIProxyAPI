package requestdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "requestlog.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if errClose := store.Close(); errClose != nil {
			t.Fatalf("Close() error = %v", errClose)
		}
	})
	return store, path
}

func sampleEntry(requestID string, requestedAtMS int64) Entry {
	return Entry{
		RequestedAtMS:            requestedAtMS,
		RequestID:                requestID,
		TraceID:                  "trace-1",
		Endpoint:                 "POST /v1/chat/completions",
		ClientIP:                 "127.0.0.1",
		UserAgent:                "test-agent",
		SessionID:                "session-1",
		APIKey:                   "key-1",
		IsNativeKey:              true,
		Provider:                 "codex",
		ExecutorType:             "codex",
		AuthID:                   "auth-1",
		Model:                    "gpt-test",
		Alias:                    "gpt-test-alias",
		ResponseModel:            "gpt-test-upstream",
		ReasoningEffort:          "high",
		RequestedReasoningEffort: "xhigh",
		ServiceTier:              "auto",
		Generate:                 true,
		Stream:                   true,
		Failed:                   false,
		StatusCode:               200,
		LatencyMS:                123,
		TTFTMS:                   45,
		InputTokens:              100,
		OutputTokens:             50,
		ReasoningTokens:          20,
		CachedTokens:             10,
		CacheReadTokens:          8,
		CacheCreationTokens:      2,
		TotalTokens:              150,
		TokenBreakdown:           []byte(`{"input":{"total":100}}`),
		RequestHeaders:           []byte(`{"Authorization":["Bearer ***"]}`),
		ResponseHeaders:          []byte(`{"Content-Type":["application/json"]}`),
	}
}

func TestStoreMigrateIsIdempotent(t *testing.T) {
	_, path := openTestStore(t)
	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("re-Open() on migrated database error = %v", err)
	}
	if errClose := reopened.Close(); errClose != nil {
		t.Fatalf("re-Open Close() error = %v", errClose)
	}
}

func TestStoreMigrateV2UpdatesLegacyTokenCounts(t *testing.T) {
	store, path := openTestStore(t)
	// Force database back to schema version 1 and insert a legacy row with uncached input = 0 and cache read = 266072
	if _, err := store.db.Exec(`DELETE FROM schema_version`); err != nil {
		t.Fatalf("clear schema_version: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO schema_version (version) VALUES (1)`); err != nil {
		t.Fatalf("insert schema v1: %v", err)
	}
	if _, err := store.db.Exec(`
		INSERT INTO request_logs (
			requested_at, request_id, provider, executor_type, model,
			input_tokens, output_tokens, cached_tokens, cache_read_tokens, total_tokens
		) VALUES (
			1000, 'legacy-1', 'claude', 'claude', 'claude-3-5-sonnet',
			0, 5000, 266072, 266072, 271072
		);
	`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	// Re-opening triggers migrate() which upgrades to schema v2
	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("re-Open store: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	var inputTokens, outputTokens, totalTokens int64
	if err := reopened.db.QueryRow(`
		SELECT input_tokens, output_tokens, total_tokens
		FROM request_logs WHERE request_id = 'legacy-1'
	`).Scan(&inputTokens, &outputTokens, &totalTokens); err != nil {
		t.Fatalf("query migrated row: %v", err)
	}

	if inputTokens != 266072 {
		t.Fatalf("migrated input_tokens = %d, want 266072", inputTokens)
	}
	if outputTokens != 5000 {
		t.Fatalf("output_tokens = %d, want 5000", outputTokens)
	}
	if totalTokens != 271072 {
		t.Fatalf("total_tokens = %d, want 271072", totalTokens)
	}
}

func TestStoreInsertBatchAndQueryRoundtrip(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
		sampleEntry("req-3", 3000),
	}
	entries[2].Failed = true
	entries[2].StatusCode = 502
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	total, err := store.Count(ctx, Query{})
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if total != 3 {
		t.Fatalf("Count() = %d, want 3", total)
	}

	got, err := store.Query(ctx, Query{Limit: 10, Offset: 0})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("Query() returned %d entries, want 3", len(got))
	}
	// Newest first.
	if got[0].RequestID != "req-3" || got[2].RequestID != "req-1" {
		t.Fatalf("Query() order = [%s, %s, %s], want newest first", got[0].RequestID, got[1].RequestID, got[2].RequestID)
	}
	if got[0].RequestedAtMS != 3000 {
		t.Fatalf("RequestedAtMS = %d, want 3000", got[0].RequestedAtMS)
	}
	if !got[0].Stream || !got[0].IsNativeKey || got[0].RequestedReasoningEffort != "xhigh" {
		t.Fatalf("Query() roundtrip lost scalar fields: %+v", got[0])
	}
	if got[0].TokenBreakdown != nil || got[0].RequestHeaders != nil {
		t.Fatalf("list query should not return blob columns, got %+v", got[0])
	}
}

func TestStoreQueryFilters(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
		sampleEntry("req-3", 3000),
	}
	entries[1].Model = "other-model"
	entries[1].Provider = "claude"
	entries[2].Model = "third-model"
	entries[2].Provider = "gemini"
	entries[2].Failed = true
	entries[2].StatusCode = 502
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	cases := []struct {
		name    string
		query   Query
		wantIDs []string
	}{
		{"model", Query{Model: "gpt-test", Limit: 10}, []string{"req-1"}},
		{"model-substring", Query{Model: "pt-tes", Limit: 10}, []string{"req-1"}},
		{"model-substring-no-match", Query{Model: "claude-opus", Limit: 10}, nil},
		{"provider", Query{Provider: "claude", Limit: 10}, []string{"req-2"}},
		{"failed", Query{Failed: boolPtr(true), Limit: 10}, []string{"req-3"}},
		{"not-failed", Query{Failed: boolPtr(false), Limit: 10}, []string{"req-2", "req-1"}},
		{"status", Query{StatusCode: 502, Limit: 10}, []string{"req-3"}},
		{"time-range", Query{FromMS: 1500, ToMS: 2500, Limit: 10}, []string{"req-2"}},
		{"request-id", Query{RequestID: "req-1", Limit: 10}, []string{"req-1"}},
		{"request-id-substring", Query{RequestID: "eq-2", Limit: 10}, []string{"req-2"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := store.Query(ctx, tc.query)
			if err != nil {
				t.Fatalf("Query() error = %v", err)
			}
			if len(got) != len(tc.wantIDs) {
				t.Fatalf("Query() matched %d entries, want %d (%v)", len(got), len(tc.wantIDs), tc.wantIDs)
			}
			for i, want := range tc.wantIDs {
				if got[i].RequestID != want {
					t.Fatalf("Query() result[%d] = %s, want %s", i, got[i].RequestID, want)
				}
			}
		})
	}
}

func TestStoreQueryFiltersEscapeLikeWildcards(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("req-1", 1000),
		sampleEntry("req-2", 2000),
	}
	entries[0].Model = "model_100%"
	entries[1].Model = "modelX100Y"
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	// An underscore in the input must match literally, not as a single-char wildcard.
	got, err := store.Query(ctx, Query{Model: "model_100", Limit: 10})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 1 || got[0].RequestID != "req-1" {
		t.Fatalf("Query(model_100) matched %v, want only req-1", requestIDs(got))
	}

	// A percent sign must match literally instead of any suffix.
	got, err = store.Query(ctx, Query{Model: "100%", Limit: 10})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(got) != 1 || got[0].RequestID != "req-1" {
		t.Fatalf("Query(100%%) matched %v, want only req-1", requestIDs(got))
	}
}

func requestIDs(entries []Entry) []string {
	ids := make([]string, 0, len(entries))
	for i := range entries {
		ids = append(ids, entries[i].RequestID)
	}
	return ids
}

func TestStoreGetByIDDecompressesBlobs(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entry := sampleEntry("req-1", 1000)
	compressed := []Entry{entry}
	// Simulate the writer pipeline: blobs are stored compressed.
	for i := range compressed {
		compressed[i].TokenBreakdown = compressBlob(entry.TokenBreakdown)
		compressed[i].RequestHeaders = compressBlob(entry.RequestHeaders)
		compressed[i].ResponseHeaders = compressBlob(entry.ResponseHeaders)
		compressed[i].ErrorBody = compressBlob([]byte("upstream exploded"))
	}
	if err := store.InsertBatch(ctx, compressed); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	got, err := store.Query(ctx, Query{Limit: 1})
	if err != nil || len(got) != 1 {
		t.Fatalf("Query() = %d entries, error %v", len(got), err)
	}

	detail, err := store.GetByID(ctx, got[0].ID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if detail == nil {
		t.Fatal("GetByID() = nil, want entry")
	}
	if detail.RequestID != "req-1" {
		t.Fatalf("RequestID = %q, want req-1", detail.RequestID)
	}
	var breakdown map[string]any
	if err := json.Unmarshal(detail.TokenBreakdown, &breakdown); err != nil {
		t.Fatalf("token breakdown blob is not valid JSON: %v", err)
	}
	var headers map[string][]string
	if err := json.Unmarshal(detail.RequestHeaders, &headers); err != nil {
		t.Fatalf("request headers blob is not valid JSON: %v", err)
	}
	if headers["Authorization"] == nil || headers["Authorization"][0] != "Bearer ***" {
		t.Fatalf("request headers roundtrip mismatch: %v", headers)
	}
	if string(detail.ErrorBody) != "upstream exploded" {
		t.Fatalf("ErrorBody = %q, want upstream exploded", detail.ErrorBody)
	}

	missing, err := store.GetByID(ctx, 99999)
	if err != nil || missing != nil {
		t.Fatalf("GetByID(missing) = %v, %v; want nil, nil", missing, err)
	}
}

func TestStoreDeleteBefore(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	entries := []Entry{
		sampleEntry("old-1", 100),
		sampleEntry("old-2", 200),
		sampleEntry("new-1", 9000),
	}
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	deleted, err := store.DeleteBefore(ctx, 1000)
	if err != nil {
		t.Fatalf("DeleteBefore() error = %v", err)
	}
	if deleted != 2 {
		t.Fatalf("DeleteBefore() deleted %d rows, want 2", deleted)
	}
	total, err := store.Count(ctx, Query{})
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("Count() after retention = %d, want 1", total)
	}
}

func boolPtr(v bool) *bool {
	return &v
}

func TestStoreQueryMultiSelect(t *testing.T) {
	store, _ := openTestStore(t)
	ctx := context.Background()

	e1 := sampleEntry("req-1", 1000)
	e1.Model = "gpt-4o"
	e1.Provider = "openai"

	e2 := sampleEntry("req-2", 2000)
	e2.Model = "claude-3-5-sonnet"
	e2.Provider = "anthropic"

	e3 := sampleEntry("req-3", 3000)
	e3.Model = "deepseek-chat"
	e3.Provider = "deepseek"

	if err := store.InsertBatch(ctx, []Entry{e1, e2, e3}); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	// Test multi-model filter
	got, err := store.Query(ctx, Query{Models: []string{"gpt-4o", "deepseek-chat"}})
	if err != nil {
		t.Fatalf("Query(Models) error = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Query(Models) returned %d entries, want 2", len(got))
	}

	// Test multi-provider filter
	gotP, err := store.Query(ctx, Query{Providers: []string{"anthropic"}})
	if err != nil {
		t.Fatalf("Query(Providers) error = %v", err)
	}
	if len(gotP) != 1 || gotP[0].RequestID != "req-2" {
		t.Fatalf("Query(Providers) returned unexpected result: %v", gotP)
	}
}

func TestStoreCleanupAndStorageInfo(t *testing.T) {
	store, dbPath := openTestStore(t)
	ctx := context.Background()

	e1 := sampleEntry("clean-1", 1000)
	e1.Failed = true
	e1.TokenBreakdown = nil
	e1.RequestHeaders = compressBlob([]byte(`{"authorization": "bearer foo"}`))
	e1.ResponseHeaders = nil

	e2 := sampleEntry("clean-2", 2000)
	e2.Failed = false
	e2.TokenBreakdown = nil
	e2.RequestHeaders = compressBlob([]byte(`{"user-agent": "test-client"}`))
	e2.ResponseHeaders = compressBlob([]byte(`{"content-type": "application/json"}`))

	e3 := sampleEntry("clean-3", 5000)
	e3.Failed = false
	e3.TokenBreakdown = nil
	e3.RequestHeaders = nil
	e3.ResponseHeaders = nil
	e3.ErrorBody = nil
	e3.RequestPreview = nil
	e3.ResponsePreview = nil

	if err := store.InsertBatch(ctx, []Entry{e1, e2, e3}); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	info, err := store.StorageInfo(ctx, dbPath, 30)
	if err != nil {
		t.Fatalf("StorageInfo() error = %v", err)
	}
	if info.TotalRecords != 3 {
		t.Errorf("StorageInfo.TotalRecords = %d, want 3", info.TotalRecords)
	}
	if info.FailedRecords != 1 {
		t.Errorf("StorageInfo.FailedRecords = %d, want 1", info.FailedRecords)
	}
	if info.PayloadRecords != 2 {
		t.Errorf("StorageInfo.PayloadRecords = %d, want 2", info.PayloadRecords)
	}
	if info.TotalFileSizeBytes <= 0 {
		t.Errorf("StorageInfo.TotalFileSizeBytes = %d, want > 0", info.TotalFileSizeBytes)
	}

	// 1. DeleteFailed
	deletedFailed, err := store.DeleteFailed(ctx, 0)
	if err != nil {
		t.Fatalf("DeleteFailed() error = %v", err)
	}
	if deletedFailed != 1 {
		t.Errorf("DeleteFailed() deleted %d rows, want 1", deletedFailed)
	}

	// 2. StripPayloads
	stripped, err := store.StripPayloads(ctx, 0)
	if err != nil {
		t.Fatalf("StripPayloads() error = %v", err)
	}
	if stripped != 1 {
		t.Errorf("StripPayloads() affected %d rows, want 1", stripped)
	}

	// Verify row still exists but headers are stripped
	remaining, err := store.Count(ctx, Query{})
	if err != nil || remaining != 2 {
		t.Fatalf("Count() = %d, want 2", remaining)
	}
	detail, err := store.GetByID(ctx, 2)
	if err != nil || detail == nil {
		t.Fatalf("GetByID(2) error = %v", err)
	}
	if len(detail.RequestHeaders) != 0 || len(detail.ResponseHeaders) != 0 {
		t.Errorf("GetByID(2) headers not stripped: %v, %v", detail.RequestHeaders, detail.ResponseHeaders)
	}

	// 3. Vacuum
	if err := store.Vacuum(ctx); err != nil {
		t.Fatalf("Vacuum() error = %v", err)
	}

	// 4. ClearAll
	cleared, err := store.ClearAll(ctx)
	if err != nil {
		t.Fatalf("ClearAll() error = %v", err)
	}
	if cleared != 2 {
		t.Errorf("ClearAll() deleted %d rows, want 2", cleared)
	}
}

func TestStoreTimingBreakdownRoundTripAndMigrationV5(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "legacy_v4.db")

	// Seed a schema v4 database without timing_breakdown_zst, then reopen via Open() to test v4 -> v5 migration.
	rawDB, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	for _, stmt := range []string{
		`CREATE TABLE schema_version (version INTEGER NOT NULL)`,
		schemaV1,
		`ALTER TABLE request_logs ADD COLUMN provider_name TEXT NOT NULL DEFAULT ''`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_provider_auth ON request_logs (provider, auth_id)`,
		`INSERT INTO schema_version (version) VALUES (4)`,
	} {
		if _, errExec := rawDB.Exec(stmt); errExec != nil {
			_ = rawDB.Close()
			t.Fatalf("seed v4 schema (%s): %v", stmt, errExec)
		}
	}
	if errClose := rawDB.Close(); errClose != nil {
		t.Fatalf("rawDB.Close: %v", errClose)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open(legacy v4) error = %v", err)
	}
	defer func() {
		if errClose := store.Close(); errClose != nil {
			t.Fatalf("store.Close: %v", errClose)
		}
	}()

	rawTiming := []byte(`{"cpa_overhead_ms":7,"conn_acquire_ms":120,"request_write_ms":55,"server_wait_ms":410,"stream_transfer_ms":1200,"round_trips":1,"upstream_transport":"http"}`)
	e := sampleEntry("timing-1", 5000)
	e.TokenBreakdown = nil
	e.RequestHeaders = nil
	e.ResponseHeaders = nil
	e.ErrorBody = nil
	e.RequestPreview = nil
	e.ResponsePreview = nil
	e.TimingBreakdown = compressBlob(rawTiming)
	if err := store.InsertBatch(ctx, []Entry{e}); err != nil {
		t.Fatalf("InsertBatch() error = %v", err)
	}

	detail, err := store.GetByID(ctx, 1)
	if err != nil || detail == nil {
		t.Fatalf("GetByID(1) = %v, %v", detail, err)
	}
	if string(detail.TimingBreakdown) != string(rawTiming) {
		t.Fatalf("GetByID(1).TimingBreakdown = %s, want %s", detail.TimingBreakdown, rawTiming)
	}

	// List queries stay lightweight and omit blob columns.
	listed, err := store.Query(ctx, Query{})
	if err != nil || len(listed) != 1 {
		t.Fatalf("Query() = %d, %v", len(listed), err)
	}
	if len(listed[0].TimingBreakdown) != 0 {
		t.Fatalf("Query()[0].TimingBreakdown = %s, want empty", listed[0].TimingBreakdown)
	}

	stripped, err := store.StripPayloads(ctx, 0)
	if err != nil || stripped != 1 {
		t.Fatalf("StripPayloads() = %d, %v, want 1", stripped, err)
	}
	afterStrip, err := store.GetByID(ctx, 1)
	if err != nil || afterStrip == nil {
		t.Fatalf("GetByID(1) after strip = %v, %v", afterStrip, err)
	}
	if len(afterStrip.TimingBreakdown) != 0 {
		t.Fatalf("TimingBreakdown after StripPayloads = %s, want empty", afterStrip.TimingBreakdown)
	}
}
