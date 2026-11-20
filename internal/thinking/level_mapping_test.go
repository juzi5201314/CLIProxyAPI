package thinking_test

import (
	"testing"

	"github.com/MoeForge/moego/ojson"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/thinking"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/claude"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/codex"
	_ "github.com/router-for-me/CLIProxyAPI/v8/internal/thinking/provider/openai"
)

func TestApplyThinkingWithModelInfo_ThinkingLevelMapping(t *testing.T) {
	tests := []struct {
		name        string
		userDefined bool
		model       string
		fromFormat  string
		toFormat    string
		providerKey string
		mapping     map[string]string
		body        string
		wantField   string
		wantValue   string
	}{
		{
			name:        "default nil mapping passes through verbatim",
			userDefined: true,
			model:       "custom-openai",
			fromFormat:  "openai",
			toFormat:    "openai",
			providerKey: "compat",
			mapping:     nil,
			body:        `{"model":"custom-openai","reasoning_effort":"high"}`,
			wantField:   "reasoning_effort",
			wantValue:   "high",
		},
		{
			name:        "user-defined openai maps high to low",
			userDefined: true,
			model:       "custom-openai",
			fromFormat:  "openai",
			toFormat:    "openai",
			providerKey: "compat",
			mapping:     map[string]string{"high": "low"},
			body:        `{"model":"custom-openai","reasoning_effort":"high"}`,
			wantField:   "reasoning_effort",
			wantValue:   "low",
		},
		{
			name:        "unmapped level passes through verbatim",
			userDefined: true,
			model:       "custom-openai",
			fromFormat:  "openai",
			toFormat:    "openai",
			providerKey: "compat",
			mapping:     map[string]string{"high": "low"},
			body:        `{"model":"custom-openai","reasoning_effort":"medium"}`,
			wantField:   "reasoning_effort",
			wantValue:   "medium",
		},
		{
			name:        "model suffix respects thinking level mapping",
			userDefined: true,
			model:       "custom-codex(xhigh)",
			fromFormat:  "openai-response",
			toFormat:    "codex",
			providerKey: "codex",
			mapping:     map[string]string{"XHIGH": "Medium"},
			body:        `{"model":"custom-codex(xhigh)","input":"hi"}`,
			wantField:   "reasoning.effort",
			wantValue:   "medium",
		},
		{
			name:        "mapping to none disables thinking",
			userDefined: true,
			model:       "custom-claude",
			fromFormat:  "claude",
			toFormat:    "claude",
			providerKey: "claude",
			mapping:     map[string]string{"high": "none"},
			body:        `{"model":"custom-claude","thinking":{"type":"adaptive"},"output_config":{"effort":"high"}}`,
			wantField:   "thinking.type",
			wantValue:   "disabled",
		},
		{
			name:        "mapping from none enables target level",
			userDefined: true,
			model:       "custom-openai",
			fromFormat:  "openai",
			toFormat:    "openai",
			providerKey: "compat",
			mapping:     map[string]string{"none": "low"},
			body:        `{"model":"custom-openai","reasoning_effort":"none"}`,
			wantField:   "reasoning_effort",
			wantValue:   "low",
		},
		{
			name:        "catalog model with mapping remaps level",
			userDefined: false,
			model:       "claude-upstream",
			fromFormat:  "claude",
			toFormat:    "claude",
			providerKey: "claude",
			mapping:     map[string]string{"max": "high"},
			body:        `{"model":"claude-upstream","thinking":{"type":"adaptive"},"output_config":{"effort":"max"}}`,
			wantField:   "output_config.effort",
			wantValue:   "high",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			modelInfo := &registry.ModelInfo{
				ID:                   "test-model",
				Type:                 tc.toFormat,
				UserDefined:          tc.userDefined,
				ThinkingLevelMapping: tc.mapping,
			}
			if !tc.userDefined {
				modelInfo.Thinking = &registry.ThinkingSupport{
					Levels:      []string{"low", "medium", "high", "max"},
					ZeroAllowed: true,
				}
			}
			out, err := thinking.ApplyThinkingWithModelInfo([]byte(tc.body), []byte(tc.body), tc.model, tc.fromFormat, tc.toFormat, tc.providerKey, modelInfo)
			if err != nil {
				t.Fatalf("ApplyThinkingWithModelInfo() error = %v", err)
			}
			if got := ojson.GetBytes(out, tc.wantField).String(); got != tc.wantValue {
				t.Fatalf("%s = %q, want %q; body=%s", tc.wantField, got, tc.wantValue, out)
			}
		})
	}
}
