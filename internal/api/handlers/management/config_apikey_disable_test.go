package management

import (
	"reflect"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/watcher/synthesizer"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestToggleConfigAPIKeyDisabled_PreservesExcludedModels(t *testing.T) {
	cfg := &config.Config{
		CodexKey: []config.CodexKey{{
			APIKey:         "sk-test",
			BaseURL:        "https://example.com/v1",
			ExcludedModels: []string{"gpt-5"},
		}},
	}
	idGen := synthesizer.NewStableIDGenerator()
	authID, _ := idGen.Next("codex:apikey", "sk-test", "https://example.com/v1", "", "", "")
	auth := &coreauth.Auth{
		ID:       authID,
		Provider: "codex",
		Attributes: map[string]string{
			"api_key":  "sk-test",
			"base_url": "https://example.com/v1",
			"source":   "config:codex[abc]",
		},
	}

	handled, err := toggleConfigAPIKeyDisabled(cfg, auth, true)
	if err != nil || !handled {
		t.Fatalf("toggle disable: handled=%v err=%v", handled, err)
	}
	if !cfg.CodexKey[0].Disabled {
		t.Fatal("expected CodexKey[0].Disabled = true")
	}
	if !reflect.DeepEqual(cfg.CodexKey[0].ExcludedModels, []string{"gpt-5"}) {
		t.Fatalf("excluded-models mutated: got %#v, want [gpt-5]", cfg.CodexKey[0].ExcludedModels)
	}

	handled, err = toggleConfigAPIKeyDisabled(cfg, auth, false)
	if err != nil || !handled {
		t.Fatalf("toggle enable: handled=%v err=%v", handled, err)
	}
	if cfg.CodexKey[0].Disabled {
		t.Fatal("expected CodexKey[0].Disabled = false")
	}
	if !reflect.DeepEqual(cfg.CodexKey[0].ExcludedModels, []string{"gpt-5"}) {
		t.Fatalf("excluded-models mutated on re-enable: got %#v, want [gpt-5]", cfg.CodexKey[0].ExcludedModels)
	}
}

func TestToggleConfigAPIKeyDisabled_XAI(t *testing.T) {
	cfg := &config.Config{
		XAIKey: []config.XAIKey{{
			APIKey:  "xai-test",
			BaseURL: "https://api.x.ai/v1",
		}},
	}
	idGen := synthesizer.NewStableIDGenerator()
	authID, _ := idGen.Next("xai:apikey", "xai-test", "https://api.x.ai/v1", "", "", "")
	auth := &coreauth.Auth{
		ID:       authID,
		Provider: "xai",
		Attributes: map[string]string{
			"api_key":  "xai-test",
			"base_url": "https://api.x.ai/v1",
			"source":   "config:xai[abc]",
		},
	}

	handled, errToggle := toggleConfigAPIKeyDisabled(cfg, auth, true)
	if errToggle != nil || !handled {
		t.Fatalf("toggle disable: handled=%v err=%v", handled, errToggle)
	}
	if !cfg.XAIKey[0].Disabled {
		t.Fatal("expected XAIKey[0].Disabled = true")
	}
}

func TestToggleConfigAPIKeyDisabled_Meta(t *testing.T) {
	cfg := &config.Config{
		MetaKey: []config.MetaKey{{
			APIKey:  "meta-test",
			BaseURL: "https://api.meta.ai/v1",
		}},
	}
	idGen := synthesizer.NewStableIDGenerator()
	authID, _ := idGen.Next("meta:apikey", "meta-test", "https://api.meta.ai/v1", "", "", "")
	auth := &coreauth.Auth{
		ID:       authID,
		Provider: "meta",
		Attributes: map[string]string{
			"api_key":  "meta-test",
			"base_url": "https://api.meta.ai/v1",
			"source":   "config:meta[abc]",
		},
	}

	handled, errToggle := toggleConfigAPIKeyDisabled(cfg, auth, true)
	if errToggle != nil || !handled {
		t.Fatalf("toggle disable: handled=%v err=%v", handled, errToggle)
	}
	if !cfg.MetaKey[0].Disabled {
		t.Fatal("expected MetaKey[0].Disabled = true")
	}
}

func TestToggleConfigAPIKeyDisabled_Vertex_NoBaseURL(t *testing.T) {
	cfg := &config.Config{
		VertexCompatAPIKey: []config.VertexCompatKey{{
			APIKey: "vertex-key-only",
		}},
	}
	idGen := synthesizer.NewStableIDGenerator()
	authID, _ := idGen.Next("vertex:apikey", "vertex-key-only", "", "")
	auth := &coreauth.Auth{
		ID:       authID,
		Provider: "vertex",
		Attributes: map[string]string{
			"auth_kind": "apikey",
			"api_key":   "vertex-key-only",
			"source":    "config:vertex[xyz]",
		},
	}

	handled, errToggle := toggleConfigAPIKeyDisabled(cfg, auth, true)
	if errToggle != nil || !handled {
		t.Fatalf("toggle disable: handled=%v err=%v", handled, errToggle)
	}
	if !cfg.VertexCompatAPIKey[0].Disabled {
		t.Fatal("expected VertexCompatAPIKey[0].Disabled = true")
	}
}

func TestToggleConfigAPIKeyDisabled_EmptyKeyWithBaseURL(t *testing.T) {
	cfg := &config.Config{
		ClaudeKey: []config.ClaudeKey{{
			APIKey:  "",
			BaseURL: "https://custom-claude.example.com",
		}},
		GeminiKey: []config.GeminiKey{{
			APIKey:  "   ",
			BaseURL: "https://custom-gemini.example.com",
		}},
	}
	idGen := synthesizer.NewStableIDGenerator()
	claudeID, _ := idGen.Next("claude:apikey", "", "https://custom-claude.example.com", "", "", "")
	geminiID, _ := idGen.Next("gemini:apikey", "", "https://custom-gemini.example.com", "", "", "")

	claudeAuth := &coreauth.Auth{
		ID:       claudeID,
		Provider: "claude",
		Attributes: map[string]string{
			"auth_kind": "apikey",
			"base_url":  "https://custom-claude.example.com",
			"source":    "config:claude[abc]",
		},
	}
	geminiAuth := &coreauth.Auth{
		ID:       geminiID,
		Provider: "gemini",
		Attributes: map[string]string{
			"auth_kind": "apikey",
			"base_url":  "https://custom-gemini.example.com",
			"source":    "config:gemini[def]",
		},
	}

	handled, err := toggleConfigAPIKeyDisabled(cfg, claudeAuth, true)
	if err != nil || !handled {
		t.Fatalf("toggle claude: handled=%v err=%v", handled, err)
	}
	if !cfg.ClaudeKey[0].Disabled {
		t.Fatal("expected ClaudeKey[0].Disabled = true")
	}

	handled, err = toggleConfigAPIKeyDisabled(cfg, geminiAuth, true)
	if err != nil || !handled {
		t.Fatalf("toggle gemini: handled=%v err=%v", handled, err)
	}
	if !cfg.GeminiKey[0].Disabled {
		t.Fatal("expected GeminiKey[0].Disabled = true")
	}
}
