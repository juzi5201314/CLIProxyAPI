package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCodexClientIdentityConfigRoundTrip(t *testing.T) {
	raw := []byte("config-version: 8\nupstream:\n  codex:\n    client-identity:\n      user-agent-mode: fallback\n      client-version: 0.173.0\n      client-version-source: latest\n      version-mode: override\n      version: custom-version\n")
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
		want := CodexClientIdentityConfig{UserAgentMode: "fallback", ClientVersion: "0.173.0", ClientVersionSource: "latest", VersionMode: "override", Version: "custom-version"}
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
		"{client-version-source: automatic}",
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

func TestCodexClientIdentityFixedAndLatestVersionResolution(t *testing.T) {
	fixed := CodexClientIdentityConfig{ClientVersion: "0.171.0"}
	if got := fixed.EffectiveClientVersion(); got != "0.171.0" {
		t.Fatalf("fixed EffectiveClientVersion() = %q, want 0.171.0", got)
	}

	dir := t.TempDir()
	t.Setenv("WRITABLE_PATH", dir)
	cacheDir := filepath.Join(dir, "cache")
	if errMkdir := os.MkdirAll(cacheDir, 0o700); errMkdir != nil {
		t.Fatal(errMkdir)
	}
	if errWrite := os.WriteFile(filepath.Join(cacheDir, "codex-client-version.json"), []byte(`{"version":"0.174.0"}`), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	latest := CodexClientIdentityConfig{ClientVersion: "0.171.0", ClientVersionSource: "latest"}
	if got := latest.EffectiveClientVersion(); got != "0.174.0" {
		t.Fatalf("latest EffectiveClientVersion() = %q, want cached 0.174.0", got)
	}
}
