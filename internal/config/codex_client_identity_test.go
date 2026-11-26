package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCodexClientIdentityConfigRoundTrip(t *testing.T) {
	raw := []byte("config-version: 8\nupstream:\n  codex:\n    client-identity:\n      user-agent-mode: fallback\n      client-version: 0.173.0\n      version-mode: override\n      version: custom-version\n")
	file := filepath.Join(t.TempDir(), "config.yaml")
	if errWrite := os.WriteFile(file, raw, 0600); errWrite != nil {
		t.Fatal(errWrite)
	}
	for _, parse := range []func() (*Config, error){
		func() (*Config, error) { return ParseConfigBytes(raw) },
		func() (*Config, error) { return LoadConfig(file) },
	} {
		cfg, errParse := parse()
		if errParse != nil {
			t.Fatal(errParse)
		}
		want := CodexClientIdentityConfig{UserAgentMode: "fallback", ClientVersion: "0.173.0", VersionMode: "override", Version: "custom-version"}
		if cfg.Codex.ClientIdentity != want || cfg.ForAPIKey().Codex.ClientIdentity != want {
			t.Fatalf("client identity lost during v8 projection: %+v", cfg.Codex.ClientIdentity)
		}
		if errSave := SaveConfigPreserveComments(file, cfg); errSave != nil {
			t.Fatal(errSave)
		}
		loaded, errLoad := LoadConfig(file)
		if errLoad != nil || loaded.Codex.ClientIdentity != want {
			t.Fatalf("saved identity = %+v, error = %v", loaded, errLoad)
		}
	}
}

func TestCodexClientIdentityRejectsInvalidConfiguration(t *testing.T) {
	for _, value := range []string{
		"{user-agent-mode: typo}",
		"{version-mode: typo}",
		"{client-version: '0.172.0\r\nInjected: true'}",
		"{client-version: 'not-a-version'}",
		"{version-mode: override}",
		`{version-mode: override, version: "0.172.0\r\nInjected: true"}`,
	} {
		t.Run(value, func(t *testing.T) {
			raw := []byte("upstream: {codex: {client-identity: " + value + "}}\n")
			if _, errParse := ParseConfigBytes(raw); errParse == nil {
				t.Fatal("invalid client identity accepted")
			}
		})
	}
}
