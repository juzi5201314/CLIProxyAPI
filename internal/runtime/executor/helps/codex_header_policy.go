package helps

import (
	"net/http"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// ApplyCodexHeaderPolicy runs after provider and model header rules so explicit
// operator policy cannot be undone by a catalog's older client identity.
// An absent policy preserves the legacy per-credential cloaking opt-out.
func ApplyCodexHeaderPolicy(headers, downstream http.Header, identity config.CodexClientIdentityConfig, cloakingDisabled bool) {
	if headers == nil {
		return
	}
	copyHeader := func(name string) bool {
		for key, values := range downstream {
			if strings.EqualFold(key, name) && len(values) > 0 && strings.TrimSpace(values[0]) != "" {
				for current := range headers {
					if strings.EqualFold(current, name) {
						delete(headers, current)
					}
				}
				headers[http.CanonicalHeaderKey(name)] = append([]string(nil), values...)
				return true
			}
		}
		return false
	}
	setHeader := func(name, value string) {
		for key := range headers {
			if strings.EqualFold(key, name) {
				delete(headers, key)
			}
		}
		// An explicit empty User-Agent suppresses net/http's automatic default.
		// Other absent headers must be removed, rather than serialized as empty fields.
		if value == "" && name != "User-Agent" {
			return
		}
		headers[http.CanonicalHeaderKey(name)] = []string{value}
	}
	switch identity.UserAgentMode {
	case "builtin":
		setHeader("User-Agent", identity.UserAgent())
	case "passthrough":
		if !copyHeader("User-Agent") {
			setHeader("User-Agent", "")
		}
	case "fallback":
		if !copyHeader("User-Agent") {
			setHeader("User-Agent", identity.UserAgent())
		}
	default:
		if !cloakingDisabled {
			setHeader("User-Agent", identity.UserAgent())
		}
	}
	switch identity.VersionMode {
	case "builtin":
		setHeader("Version", identity.EffectiveClientVersion())
	case "passthrough":
		if !copyHeader("Version") {
			setHeader("Version", "")
		}
	case "override":
		setHeader("Version", strings.TrimSpace(identity.Version))
	default:
		if strings.TrimSpace(headers.Get("Version")) == "" && !cloakingDisabled {
			setHeader("Version", identity.EffectiveClientVersion())
		}
	}
}
