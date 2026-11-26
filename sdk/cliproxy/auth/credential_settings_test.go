package auth

import "testing"

func TestCanonicalCredentialMetadataKeyRuntimeSettings(t *testing.T) {
	cases := map[string]string{
		"service-tier":           "service_tier",
		"service_tier":           "service_tier",
		"disable-codex-cloaking": "disable_codex_cloaking",
		"codex-disable-cloaking": "disable_codex_cloaking",
		"codex_disable_cloaking": "disable_codex_cloaking",
		"disable_codex_cloaking": "disable_codex_cloaking",
	}
	for raw, want := range cases {
		if got := CanonicalCredentialMetadataKey(raw); got != want {
			t.Fatalf("CanonicalCredentialMetadataKey(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestApplyAuthRuntimeMetadata(t *testing.T) {
	auth := &Auth{
		Provider: "codex",
		Metadata: map[string]any{
			"service-tier":           " FAST ",
			"disable-codex-cloaking": true,
			"websockets":             true,
		},
	}
	NormalizeCredentialMetadata(auth.Metadata)
	ApplyAuthRuntimeMetadata(auth, auth.Metadata)

	if got := auth.Attributes[AttributeServiceTier]; got != "fast" {
		t.Fatalf("Attributes[service_tier] = %q, want %q", got, "fast")
	}
	if got := auth.ServiceTierOverride(); got != "fast" {
		t.Fatalf("ServiceTierOverride() = %q, want %q", got, "fast")
	}
	if got := auth.Attributes[AttributeCodexDisableCloaking]; got != "true" {
		t.Fatalf("Attributes[codex_disable_cloaking] = %q, want %q", got, "true")
	}
	if disabled, ok := auth.CodexDisableCloakingOverride(); !ok || !disabled {
		t.Fatalf("CodexDisableCloakingOverride() = (%v, %v), want (true, true)", disabled, ok)
	}
	if got := auth.Attributes["websockets"]; got != "true" {
		t.Fatalf("Attributes[websockets] = %q, want %q", got, "true")
	}

	// Clearing or setting "auto" removes stale runtime attributes.
	auth.Metadata["service_tier"] = "auto"
	delete(auth.Metadata, "disable_codex_cloaking")
	delete(auth.Metadata, "websockets")
	ApplyAuthRuntimeMetadata(auth, auth.Metadata)

	if _, exists := auth.Attributes[AttributeServiceTier]; exists {
		t.Fatalf("expected service_tier attribute cleared for auto, got %q", auth.Attributes[AttributeServiceTier])
	}
	if _, exists := auth.Attributes[AttributeCodexDisableCloaking]; exists {
		t.Fatalf("expected codex_disable_cloaking attribute cleared, got %q", auth.Attributes[AttributeCodexDisableCloaking])
	}
	if _, exists := auth.Attributes["websockets"]; exists {
		t.Fatalf("expected websockets attribute cleared, got %q", auth.Attributes["websockets"])
	}
}
