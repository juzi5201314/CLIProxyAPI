package requestdb

import (
	"net/url"
	"path/filepath"
	"strings"
)

const (
	providerKeyPrefixID   = "id:"
	providerKeyPrefixIdx  = "idx:"
	providerKeyPrefixCfg  = "cfg:"
	providerKeyPrefixType = "type:"

	openAICompatProviderPrefix = "openai-compatible-"
)

// providerGroupSQLExpr computes a deterministic per-provider-instance grouping key
// in SQLite without exposing raw API keys. Rows with auth_id group by (provider, auth_id);
// rows without auth_id fall back to auth_index, then explicit metadata, then raw provider.
const providerGroupSQLExpr = `CASE
	WHEN auth_id != '' THEN 'id:' || provider || '|' || auth_id
	WHEN auth_index != '' THEN 'idx:' || provider || '|' || auth_index
	WHEN provider_name != '' OR base_url != '' OR (LOWER(auth_type) = 'oauth' AND source != '' AND source != api_key) THEN
		'cfg:' || provider || char(31) || LOWER(auth_type) || char(31) || provider_name || char(31) || base_url || char(31) ||
		CASE WHEN LOWER(auth_type) = 'oauth' AND source != '' AND source != api_key THEN source ELSE '' END
	ELSE provider
END`

// ProviderIdentity carries the attributes that identify and label one upstream
// provider instance (OAuth account, API-key provider, OpenAI-compatible entry, or plugin).
type ProviderIdentity struct {
	Provider     string
	ProviderName string
	AuthID       string
	AuthIndex    string
	AuthType     string
	BaseURL      string
	// Source is the upstream account identity (email / project_id) or upstream API key,
	// excluding the client APIKey fallback. Never serialized directly into API responses.
	Source string
}

// EntryProviderIdentity extracts a normalized ProviderIdentity from a stored Entry.
func EntryProviderIdentity(e *Entry) ProviderIdentity {
	if e == nil {
		return ProviderIdentity{}
	}
	return ProviderIdentity{
		Provider:     strings.TrimSpace(e.Provider),
		ProviderName: strings.TrimSpace(e.ProviderName),
		AuthID:       strings.TrimSpace(e.AuthID),
		AuthIndex:    strings.TrimSpace(e.AuthIndex),
		AuthType:     NormalizeAuthType(e.AuthType),
		BaseURL:      strings.TrimSpace(e.BaseURL),
		Source:       effectiveUpstreamSource(e.Source, e.APIKey),
	}
}

func effectiveUpstreamSource(source, clientAPIKey string) string {
	s := strings.TrimSpace(source)
	if s == "" {
		return ""
	}
	if k := strings.TrimSpace(clientAPIKey); k != "" && s == k {
		return ""
	}
	return s
}

// NormalizeAuthType canonicalizes auth_type values into "oauth", "apikey", or "".
func NormalizeAuthType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "oauth", "oauth2":
		return "oauth"
	case "apikey", "api_key", "api-key":
		return "apikey"
	default:
		return ""
	}
}

// InferAuthType resolves the credential kind from explicit auth_type or field-shape hints.
func InferAuthType(id ProviderIdentity) string {
	if normalized := NormalizeAuthType(id.AuthType); normalized != "" {
		return normalized
	}
	authIDLower := strings.ToLower(strings.TrimSpace(id.AuthID))
	if strings.HasSuffix(authIDLower, ".json") {
		return "oauth"
	}
	if strings.Contains(authIDLower, ":apikey:") ||
		strings.HasPrefix(authIDLower, "openai-compatibility:") ||
		strings.TrimSpace(id.BaseURL) != "" ||
		strings.TrimSpace(id.ProviderName) != "" {
		return "apikey"
	}
	return ""
}

