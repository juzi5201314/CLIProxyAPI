package modelconfig

import (
	"testing"

	"github.com/MoeForge/moego/ojson"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/thinking"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/claude"
)

func TestResolveModelInfoUsesSuffixFreeStaticCapabilities(t *testing.T) {
	info := ResolveModelInfo("claude-opus-4-6(high)", "claude")
	if info == nil || info.Thinking == nil {
		t.Fatalf("ResolveModelInfo() = %+v, want inherited thinking support", info)
	}
	if info.ID != "claude-opus-4-6(high)" {
		t.Fatalf("model ID = %q, want configured upstream name", info.ID)
	}
	if info.UserDefined {
		t.Fatal("resolved capability snapshot must not be user-defined")
	}
}

// Catalog-known Claude models keep the catalog way of turning thinking off:
// claude-sonnet-5-5 rejects "disabled".
func TestResolveModelInfoKeepsCatalogDisableType(t *testing.T) {
	info := ResolveModelInfo("claude-sonnet-5-5", "claude")
	if info == nil || info.Thinking == nil {
		t.Fatalf("ResolveModelInfo() = %+v, want thinking support", info)
	}
	if got := info.Thinking.DisableType; got != "between_tools" {
		t.Fatalf("DisableType = %q, want catalog between_tools", got)
	}

	body := []byte(`{"model":"claude-sonnet-5-5","messages":[{"role":"user","content":"hi"}],"thinking":{"type":"disabled"}}`)
	out, err := thinking.ApplyThinkingWithModelInfo(body, nil, "claude-sonnet-5-5", "claude", "claude", "claude", info)
	if err != nil {
		t.Fatalf("ApplyThinkingWithModelInfo: %v", err)
	}
	if got := ojson.GetBytesNoCopy(out, "thinking").Raw; got != `{"type":"between_tools"}` {
		t.Fatalf("thinking = %s, want {\"type\":\"between_tools\"}; body=%s", got, out)
	}
	if variant := ResolveModelInfo("claude-sonnet-5-5[1m]", "claude"); variant.Thinking == nil || variant.Thinking.DisableType != "between_tools" {
		t.Fatalf("claude-sonnet-5-5[1m] DisableType = %v, want catalog between_tools", variant.Thinking)
	}
}

func TestResolveModelInfoUnknownModelKeepsMissingCapability(t *testing.T) {
	info := ResolveModelInfo("unknown-configured-model", "claude")
	if info == nil {
		t.Fatal("ResolveModelInfo() = nil")
	}
	if info.Thinking != nil {
		t.Fatalf("unknown model thinking = %+v, want nil", info.Thinking)
	}
	if info.UserDefined {
		t.Fatal("unknown configured model must use its exact bound capability")
	}
}
