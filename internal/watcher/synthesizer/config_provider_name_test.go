package synthesizer

import (
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestConfigSynthesizer_OptionalProviderName(t *testing.T) {
	cfg := &config.Config{
		GeminiKey: []config.GeminiKey{
			{Name: "My Gemini", APIKey: "gem-1"},
			{APIKey: "gem-2"},
		},
		InteractionsKey: []config.GeminiKey{
			{Name: "My Interactions", APIKey: "int-1"},
		},
		ClaudeKey: []config.ClaudeKey{
			{Name: "My Claude", APIKey: "cla-1"},
			{APIKey: "cla-2"},
		},
		CodexKey: []config.CodexKey{
			{Name: "My Codex", APIKey: "cdx-1", BaseURL: "https://codex.example.com/v1"},
		},
		XAIKey: []config.XAIKey{
			{Name: "My xAI", APIKey: "xai-1", BaseURL: "https://xai.example.com/v1"},
		},
		MetaKey: []config.MetaKey{
			{Name: "My Meta", APIKey: "meta-1", BaseURL: "https://api.meta.ai/v1"},
		},
		VertexCompatAPIKey: []config.VertexCompatKey{
			{Name: "My Vertex", APIKey: "vtx-1", BaseURL: "https://vertex.example.com/v1"},
			{APIKey: "vtx-2", BaseURL: "https://vertex2.example.com/v1"},
		},
	}

	s := NewConfigSynthesizer()
	auths, err := s.Synthesize(&SynthesisContext{
		Config:      cfg,
		Now:         time.Unix(1700000000, 0),
		IDGenerator: NewStableIDGenerator(),
	})
	if err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}

	byKey := make(map[string]struct {
		label        string
		providerName string
	}, len(auths))
	for _, a := range auths {
		byKey[a.Attributes["api_key"]] = struct {
			label        string
			providerName string
		}{
			label:        a.Label,
			providerName: a.Attributes["provider_name"],
		}
	}

	cases := []struct {
		apiKey           string
		wantLabel        string
		wantProviderName string
	}{
		{"gem-1", "My Gemini", "My Gemini"},
		{"gem-2", "gemini-apikey", ""},
		{"int-1", "My Interactions", "My Interactions"},
		{"cla-1", "My Claude", "My Claude"},
		{"cla-2", "claude-apikey", ""},
		{"cdx-1", "My Codex", "My Codex"},
		{"xai-1", "My xAI", "My xAI"},
		{"meta-1", "My Meta", "My Meta"},
		{"vtx-1", "My Vertex", "My Vertex"},
		{"vtx-2", "vertex-apikey", ""},
	}
	for _, tc := range cases {
		got, ok := byKey[tc.apiKey]
		if !ok {
			t.Fatalf("missing synthesized auth for api_key=%q", tc.apiKey)
		}
		if got.label != tc.wantLabel || got.providerName != tc.wantProviderName {
			t.Errorf("api_key=%q: got (label=%q, provider_name=%q), want (%q, %q)",
				tc.apiKey, got.label, got.providerName, tc.wantLabel, tc.wantProviderName)
		}
	}
}
