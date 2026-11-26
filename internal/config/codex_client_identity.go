package config

import (
	"fmt"
	"strings"

	"github.com/MoeForge/moego/regexp"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/codexversion"
)

// DefaultCodexClientVersion is the built-in identity for Codex subscription requests.
const DefaultCodexClientVersion = "0.172.0"

// CodexClientIdentityConfig controls the final upstream User-Agent and Version headers.
type CodexClientIdentityConfig struct {
	UserAgentMode       string `yaml:"user-agent-mode,omitempty" json:"user-agent-mode,omitempty"`
	ClientVersion       string `yaml:"client-version,omitempty" json:"client-version,omitempty"`
	ClientVersionSource string `yaml:"client-version-source,omitempty" json:"client-version-source,omitempty"`
	VersionMode         string `yaml:"version-mode,omitempty" json:"version-mode,omitempty"`
	Version             string `yaml:"version,omitempty" json:"version,omitempty"`
}

// UsesLatestClientVersion reports whether the built-in identity should track GitHub latest releases.
func (c CodexClientIdentityConfig) UsesLatestClientVersion() bool {
	return c.ClientVersionSource == "latest"
}

// EffectiveClientVersion supplies one version for both built-in identity headers.
func (c CodexClientIdentityConfig) EffectiveClientVersion() string {
	version := strings.TrimSpace(c.ClientVersion)
	if version == "" {
		version = DefaultCodexClientVersion
	}
	if c.UsesLatestClientVersion() {
		return codexversion.ResolveLatest(version)
	}
	return version
}

// UserAgent formats the built-in Codex identity with the configured version.
func (c CodexClientIdentityConfig) UserAgent() string {
	version := c.EffectiveClientVersion()
	return "codex-tui/" + version + " (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; " + version + ")"
}

var codexClientVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`)

// Validate rejects unknown modes and invalid HTTP header values before publication.
func (c CodexClientIdentityConfig) Validate() error {
	switch c.UserAgentMode {
	case "", "builtin", "passthrough", "fallback":
	default:
		return fmt.Errorf("upstream.codex.client-identity.user-agent-mode must be builtin, passthrough, or fallback")
	}
	switch c.VersionMode {
	case "", "auto", "builtin", "passthrough", "override":
	default:
		return fmt.Errorf("upstream.codex.client-identity.version-mode must be auto, builtin, passthrough, or override")
	}
	switch c.ClientVersionSource {
	case "", "fixed", "latest":
	default:
		return fmt.Errorf("upstream.codex.client-identity.client-version-source must be fixed or latest")
	}
	if c.ClientVersion != "" && !codexClientVersionPattern.MatchString(strings.TrimSpace(c.ClientVersion)) {
		return fmt.Errorf("upstream.codex.client-identity.client-version must be a version such as %s", DefaultCodexClientVersion)
	}
	for _, char := range c.Version {
		if char < 32 || char == 127 {
			return fmt.Errorf("upstream.codex.client-identity.version must be a valid HTTP header value")
		}
	}
	if c.VersionMode == "override" && strings.TrimSpace(c.Version) == "" {
		return fmt.Errorf("upstream.codex.client-identity.version is required when version-mode is override")
	}
	return nil
}
