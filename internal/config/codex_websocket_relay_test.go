package config

import (
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

func TestCodexWebsocketRelayPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, ttl, memory string
		wantTTL           time.Duration
		wantBytes         int64
		invalid           bool
	}{
		{name: "defaults", wantTTL: 5 * time.Minute, wantBytes: 128 << 20},
		{name: "short units", ttl: "30s", memory: "128m", wantTTL: 30 * time.Second, wantBytes: 128 << 20},
		{name: "binary units", ttl: "1h", memory: "2GiB", wantTTL: time.Hour, wantBytes: 2 << 30},
		{name: "decimal units", ttl: "1m", memory: "128MB", wantTTL: time.Minute, wantBytes: 128000000},
		{name: "bytes", ttl: "1m", memory: "4096", wantTTL: time.Minute, wantBytes: 4096},
		{name: "zero ttl", ttl: "0", memory: "128MiB", wantBytes: 128 << 20},
		{name: "zero memory", ttl: "5m", memory: "0", wantTTL: 5 * time.Minute},
		{name: "negative ttl", ttl: "-1s", invalid: true},
		{name: "invalid ttl", ttl: "tomorrow", invalid: true},
		{name: "negative memory", memory: "-1m", invalid: true},
		{name: "unknown unit", memory: "128mx", invalid: true},
		{name: "fraction", memory: "1.5m", invalid: true},
		{name: "overflow", memory: "9223372036854775807g", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policy, err := (CodexWebsocketRelayConfig{IdleTTL: tc.ttl, MaxMemory: tc.memory}).Policy()
			if (err != nil) != tc.invalid {
				t.Fatalf("Policy() error = %v, invalid = %v", err, tc.invalid)
			}
			if err == nil && (policy.IdleTTL != tc.wantTTL || policy.MaxMemory != tc.wantBytes) {
				t.Fatalf("Policy() = %+v, want %v/%d", policy, tc.wantTTL, tc.wantBytes)
			}
		})
	}
}

func TestCodexWebsocketRelayConfigRoundTrip(t *testing.T) {
	cfg, err := ParseConfigBytes([]byte(`config-version: 8
upstream:
  codex:
    websocket-relay:
      idle-ttl: 7m
      max-memory: 32m
api-keys:
  codex:
    - base-url: https://example.invalid/v1
      keys:
        - api-key: test
          websocket-relay: true
  xai:
    - base-url: https://example.invalid/v1
      keys:
        - api-key: test
          websocket-relay: true
  meta:
    - keys:
        - api-key: test
          websocket-relay: true
`))
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range []*Config{cfg, cfg.ForAPIKey(), cfg.CloneForRuntime()} {
		if !view.CodexKey[0].WebsocketRelay || view.CodexKey[0].Websockets {
			t.Fatal("relay must be independent of websockets")
		}
		if view.XAIKey[0].WebsocketRelay || view.MetaKey[0].WebsocketRelay {
			t.Fatal("relay must be Codex-only")
		}
		p, err := view.Codex.WebsocketRelay.Policy()
		if err != nil || p.IdleTTL != 7*time.Minute || p.MaxMemory != 32<<20 {
			t.Fatalf("policy = %+v, error = %v", p, err)
		}
	}
	raw, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := ParseConfigBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.ForAPIKey().Codex.WebsocketRelay != cfg.Codex.WebsocketRelay {
		t.Fatal("relay policy lost across YAML snapshot")
	}
	if _, err := ParseConfigBytes([]byte("upstream:\n  codex:\n    websocket-relay: {max-memory: -1m}\n")); err == nil {
		t.Fatal("invalid memory accepted")
	}
}
