package config

import (
	"testing"
)

func TestAPIKeyMaxConcurrencyValidation(t *testing.T) {
	tests := []struct {
		name  string
		limit string
		valid bool
	}{
		{name: "zero unlimited", limit: "0", valid: true},
		{name: "positive", limit: "4", valid: true},
		{name: "maximum", limit: "1000000", valid: true},
		{name: "null", limit: "null", valid: true},
		{name: "negative", limit: "-1", valid: false},
		{name: "fraction", limit: "1.5", valid: false},
		{name: "text", limit: "abc", valid: false},
		{name: "above maximum", limit: "1000001", valid: false},
		{name: "integer overflow", limit: "9223372036854775808", valid: false},
	}
	for _, tc := range tests {
		t.Run("gemini_"+tc.name, func(t *testing.T) {
			_, errParse := ParseConfigBytes([]byte("gemini-api-key:\n  - api-key: key\n    max-concurrency: " + tc.limit + "\n"))
			if (errParse == nil) != tc.valid {
				t.Fatalf("ParseConfigBytes(max-concurrency=%s) error = %v, want valid=%v", tc.limit, errParse, tc.valid)
			}
		})
		t.Run("compat_provider_"+tc.name, func(t *testing.T) {
			raw := "openai-compatibility:\n  - name: p\n    base-url: https://api.example.invalid/v1\n    max-concurrency: " + tc.limit + "\n    api-key-entries:\n      - api-key: k1\n"
			_, errParse := ParseConfigBytes([]byte(raw))
			if (errParse == nil) != tc.valid {
				t.Fatalf("ParseConfigBytes(compat provider max-concurrency=%s) error = %v, want valid=%v", tc.limit, errParse, tc.valid)
			}
		})
		t.Run("compat_entry_"+tc.name, func(t *testing.T) {
			raw := "openai-compatibility:\n  - name: p\n    base-url: https://api.example.invalid/v1\n    api-key-entries:\n      - api-key: k1\n        max-concurrency: " + tc.limit + "\n"
			_, errParse := ParseConfigBytes([]byte(raw))
			if (errParse == nil) != tc.valid {
				t.Fatalf("ParseConfigBytes(compat entry max-concurrency=%s) error = %v, want valid=%v", tc.limit, errParse, tc.valid)
			}
		})
	}
}

func TestV8MaxConcurrencyParsingAndValidation(t *testing.T) {
	v8YAML := `config-version: 8
api-keys:
  gemini:
    - name: g1
      max-concurrency: 3
      keys:
        - api-key: gk1
        - api-key: gk2
          max-concurrency: 1
  openai-compatibility:
    - name: compat
      base-url: https://api.example.invalid/v1
      max-concurrency: 5
      keys:
        - api-key: ck1
          max-concurrency: 2
`
	cfg, err := ParseConfigBytes([]byte(v8YAML))
	if err != nil {
		t.Fatalf("ParseConfigBytes(v8) error = %v", err)
	}
	if err = ValidateV8Config([]byte(v8YAML)); err != nil {
		t.Fatalf("ValidateV8Config() error = %v", err)
	}
	if len(cfg.GeminiKey) != 2 || cfg.GeminiKey[0].MaxConcurrency == nil || *cfg.GeminiKey[0].MaxConcurrency != 3 {
		t.Fatalf("unexpected gemini[0]: %#v", cfg.GeminiKey)
	}
	if cfg.GeminiKey[1].MaxConcurrency == nil || *cfg.GeminiKey[1].MaxConcurrency != 1 {
		t.Fatalf("unexpected gemini[1] override: %#v", cfg.GeminiKey[1])
	}
	if len(cfg.OpenAICompatibility) != 1 || cfg.OpenAICompatibility[0].MaxConcurrency == nil || *cfg.OpenAICompatibility[0].MaxConcurrency != 5 {
		t.Fatalf("unexpected compat provider: %#v", cfg.OpenAICompatibility)
	}
	if len(cfg.OpenAICompatibility[0].APIKeyEntries) != 1 || cfg.OpenAICompatibility[0].APIKeyEntries[0].MaxConcurrency == nil || *cfg.OpenAICompatibility[0].APIKeyEntries[0].MaxConcurrency != 2 {
		t.Fatalf("unexpected compat entry: %#v", cfg.OpenAICompatibility[0].APIKeyEntries)
	}

	badV8 := `config-version: 8
api-keys:
  openai-compatibility:
    - name: compat
      base-url: https://api.example.invalid/v1
      max-concurrency: -2
      keys:
        - api-key: ck1
`
	if _, err = ParseConfigBytes([]byte(badV8)); err == nil {
		t.Fatal("expected ParseConfigBytes to reject negative v8 compat provider max-concurrency")
	}
	if err = ValidateV8Config([]byte(badV8)); err == nil {
		t.Fatal("expected ValidateV8Config to reject negative v8 compat provider max-concurrency")
	}
}