// ProviderInstanceKey returns the canonical filter/grouping key for one provider instance.
// The key never contains raw API keys.
func ProviderInstanceKey(id ProviderIdentity) string {
	provider := strings.TrimSpace(id.Provider)
	authID := strings.TrimSpace(id.AuthID)
	if authID != "" {
		return providerKeyPrefixID + provider + "|" + authID
	}
	authIndex := strings.TrimSpace(id.AuthIndex)
	if authIndex != "" {
		return providerKeyPrefixIdx + provider + "|" + authIndex
	}
	authType := NormalizeAuthType(id.AuthType)
	providerName := strings.TrimSpace(id.ProviderName)
	baseURL := strings.TrimSpace(id.BaseURL)
	oauthSource := ""
	if authType == "oauth" {
		oauthSource = strings.TrimSpace(id.Source)
	}
	if providerName != "" || baseURL != "" || oauthSource != "" {
		vals := url.Values{}
		if provider != "" {
			vals.Set("p", provider)
		}
		if authType != "" {
			vals.Set("t", authType)
		}
		if providerName != "" {
			vals.Set("n", providerName)
		}
		if baseURL != "" {
			vals.Set("u", baseURL)
		}
		if oauthSource != "" {
			vals.Set("s", oauthSource)
		}
		return providerKeyPrefixCfg + vals.Encode()
	}
	return provider
}

// IsStructuredProviderKey reports whether value uses one of the canonical provider key prefixes.
func IsStructuredProviderKey(value string) bool {
	return strings.HasPrefix(value, providerKeyPrefixID) ||
		strings.HasPrefix(value, providerKeyPrefixIdx) ||
		strings.HasPrefix(value, providerKeyPrefixCfg) ||
		strings.HasPrefix(value, providerKeyPrefixType)
}

type parsedProviderKey struct {
	kind         string // "id", "idx", "cfg", "type", "plain"
	provider     string
	authID       string
	authIndex    string
	authType     string
	providerName string
	baseURL      string
	oauthSource  string
}

func parseProviderFilterKey(raw string) parsedProviderKey {
	raw = strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(raw, providerKeyPrefixID):
		rest := strings.TrimPrefix(raw, providerKeyPrefixID)
		if p, id, ok := strings.Cut(rest, "|"); ok {
			return parsedProviderKey{kind: "id", provider: p, authID: id}
		}
	case strings.HasPrefix(raw, providerKeyPrefixIdx):
		rest := strings.TrimPrefix(raw, providerKeyPrefixIdx)
		if p, idx, ok := strings.Cut(rest, "|"); ok {
			return parsedProviderKey{kind: "idx", provider: p, authIndex: idx}
		}
	case strings.HasPrefix(raw, providerKeyPrefixCfg):
		rest := strings.TrimPrefix(raw, providerKeyPrefixCfg)
		if vals, err := url.ParseQuery(rest); err == nil {
			return parsedProviderKey{
				kind:         "cfg",
				provider:     vals.Get("p"),
				authType:     NormalizeAuthType(vals.Get("t")),
				providerName: vals.Get("n"),
				baseURL:      vals.Get("u"),
				oauthSource:  vals.Get("s"),
			}
		}
	case strings.HasPrefix(raw, providerKeyPrefixType):
		return parsedProviderKey{kind: "type", provider: strings.TrimPrefix(raw, providerKeyPrefixType)}
	}
	return parsedProviderKey{kind: "plain", provider: raw}
}

func providerFilterSQL(raw string) (string, []any) {
	parsed := parseProviderFilterKey(raw)
	switch parsed.kind {
	case "id":
		return "(provider = ? AND auth_id = ?)", []any{parsed.provider, parsed.authID}
	case "idx":
		return "(provider = ? AND auth_id = '' AND auth_index = ?)", []any{parsed.provider, parsed.authIndex}
	case "cfg":
		return "(provider = ? AND auth_id = '' AND auth_index = '' AND LOWER(auth_type) = ? AND provider_name = ? AND base_url = ? AND (CASE WHEN LOWER(auth_type) = 'oauth' AND source != '' AND source != api_key THEN source ELSE '' END) = ?)",
			[]any{parsed.provider, parsed.authType, parsed.providerName, parsed.baseURL, parsed.oauthSource}
	default:
		return "provider = ?", []any{parsed.provider}
	}
}

