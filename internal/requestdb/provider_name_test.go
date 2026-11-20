package requestdb

import (
	"context"
	"path/filepath"
	"testing"
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
