package auth

import (
	"strconv"
	"strings"
)

// NormalizeServiceTierValue trims and lower-cases an optional per-credential
// service_tier override. Empty or "auto" normalizes to "" (follow downstream).
func NormalizeServiceTierValue(raw string) string {
	tier := strings.ToLower(strings.TrimSpace(raw))
	if tier == "" || tier == "auto" {
		return ""
	}
	return tier
}

// ServiceTierOverride returns the normalized credential-level service_tier override,
// checking runtime attributes first and falling back to auth metadata.
func (a *Auth) ServiceTierOverride() string {
	if a == nil {
		return ""
	}
	if a.Attributes != nil {
		if tier := NormalizeServiceTierValue(a.Attributes[AttributeServiceTier]); tier != "" {
			return tier
		}
	}
	return serviceTierFromMetadata(a.Metadata)
}

// CodexDisableCloakingOverride returns the credential-level disable_codex_cloaking
// override when explicitly configured, distinguishing false from unset.
func (a *Auth) CodexDisableCloakingOverride() (bool, bool) {
	if a == nil {
		return false, false
	}
	if a.Attributes != nil {
		if raw := strings.TrimSpace(a.Attributes[AttributeCodexDisableCloaking]); raw != "" {
			if parsed, errParse := strconv.ParseBool(raw); errParse == nil {
				return parsed, true
			}
		}
	}
	return codexDisableCloakingFromMetadata(a.Metadata)
}

// ApplyAuthServiceTierMetadata copies a normalized service_tier value from
// metadata (or auth.Metadata when nil) into auth.Attributes[AttributeServiceTier].
func ApplyAuthServiceTierMetadata(auth *Auth, metadata map[string]any) {
	if auth == nil {
		return
	}
	source := metadata
	if source == nil {
		source = auth.Metadata
	}
	tier := serviceTierFromMetadata(source)
	if tier == "" {
		if auth.Attributes != nil {
			delete(auth.Attributes, AttributeServiceTier)
		}
		return
	}
	if auth.Attributes == nil {
		auth.Attributes = make(map[string]string)
	}
	auth.Attributes[AttributeServiceTier] = tier
}

// ApplyAuthCodexDisableCloakingMetadata copies disable_codex_cloaking from
// metadata (or auth.Metadata when nil) into auth.Attributes[AttributeCodexDisableCloaking].
func ApplyAuthCodexDisableCloakingMetadata(auth *Auth, metadata map[string]any) {
	if auth == nil {
		return
	}
	source := metadata
	if source == nil {
		source = auth.Metadata
	}
	disabled, ok := codexDisableCloakingFromMetadata(source)
	if !ok {
		if auth.Attributes != nil {
			delete(auth.Attributes, AttributeCodexDisableCloaking)
		}
		return
	}
	if auth.Attributes == nil {
		auth.Attributes = make(map[string]string)
	}
	auth.Attributes[AttributeCodexDisableCloaking] = strconv.FormatBool(disabled)
}

// ApplyAuthWebsocketsMetadata copies websockets from metadata (or auth.Metadata
// when nil) into auth.Attributes["websockets"].
func ApplyAuthWebsocketsMetadata(auth *Auth, metadata map[string]any) {
	if auth == nil {
		return
	}
	source := metadata
	if source == nil {
		source = auth.Metadata
	}
	enabled, ok := websocketsFromMetadata(source)
	if !ok {
		if auth.Attributes != nil {
			delete(auth.Attributes, "websockets")
		}
		return
	}
	if auth.Attributes == nil {
		auth.Attributes = make(map[string]string)
	}
	auth.Attributes["websockets"] = strconv.FormatBool(enabled)
}

// ApplyAuthRuntimeMetadata synchronizes per-credential runtime override attributes
// (service_tier, disable_codex_cloaking, websockets) from metadata onto auth.Attributes.
func ApplyAuthRuntimeMetadata(auth *Auth, metadata map[string]any) {
	if auth == nil {
		return
	}
	ApplyAuthServiceTierMetadata(auth, metadata)
	ApplyAuthCodexDisableCloakingMetadata(auth, metadata)
	ApplyAuthWebsocketsMetadata(auth, metadata)
}

func serviceTierFromMetadata(metadata map[string]any) string {
	if len(metadata) == 0 {
		return ""
	}
	for _, key := range []string{"service_tier", "service-tier"} {
		raw, ok := metadata[key]
		if !ok || raw == nil {
			continue
		}
		if str, okStr := raw.(string); okStr {
			return NormalizeServiceTierValue(str)
		}
	}
	return ""
}

func codexDisableCloakingFromMetadata(metadata map[string]any) (bool, bool) {
	if len(metadata) == 0 {
		return false, false
	}
	for _, key := range []string{"disable_codex_cloaking", "disable-codex-cloaking", "codex_disable_cloaking", "codex-disable-cloaking"} {
		raw, ok := metadata[key]
		if !ok || raw == nil {
			continue
		}
		if parsed, okBool := parseBoolAny(raw); okBool {
			return parsed, true
		}
	}
	return false, false
}

func websocketsFromMetadata(metadata map[string]any) (bool, bool) {
	if len(metadata) == 0 {
		return false, false
	}
	raw, ok := metadata["websockets"]
	if !ok || raw == nil {
		return false, false
	}
	return parseBoolAny(raw)
}