// MatchesProviderFilterKey evaluates whether e matches a canonical or plain provider key.
func MatchesProviderFilterKey(raw string, e *Entry) bool {
	if e == nil {
		return false
	}
	parsed := parseProviderFilterKey(raw)
	switch parsed.kind {
	case "id":
		return e.Provider == parsed.provider && e.AuthID == parsed.authID
	case "idx":
		return e.Provider == parsed.provider && e.AuthID == "" && e.AuthIndex == parsed.authIndex
	case "cfg":
		if e.Provider != parsed.provider || e.AuthID != "" || e.AuthIndex != "" {
			return false
		}
		authType := NormalizeAuthType(e.AuthType)
		if authType != parsed.authType || e.ProviderName != parsed.providerName || e.BaseURL != parsed.baseURL {
			return false
		}
		oauthSrc := ""
		if authType == "oauth" {
			oauthSrc = effectiveUpstreamSource(e.Source, e.APIKey)
		}
		return oauthSrc == parsed.oauthSource
	default:
		return e.Provider == parsed.provider
	}
}

// MatchesProviderSearch evaluates case-insensitive substring matching for free-text
// provider queries without probing raw API-key secrets.
func MatchesProviderSearch(term string, e *Entry) bool {
	if e == nil {
		return false
	}
	needle := strings.ToLower(strings.TrimSpace(term))
	if needle == "" {
		return true
	}
	if strings.Contains(strings.ToLower(e.Provider), needle) ||
		strings.Contains(strings.ToLower(e.ProviderName), needle) ||
		strings.Contains(strings.ToLower(e.AuthID), needle) ||
		strings.Contains(strings.ToLower(e.AuthType), needle) ||
		strings.Contains(strings.ToLower(e.BaseURL), needle) {
		return true
	}
	if NormalizeAuthType(e.AuthType) == "oauth" {
		if src := effectiveUpstreamSource(e.Source, e.APIKey); src != "" && strings.Contains(strings.ToLower(src), needle) {
			return true
		}
	}
	return false
}

// ExtractHost returns the normalized host (hostname or hostname:port) from a URL string.
func ExtractHost(rawURL string) string {
	raw := strings.TrimSpace(rawURL)
	if raw == "" {
		return ""
	}
	candidate := raw
	if !strings.Contains(candidate, "://") {
		candidate = "http://" + candidate
	}
	if parsed, err := url.Parse(candidate); err == nil && parsed.Host != "" {
		return parsed.Host
	}
	trimmed := raw
	if idx := strings.Index(trimmed, "://"); idx >= 0 {
		trimmed = trimmed[idx+3:]
	}
	if idx := strings.IndexAny(trimmed, "/?"); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	return strings.TrimSpace(trimmed)
}

// MaskSecret obscures an upstream API key for display (first 4 + ellipsis + last 4).
func MaskSecret(secret string) string {
	s := strings.TrimSpace(secret)
	if s == "" {
		return ""
	}
	runes := []rune(s)
	n := len(runes)
	if n <= 8 {
		if n <= 4 {
			return s
		}
		return string(runes[:2]) + "…" + string(runes[n-2:])
	}
	return string(runes[:4]) + "…" + string(runes[n-4:])
}

func displayProviderParts(provider string) (displayProvider string, compatFallback string) {
	trimmed := strings.TrimSpace(provider)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, openAICompatProviderPrefix) {
		rest := strings.TrimSpace(trimmed[len(openAICompatProviderPrefix):])
		return "openai-compatible", rest
	}
	if lower == "openai-compatibility" {
		return "openai-compatible", ""
	}
	return trimmed, ""
}

func cleanOAuthAuthID(provider, authID string) string {
	base := strings.TrimSpace(filepath.Base(strings.TrimSpace(authID)))
	if base == "" || base == "." || base == string(filepath.Separator) {
		return ""
	}
	if strings.HasSuffix(strings.ToLower(base), ".json") {
		base = base[:len(base)-5]
	}
	p := strings.ToLower(strings.TrimSpace(provider))
	if p != "" {
		lower := strings.ToLower(base)
		for _, sep := range []string{"-", "_"} {
			prefix := p + sep
			if strings.HasPrefix(lower, prefix) && len(base) > len(prefix) {
				base = base[len(prefix):]
				break
			}
		}
	}
	base = strings.TrimSpace(base)
	if strings.EqualFold(base, provider) {
		return ""
	}
	return base
}

