package requestdb

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MoeForge/moego/json"
)

func TestStoreProviderNameRoundTripAndFilter(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "requests.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	entries := []Entry{
		{
			RequestedAtMS: 1000,
			RequestID:     "req-named",
			Provider:      "claude",
			ProviderName:  "My Claude Relay",
			BaseURL:       "https://relay.example.com/v1",
			Model:         "claude-sonnet-4-6",
		},
		{
			RequestedAtMS: 2000,
			RequestID:     "req-unnamed",
			Provider:      "claude",
			BaseURL:       "https://other.example.com/v1",
			Model:         "claude-sonnet-4-6",
		},
	}
	if err := store.InsertBatch(ctx, entries); err != nil {
		t.Fatalf("InsertBatch: %v", err)
	}

	got, err := store.Query(ctx, Query{Provider: "My Claude", Limit: 10})
	if err != nil {
		t.Fatalf("Query(Provider=My Claude): %v", err)
	}
	if len(got) != 1 || got[0].RequestID != "req-named" || got[0].ProviderName != "My Claude Relay" {
		t.Fatalf("Query result = %+v, want single req-named with ProviderName=My Claude Relay", got)
	}

	detail, err := store.GetByID(ctx, got[0].ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if detail == nil || detail.ProviderName != "My Claude Relay" {
		t.Fatalf("GetByID ProviderName = %+v, want My Claude Relay", detail)
	}
}

