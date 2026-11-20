package synthesizer

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func intPtr(v int) *int {
	return &v
}

func TestConfigSynthesizer_MaxConcurrencyAllTypes(t *testing.T) {
	cfg := &config.Config{
		GeminiKey:       []config.GeminiKey{{APIKey: "g1", MaxConcurrency: intPtr(2)}, {APIKey: "g2", MaxConcurrency: intPtr(0)}},
		InteractionsKey: []config.GeminiKey{{APIKey: "i1", MaxConcurrency: intPtr(3)}},
		ClaudeKey:       []config.ClaudeKey{{APIKey: "c1", MaxConcurrency: intPtr(4)}},
		VertexCompatAPIKey: []config.VertexCompatKey{
			{APIKey: "v1", BaseURL: "https://vertex.example.invalid", MaxConcurrency: intPtr(5)},
		},
		CodexKey: []config.CodexKey{{APIKey: "x1", MaxConcurrency: intPtr(6)}},
		XAIKey:   []config.XAIKey{{APIKey: "xai1", MaxConcurrency: intPtr(7)}},
		MetaKey:  []config.MetaKey{{APIKey: "m1", MaxConcurrency: intPtr(8)}},
	}

	synth := NewConfigSynthesizer()
	auths, err := synth.Synthesize(&SynthesisContext{
		Config:      cfg,
		Now:         time.Unix(1000, 0),
		IDGenerator: NewStableIDGenerator(),
	})
	if err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	if len(auths) != 8 {
		t.Fatalf("auth count = %d, want 8", len(auths))
	}

	wantByAPIKey := map[string]string{
		"g1":   "2",
		"g2":   "",
		"i1":   "3",
		"c1":   "4",
		"v1":   "5",
		"x1":   "6",
		"xai1": "7",
		"m1":   "8",
	}
	foundByKey := make(map[string]string, len(auths))
	for _, a := range auths {
		foundByKey[a.Attributes["api_key"]] = a.Attributes[coreauth.AttributeMaxConcurrency]
	}
	for apiKey, want := range wantByAPIKey {
		if got, ok := foundByKey[apiKey]; !ok {
			t.Fatalf("missing synthesized auth for api_key %q", apiKey)
		} else if got != want {
			t.Fatalf("api_key %q max_concurrency = %q, want %q", apiKey, got, want)
		}
	}
}

func TestConfigSynthesizer_OpenAICompatDualAndDistinctGroups(t *testing.T) {
	cfg := &config.Config{
		OpenAICompatibility: []config.OpenAICompatibility{
			{
				Name:           "shared-proxy",
				BaseURL:        "https://proxy.example.invalid/v1",
				MaxConcurrency: intPtr(10),
				APIKeyEntries: []config.OpenAICompatibilityAPIKey{
					{APIKey: "k1", MaxConcurrency: intPtr(3)},
					{APIKey: "k2"},
				},
			},
			{
				Name:           "shared-proxy",
				BaseURL:        "https://proxy.example.invalid/v1",
				MaxConcurrency: intPtr(4),
				// Keyless fallback block
			},
		},
	}

	auths, err := NewConfigSynthesizer().Synthesize(&SynthesisContext{
		Config:      cfg,
		Now:         time.Unix(1000, 0),
		IDGenerator: NewStableIDGenerator(),
	})
	if err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	if len(auths) != 3 {
		t.Fatalf("auth count = %d, want 3", len(auths))
	}

	key0 := auths[0].Attributes[coreauth.AttributeProviderConcurrencyKey]
	key1 := auths[1].Attributes[coreauth.AttributeProviderConcurrencyKey]
	key2 := auths[2].Attributes[coreauth.AttributeProviderConcurrencyKey]
	if key0 == "" || key0 != key1 {
		t.Fatalf("expected entries of first compat block to share group key, got %q and %q", key0, key1)
	}
	if key2 == "" || key2 == key0 {
		t.Fatalf("expected second compat block to have distinct group key, got %q vs %q", key2, key0)
	}
	if got := auths[0].Attributes[coreauth.AttributeProviderMaxConcurrency]; got != "10" {
		t.Fatalf("auths[0] provider_max_concurrency = %q, want 10", got)
	}
	if got := auths[0].Attributes[coreauth.AttributeMaxConcurrency]; got != "3" {
		t.Fatalf("auths[0] max_concurrency = %q, want 3", got)
	}
	if got := auths[1].Attributes[coreauth.AttributeMaxConcurrency]; got != "" {
		t.Fatalf("auths[1] max_concurrency = %q, want empty", got)
	}
	if got := auths[2].Attributes[coreauth.AttributeProviderMaxConcurrency]; got != "4" {
		t.Fatalf("auths[2] keyless provider_max_concurrency = %q, want 4", got)
	}
}

func TestSynthesizeAuthFile_MaxConcurrencyMetadata(t *testing.T) {
	tempDir := t.TempDir()
	fullPath := filepath.Join(tempDir, "codex-a.json")
	ctx := &SynthesisContext{
		Config:  &config.Config{},
		AuthDir: tempDir,
		Now:     time.Unix(1000, 0),
	}

	auths, err := SynthesizeAuthFile(ctx, fullPath, []byte(`{"type":"codex","max_concurrency":3}`))
	if err != nil {
		t.Fatalf("SynthesizeAuthFile(valid) error = %v", err)
	}
	if len(auths) != 1 || auths[0].Attributes[coreauth.AttributeMaxConcurrency] != "3" {
		t.Fatalf("unexpected synthesized file auths: %#v", auths)
	}

	authsAlias, err := SynthesizeAuthFile(ctx, fullPath, []byte(`{"type":"codex","max-concurrency":5}`))
	if err != nil {
		t.Fatalf("SynthesizeAuthFile(alias) error = %v", err)
	}
	if len(authsAlias) != 1 || authsAlias[0].Attributes[coreauth.AttributeMaxConcurrency] != "5" {
		t.Fatalf("unexpected synthesized alias file auths: %#v", authsAlias)
	}

	if _, err = SynthesizeAuthFile(ctx, fullPath, []byte(`{"type":"codex","max_concurrency":-2}`)); err == nil {
		t.Fatal("expected negative max_concurrency to fail")
	}
}