func shortAuthIDToken(authID string) string {
	id := strings.TrimSpace(authID)
	if id == "" {
		return ""
	}
	if idx := strings.LastIndex(id, ":"); idx >= 0 && idx+1 < len(id) {
		token := strings.TrimSpace(id[idx+1:])
		if dash := strings.Index(token, "-"); dash > 0 {
			prefix := token[:dash]
			if len(prefix) > 8 {
				prefix = prefix[:8]
			}
			token = prefix + token[dash:]
		} else if len(token) > 8 {
			token = token[:8]
		}
		if token != "" {
			return "#" + token
		}
	}
	if strings.HasSuffix(strings.ToLower(id), ".json") {
		id = id[:len(id)-5]
	}
	if len(id) > 12 {
		id = id[:12]
	}
	return "#" + id
}

func shortHashToken(index string) string {
	idx := strings.TrimSpace(index)
	if idx == "" {
		return ""
	}
	if len(idx) > 8 {
		idx = idx[:8]
	}
	return "#" + idx
}

func primaryQualifier(id ProviderIdentity, authType, compatFallback string) string {
	name := strings.TrimSpace(id.ProviderName)
	host := ExtractHost(id.BaseURL)

	switch authType {
	case "oauth":
		if name != "" {
			return name
		}
		if src := strings.TrimSpace(id.Source); src != "" {
			return src
		}
		if stem := cleanOAuthAuthID(id.Provider, id.AuthID); stem != "" {
			return stem
		}
		if tok := shortHashToken(id.AuthIndex); tok != "" {
			return tok
		}
		return "oauth"
	case "apikey":
		if name != "" {
			return name
		}
		if compatFallback != "" {
			return compatFallback
		}
		if host != "" {
			return host
		}
		if masked := MaskSecret(id.Source); masked != "" {
			return masked
		}
		if tok := shortAuthIDToken(id.AuthID); tok != "" {
			return tok
		}
		if tok := shortHashToken(id.AuthIndex); tok != "" {
			return tok
		}
		return "apikey"
	default:
		if name != "" {
			return name
		}
		if compatFallback != "" {
			return compatFallback
		}
		if host != "" {
			return host
		}
		if stem := cleanOAuthAuthID(id.Provider, id.AuthID); stem != "" {
			return stem
		}
		if tok := shortHashToken(id.AuthIndex); tok != "" {
			return tok
		}
		return ""
	}
}

func formatProviderPair(displayProvider, qualifier string) string {
	if displayProvider == "" {
		return qualifier
	}
	if qualifier == "" {
		return displayProvider
	}
	return displayProvider + "(" + qualifier + ")"
}

type preparedProviderLabel struct {
	key             string
	identity        ProviderIdentity
	authType        string
	displayProvider string
	qualifier       string
	baseLabel       string
}

func prepareProviderLabel(id ProviderIdentity) preparedProviderLabel {
	authType := InferAuthType(id)
	dispProv, compatFallback := displayProviderParts(id.Provider)
	qual := primaryQualifier(id, authType, compatFallback)
	return preparedProviderLabel{
		key:             ProviderInstanceKey(id),
		identity:        id,
		authType:        authType,
		displayProvider: dispProv,
		qualifier:       qual,
		baseLabel:       formatProviderPair(dispProv, qual),
	}
}

// BuildProviderLabelMap resolves human-readable, collision-free labels keyed by
// ProviderInstanceKey across a set of provider identities.
// Duplicate entries with the same ProviderInstanceKey do not trigger disambiguation.
func BuildProviderLabelMap(identities []ProviderIdentity) map[string]string {
	unique := make([]preparedProviderLabel, 0, len(identities))
	seenKeys := make(map[string]int, len(identities))
	for _, id := range identities {
		prep := prepareProviderLabel(id)
		if idx, exists := seenKeys[prep.key]; exists {
			// Merge richer metadata if a later entry for the same key fills empty fields.
			unique[idx] = mergePreparedLabel(unique[idx], prep)
			continue
		}
		seenKeys[prep.key] = len(unique)
		unique = append(unique, prep)
	}

	byBase := make(map[string][]int, len(unique))
	for i := range unique {
		byBase[unique[i].baseLabel] = append(byBase[unique[i].baseLabel], i)
	}

	labels := make(map[string]string, len(unique))
	for baseLabel, indices := range byBase {
		if len(indices) == 1 {
			labels[unique[indices[0]].key] = baseLabel
			continue
		}
		disambiguateGroup(unique, indices, labels)
	}
	return labels
}