func TestBreakdownSeparatesProviderInstancesAndFiltersRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	// Mix of multiple Codex OAuth accounts, named/unnamed Codex API keys (including
	// same base_url with different keys, and empty base_url with different keys),
	// plus renamed historical+current rows sharing one auth_id, and OpenAI-compat.
	entries := []Entry{
		// Codex OAuth account 1 (2 requests)
		{
			RequestedAtMS: 1000, RequestID: "r1", Provider: "codex", AuthType: "oauth",
			AuthID: "codex-alice@gmail.com.json", Source: "alice@gmail.com", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 1000, OutputTokens: 500, TotalTokens: 1500, LatencyMS: 1000,
		},
		{
			RequestedAtMS: 1100, RequestID: "r2", Provider: "codex", AuthType: "oauth",
			AuthID: "codex-alice@gmail.com.json", Source: "alice@gmail.com", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 500, OutputTokens: 250, TotalTokens: 750, LatencyMS: 500,
		},
		// Codex OAuth account 2 (1 request)
		{
			RequestedAtMS: 1200, RequestID: "r3", Provider: "codex", AuthType: "oauth",
			AuthID: "codex-bob@gmail.com.json", Source: "bob@gmail.com", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 400, OutputTokens: 100, TotalTokens: 500, LatencyMS: 400,
		},
		// Codex OAuth account 3 without email (source fell back to client api_key!)
		{
			RequestedAtMS: 1250, RequestID: "r3b", Provider: "codex", AuthType: "oauth",
			AuthID: "codex-work.json", Source: "client-k1", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 200, OutputTokens: 100, TotalTokens: 300, LatencyMS: 300,
		},
		// Codex API key 1: historical row (unnamed) + newer row (named "千刀") sharing the same auth_id
		{
			RequestedAtMS: 1300, RequestID: "r4", Provider: "codex", AuthType: "apikey",
			AuthID: "codex:apikey:aaaa11112222", BaseURL: "https://api666.zzzcoding.org/v1",
			Source: "sk-qd-secret-1111", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 300, OutputTokens: 150, TotalTokens: 450, LatencyMS: 600,
		},
		{
			RequestedAtMS: 1400, RequestID: "r5", Provider: "codex", AuthType: "apikey",
			AuthID: "codex:apikey:aaaa11112222", ProviderName: "千刀", BaseURL: "https://api666.zzzcoding.org/v1",
			Source: "sk-qd-secret-1111", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 300, OutputTokens: 150, TotalTokens: 450, LatencyMS: 600,
		},
		// Two unnamed Codex API keys on the SAME base_url with DIFFERENT keys -> must stay separate & disambiguated
		{
			RequestedAtMS: 1500, RequestID: "r6", Provider: "codex", AuthType: "apikey",
			AuthID: "codex:apikey:bbbb11112222", BaseURL: "https://relay.foo.com/v1",
			Source: "sk-foo-first-1111", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 200, OutputTokens: 100, TotalTokens: 300, LatencyMS: 500,
		},
		{
			RequestedAtMS: 1600, RequestID: "r7", Provider: "codex", AuthType: "apikey",
			AuthID: "codex:apikey:cccc11112222", BaseURL: "https://relay.foo.com/v1",
			Source: "sk-foo-second-2222", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 200, OutputTokens: 100, TotalTokens: 300, LatencyMS: 500,
		},
		// Unnamed Codex API key with empty base_url -> labeled by masked key, never raw secret
		{
			RequestedAtMS: 1700, RequestID: "r8", Provider: "codex", AuthType: "apikey",
			AuthID: "codex:apikey:dddd11112222", Source: "sk-direct-supersecret-9999", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 100, OutputTokens: 50, TotalTokens: 150, LatencyMS: 300,
		},
		// OpenAI-compatible provider
		{
			RequestedAtMS: 1800, RequestID: "r9", Provider: "openai-compatible-openrouter", AuthType: "apikey",
			AuthID: "openai-compatibility:openrouter:eeee11112222", ProviderName: "OpenRouter",
			BaseURL: "https://openrouter.ai/api/v1", Source: "sk-or-secret-8888", APIKey: "client-k1",
			Model: "gpt-5.4", InputTokens: 100, OutputTokens: 50, TotalTokens: 150, LatencyMS: 300,
		},
	}
	mustInsertBatch(t, store, entries)

	// 1. Stats.UniqueProviders must count 8 distinct provider instances, not 2 provider types.
	st, err := store.Stats(ctx, Query{})
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if st.UniqueProviders != 8 {
		t.Fatalf("UniqueProviders = %d, want 8", st.UniqueProviders)
	}

	// 2. Breakdown("provider") returns all 8 distinct provider instances with clean, non-colliding labels.
	rows, err := store.Breakdown(ctx, Query{}, "provider", 20)
	if err != nil {
		t.Fatalf("Breakdown(provider): %v", err)
	}
	if len(rows) != 8 {
		t.Fatalf("Breakdown(provider) rows = %d, want 8: %+v", len(rows), rows)
	}

	byAuthID := make(map[string]BreakdownRow, len(rows))
	seenLabels := make(map[string]string, len(rows))
	for _, row := range rows {
		byAuthID[row.AuthID] = row
		if prev, dup := seenLabels[row.Label]; dup {
			t.Errorf("duplicate provider breakdown label %q for %s and %s", row.Label, prev, row.Key)
		}
		seenLabels[row.Label] = row.Key

		// Ensure raw API key secrets never serialize into JSON.
		rawJSON, errMarshal := json.Marshal(row)
		if errMarshal != nil {
			t.Fatalf("json.Marshal(row): %v", errMarshal)
		}
		if strings.Contains(string(rawJSON), "supersecret") || strings.Contains(string(rawJSON), "sk-qd-secret") {
			t.Fatalf("BreakdownRow JSON leaked raw upstream API key: %s", string(rawJSON))
		}
	}

	wantLabels := map[string]struct {
		label    string
		requests int64
		authType string
	}{
		"codex-alice@gmail.com.json":                   {"codex(alice@gmail.com)", 2, "oauth"},
		"codex-bob@gmail.com.json":                     {"codex(bob@gmail.com)", 1, "oauth"},
		"codex-work.json":                              {"codex(work)", 1, "oauth"},
		"codex:apikey:aaaa11112222":                    {"codex(千刀)", 2, "apikey"},
		"codex:apikey:bbbb11112222":                    {"codex(relay.foo.com · sk-f…1111)", 1, "apikey"},
		"codex:apikey:cccc11112222":                    {"codex(relay.foo.com · sk-f…2222)", 1, "apikey"},
		"codex:apikey:dddd11112222":                    {"codex(sk-d…9999)", 1, "apikey"},
		"openai-compatibility:openrouter:eeee11112222": {"openai-compatible(OpenRouter)", 1, "apikey"},
	}
	for authID, want := range wantLabels {
		got, ok := byAuthID[authID]
		if !ok {
			t.Fatalf("missing breakdown row for auth_id=%q", authID)
		}
		if got.Label != want.label || got.Requests != want.requests || got.AuthType != want.authType {
			t.Errorf("auth_id=%q: got (label=%q, reqs=%d, authType=%q), want (%q, %d, %q)",
				authID, got.Label, got.Requests, got.AuthType, want.label, want.requests, want.authType)
		}
	}

	// 3. Round-trip filtering via Query.Providers selects only the requested instances.
	aliceKey := byAuthID["codex-alice@gmail.com.json"].Key
	qdKey := byAuthID["codex:apikey:aaaa11112222"].Key
	filteredEntries, err := store.Query(ctx, Query{Providers: []string{aliceKey, qdKey}})
	if err != nil {
		t.Fatalf("Query(Providers): %v", err)
	}
	if len(filteredEntries) != 4 {
		t.Fatalf("filtered entries = %d, want 4 (2 alice + 2 千刀)", len(filteredEntries))
	}

	// 4. Single exact provider key filter via Query.Provider works identically.
	onlyAlice, err := store.Query(ctx, Query{Provider: aliceKey})
	if err != nil {
		t.Fatalf("Query(Provider=aliceKey): %v", err)
	}
	if len(onlyAlice) != 2 {
		t.Fatalf("onlyAlice entries = %d, want 2", len(onlyAlice))
	}

	// 5. Free-text search matches OAuth email and base_url host, but never probes raw API-key secrets.
	byEmail, err := store.Query(ctx, Query{Provider: "bob@gmail"})
	if err != nil {
		t.Fatalf("Query(Provider=bob@gmail): %v", err)
	}
	if len(byEmail) != 1 || byEmail[0].RequestID != "r3" {
		t.Fatalf("byEmail = %+v, want single r3", byEmail)
	}
	bySecretProbe, err := store.Query(ctx, Query{Provider: "supersecret"})
	if err != nil {
		t.Fatalf("Query(Provider=supersecret): %v", err)
	}
	if len(bySecretProbe) != 0 {
		t.Fatalf("secret substring search must not match raw API-key source, got %d rows", len(bySecretProbe))
	}

	// 6. Stream filter matches structured provider keys and OAuth email search.
	sub := SubscribeStream(Query{Provider: aliceKey})
	defer UnsubscribeStream(sub)
	publishStreamEntry(&Entry{ID: 101, Provider: "codex", AuthID: "codex-bob@gmail.com.json", AuthType: "oauth"})
	publishStreamEntry(&Entry{ID: 102, Provider: "codex", AuthID: "codex-alice@gmail.com.json", AuthType: "oauth"})
	select {
	case got := <-sub.Channel():
		if got.ID != 102 {
			t.Fatalf("stream received id=%d, want 102", got.ID)
		}
	default:
		t.Fatal("stream subscriber did not receive matching provider instance entry")
	}

	// 7. provider_type breakdown still groups by raw provider type when explicitly requested.
	typeRows, err := store.Breakdown(ctx, Query{}, "provider_type", 10)
	if err != nil {
		t.Fatalf("Breakdown(provider_type): %v", err)
	}
	if len(typeRows) != 2 || typeRows[0].Key != "codex" || typeRows[0].Requests != 9 {
		t.Fatalf("provider_type breakdown = %+v, want codex(9) and openai-compatible-openrouter(1)", typeRows)
	}
}