func mergePreparedLabel(existing, incoming preparedProviderLabel) preparedProviderLabel {
	merged := existing.identity
	if merged.ProviderName == "" && incoming.identity.ProviderName != "" {
		merged.ProviderName = incoming.identity.ProviderName
	}
	if merged.BaseURL == "" && incoming.identity.BaseURL != "" {
		merged.BaseURL = incoming.identity.BaseURL
	}
	if merged.Source == "" && incoming.identity.Source != "" {
		merged.Source = incoming.identity.Source
	}
	if merged.AuthType == "" && incoming.identity.AuthType != "" {
		merged.AuthType = incoming.identity.AuthType
	}
	if merged.AuthIndex == "" && incoming.identity.AuthIndex != "" {
		merged.AuthIndex = incoming.identity.AuthIndex
	}
	return prepareProviderLabel(merged)
}

func disambiguateGroup(items []preparedProviderLabel, indices []int, out map[string]string) {
	// Check whether authType differs within this colliding group.
	authTypes := make(map[string]struct{}, 2)
	hosts := make(map[string]struct{}, len(indices))
	for _, idx := range indices {
		it := items[idx]
		if it.authType != "" {
			authTypes[it.authType] = struct{}{}
		}
		if h := ExtractHost(it.identity.BaseURL); h != "" {
			hosts[h] = struct{}{}
		}
	}
	mixedAuthTypes := len(authTypes) > 1
	distinctHosts := len(hosts) > 1

	candidates := make(map[int]string, len(indices))
	counts := make(map[string]int, len(indices))

	for _, idx := range indices {
		it := items[idx]
		extra := pickDisambiguator(it, mixedAuthTypes, distinctHosts)
		qual := it.qualifier
		if extra != "" {
			if qual != "" {
				qual = qual + " · " + extra
			} else {
				qual = extra
			}
		}
		label := formatProviderPair(it.displayProvider, qual)
		candidates[idx] = label
		counts[label]++
	}

	// Second pass: if any two distinct keys still share the same label, append a guaranteed unique token.
	usedFinal := make(map[string]int, len(indices))
	for _, idx := range indices {
		it := items[idx]
		label := candidates[idx]
		if counts[label] > 1 {
			fallback := fallbackUniqueToken(it)
			if fallback != "" && !strings.Contains(label, fallback) {
				qual := it.qualifier
				extra := pickDisambiguator(it, mixedAuthTypes, distinctHosts)
				parts := make([]string, 0, 3)
				if qual != "" {
					parts = append(parts, qual)
				}
				if extra != "" && extra != fallback {
					parts = append(parts, extra)
				}
				parts = append(parts, fallback)
				label = formatProviderPair(it.displayProvider, strings.Join(parts, " · "))
			}
		}
		usedFinal[label]++
		out[it.key] = label
	}
}

func pickDisambiguator(it preparedProviderLabel, mixedAuthTypes, distinctHosts bool) string {
	if mixedAuthTypes && it.authType != "" {
		return it.authType
	}
	switch it.authType {
	case "apikey":
		if distinctHosts {
			if h := ExtractHost(it.identity.BaseURL); h != "" && !strings.EqualFold(h, it.qualifier) {
				return h
			}
		}
		if masked := MaskSecret(it.identity.Source); masked != "" && !strings.EqualFold(masked, it.qualifier) {
			return masked
		}
		return fallbackUniqueToken(it)
	case "oauth":
		if stem := cleanOAuthAuthID(it.identity.Provider, it.identity.AuthID); stem != "" && !strings.EqualFold(stem, it.qualifier) {
			return stem
		}
		return fallbackUniqueToken(it)
	default:
		if distinctHosts {
			if h := ExtractHost(it.identity.BaseURL); h != "" && !strings.EqualFold(h, it.qualifier) {
				return h
			}
		}
		return fallbackUniqueToken(it)
	}
}

func fallbackUniqueToken(it preparedProviderLabel) string {
	if tok := shortAuthIDToken(it.identity.AuthID); tok != "" {
		return tok
	}
	if tok := shortHashToken(it.identity.AuthIndex); tok != "" {
		return tok
	}
	if h := ExtractHost(it.identity.BaseURL); h != "" && !strings.EqualFold(h, it.qualifier) {
		return h
	}
	return ""
}
