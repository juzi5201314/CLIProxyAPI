package management

import (
	"errors"
	"net/url"
	"strconv"
	"strings"

	"github.com/MoeForge/moego/json"
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pricing"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestdb"
)

const (
	defaultRequestDBPageSize = 50
	maxRequestDBPageSize     = 500
)

// requestDBRecordResponse is the JSON shape of one stored request record.
type requestDBRecordResponse struct {
	ID                       int64           `json:"id"`
	RequestedAt              int64           `json:"requested_at"`
	RequestID                string          `json:"request_id"`
	TraceID                  string          `json:"trace_id,omitempty"`
	Endpoint                 string          `json:"endpoint,omitempty"`
	ClientIP                 string          `json:"client_ip,omitempty"`
	ResolvedClientIP         string          `json:"resolved_client_ip,omitempty"`
	XForwardedFor            string          `json:"x_forwarded_for,omitempty"`
	UserAgent                string          `json:"user_agent,omitempty"`
	SessionID                string          `json:"session_id,omitempty"`
	ParentSessionID          string          `json:"parent_session_id,omitempty"`
	APIKey                   string          `json:"api_key,omitempty"`
	AccessProvider           string          `json:"access_provider,omitempty"`
	IsNativeKey              bool            `json:"is_native_key"`
	Provider                 string          `json:"provider,omitempty"`
	ProviderName             string          `json:"provider_name,omitempty"`
	ProviderKey              string          `json:"provider_key,omitempty"`
	ProviderLabel            string          `json:"provider_label,omitempty"`
	ExecutorType             string          `json:"executor_type,omitempty"`
	UpstreamWebsocket        bool            `json:"upstream_websocket,omitempty"`
	AuthID                   string          `json:"auth_id,omitempty"`
	AuthIndex                string          `json:"auth_index,omitempty"`
	AuthType                 string          `json:"auth_type,omitempty"`
	Source                   string          `json:"source,omitempty"`
	BaseURL                  string          `json:"base_url,omitempty"`
	Model                    string          `json:"model,omitempty"`
	Alias                    string          `json:"alias,omitempty"`
	ResponseModel            string          `json:"response_model,omitempty"`
	ReasoningEffort          string          `json:"reasoning_effort,omitempty"`
	RequestedReasoningEffort string          `json:"requested_reasoning_effort,omitempty"`
	ServiceTier              string          `json:"service_tier,omitempty"`
	EffectiveServiceTier     string          `json:"effective_service_tier,omitempty"`
	ResponseServiceTier      string          `json:"response_service_tier,omitempty"`
	Generate                 bool            `json:"generate"`
	Stream                   bool            `json:"stream"`
	Failed                   bool            `json:"failed"`
	StatusCode               int             `json:"status_code"`
	LatencyMS                int64           `json:"latency_ms"`
	TTFTMS                   int64           `json:"ttft_ms"`
	InputTokens              int64           `json:"input_tokens"`
	OutputTokens             int64           `json:"output_tokens"`
	ReasoningTokens          int64           `json:"reasoning_tokens"`
	CachedTokens             int64           `json:"cached_tokens"`
	CacheReadTokens          int64           `json:"cache_read_tokens"`
	CacheCreationTokens      int64           `json:"cache_creation_tokens"`
	TotalTokens              int64           `json:"total_tokens"`
	EstimatedCostUSD         float64         `json:"estimated_cost_usd"`
	TokenBreakdown           json.RawMessage `json:"token_breakdown,omitempty"`
	RequestHeaders           json.RawMessage `json:"request_headers,omitempty"`
	ResponseHeaders          json.RawMessage `json:"response_headers,omitempty"`
	ErrorBody                string          `json:"error_body,omitempty"`
	RequestPreview           string          `json:"request_preview,omitempty"`
	ResponsePreview          string          `json:"response_preview,omitempty"`
}

// GetRequestDBRecords returns a page of request records from the fork-local
// request database, newest first. Supported query parameters: page, page_size,
// model, api_key, provider, session_id, request_id, failed, status_code,
// from, to (unix milliseconds).
func (h *Handler) GetRequestDBRecords(c *gin.Context) {
	if h == nil {
		c.JSON(500, gin.H{"error": "handler not initialized"})
		return
	}
	query, page, pageSize, errParse := parseRequestDBQuery(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	resolver := h.buildProviderResolver()
	resolver.expandQuery(&query)
	entries, total, errQuery := requestdb.QueryEntries(c.Request.Context(), query)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	resolved := resolver.resolveEntries(entries)
	records := make([]requestDBRecordResponse, 0, len(entries))
	for i := range entries {
		records = append(records, newRequestDBRecordResponseWithProvider(&entries[i], false, resolved[i]))
	}
	hasMore := int64(page*pageSize) < total
	c.JSON(200, gin.H{
		"records":   records,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"has_more":  hasMore,
	})
}

// GetRequestDBRecordDetail returns one request record including decompressed
// headers, error body and body previews.
func (h *Handler) GetRequestDBRecordDetail(c *gin.Context) {
	if h == nil {
		c.JSON(500, gin.H{"error": "handler not initialized"})
		return
	}
	id, errParse := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if errParse != nil || id <= 0 {
		c.JSON(400, gin.H{"error": "id must be a positive integer"})
		return
	}
	entry, errQuery := requestdb.GetEntryDetail(c.Request.Context(), id)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	if entry == nil {
		c.JSON(404, gin.H{"error": "record not found"})
		return
	}
	resolved := h.buildProviderResolver().resolveEntry(entry)
	c.JSON(200, newRequestDBRecordResponseWithProvider(entry, true, resolved))
}

func normalizeProviderBaseKey(provider, baseURL string) string {
	p := strings.ToLower(strings.TrimSpace(provider))
	b := strings.TrimRight(strings.ToLower(strings.TrimSpace(baseURL)), "/")
	if p == "" || b == "" {
		return ""
	}
	return p + "|" + b
}

func normalizeProviderHostKey(provider, baseURL string) string {
	p := strings.ToLower(strings.TrimSpace(provider))
	raw := strings.TrimSpace(baseURL)
	if p == "" || raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return p + "|" + strings.ToLower(u.Host)
}

type endpointNameEntry struct {
	name      string
	ambiguous bool
}

type resolvedProviderDisplay struct {
	Key          string
	Label        string
	ProviderName string
	AuthType     string
}

type providerResolver struct {
	byAuthID          map[string]requestdb.ProviderIdentity
	byAuthIndex       map[string]requestdb.ProviderIdentity
	byProviderBase    map[string]endpointNameEntry
	byProviderHost    map[string]endpointNameEntry
	liveIdentities    []requestdb.ProviderIdentity
	collidingLivePeer []requestdb.ProviderIdentity
	liveLabels        map[string]string
}

func (h *Handler) buildProviderResolver() *providerResolver {
	r := &providerResolver{
		byAuthID:       make(map[string]requestdb.ProviderIdentity),
		byAuthIndex:    make(map[string]requestdb.ProviderIdentity),
		byProviderBase: make(map[string]endpointNameEntry),
		byProviderHost: make(map[string]endpointNameEntry),
	}

	recordEndpoint := func(provider, baseURL, name string) {
		name = strings.TrimSpace(name)
		updateMap := func(m map[string]endpointNameEntry, key string) {
			if key == "" {
				return
			}
			existing, exists := m[key]
			if !exists {
				m[key] = endpointNameEntry{name: name}
				return
			}
			if existing.name != name {
				existing.ambiguous = true
				m[key] = existing
			}
		}
		updateMap(r.byProviderBase, normalizeProviderBaseKey(provider, baseURL))
		updateMap(r.byProviderHost, normalizeProviderHostKey(provider, baseURL))
	}

	if h != nil {
		h.mu.Lock()
		manager := h.authManager
		var cfg *config.Config
		if h.cfg != nil {
			cfg = h.cfg.CloneForRuntime()
		}
		h.mu.Unlock()

		if manager != nil {
			auths := manager.List()
			r.liveIdentities = make([]requestdb.ProviderIdentity, 0, len(auths))
			for _, auth := range auths {
				if auth == nil {
					continue
				}
				provider := strings.TrimSpace(auth.Provider)
				authID := strings.TrimSpace(auth.ID)
				authIdx := strings.TrimSpace(auth.Index)
				if authIdx == "" {
					authIdx = strings.TrimSpace(auth.EnsureIndex())
				}
				authType := requestdb.NormalizeAuthType(auth.AuthKind())
				name := ""
				baseURL := ""
				if auth.Attributes != nil {
					name = strings.TrimSpace(auth.Attributes["provider_name"])
					if name == "" {
						name = strings.TrimSpace(auth.Attributes["compat_name"])
					}
					baseURL = strings.TrimSpace(auth.Attributes["base_url"])
				}
				if baseURL == "" && auth.Metadata != nil {
					if v, ok := auth.Metadata["base_url"].(string); ok {
						baseURL = strings.TrimSpace(v)
					}
				}
				source := ""
				if authType == "oauth" {
					if strings.EqualFold(provider, "vertex") && auth.Metadata != nil {
						if v, ok := auth.Metadata["project_id"].(string); ok && strings.TrimSpace(v) != "" {
							source = strings.TrimSpace(v)
						} else if v, ok := auth.Metadata["project"].(string); ok && strings.TrimSpace(v) != "" {
							source = strings.TrimSpace(v)
						}
					}
					if source == "" {
						if _, val := auth.AccountInfo(); strings.TrimSpace(val) != "" {
							source = strings.TrimSpace(val)
						}
					}
					if source == "" && auth.Metadata != nil {
						if email, ok := auth.Metadata["email"].(string); ok {
							source = strings.TrimSpace(email)
						}
					}
				} else if auth.Attributes != nil {
					source = strings.TrimSpace(auth.Attributes["api_key"])
				}

				identity := requestdb.ProviderIdentity{
					Provider:     provider,
					ProviderName: name,
					AuthID:       authID,
					AuthIndex:    authIdx,
					AuthType:     authType,
					BaseURL:      baseURL,
					Source:       source,
				}
				identity.AuthType = requestdb.InferAuthType(identity)
				if authID != "" {
					r.byAuthID[authID] = identity
				}
				if authIdx != "" {
					r.byAuthIndex[authIdx] = identity
				}
				r.liveIdentities = append(r.liveIdentities, identity)
				if baseURL != "" {
					recordEndpoint(provider, baseURL, name)
				}
			}
		}

		if cfg != nil {
			for i := range cfg.GeminiKey {
				recordEndpoint("gemini", cfg.GeminiKey[i].BaseURL, cfg.GeminiKey[i].Name)
			}
			for i := range cfg.InteractionsKey {
				recordEndpoint("gemini-interactions", cfg.InteractionsKey[i].BaseURL, cfg.InteractionsKey[i].Name)
				recordEndpoint("interactions", cfg.InteractionsKey[i].BaseURL, cfg.InteractionsKey[i].Name)
			}
			for i := range cfg.ClaudeKey {
				recordEndpoint("claude", cfg.ClaudeKey[i].BaseURL, cfg.ClaudeKey[i].Name)
			}
			for i := range cfg.CodexKey {
				recordEndpoint("codex", cfg.CodexKey[i].BaseURL, cfg.CodexKey[i].Name)
			}
			for i := range cfg.XAIKey {
				recordEndpoint("xai", cfg.XAIKey[i].BaseURL, cfg.XAIKey[i].Name)
			}
			for i := range cfg.MetaKey {
				recordEndpoint("meta", cfg.MetaKey[i].BaseURL, cfg.MetaKey[i].Name)
			}
			for i := range cfg.VertexCompatAPIKey {
				recordEndpoint("vertex", cfg.VertexCompatAPIKey[i].BaseURL, cfg.VertexCompatAPIKey[i].Name)
			}
			for i := range cfg.OpenAICompatibility {
				compat := &cfg.OpenAICompatibility[i]
				recordEndpoint("openai-compatibility", compat.BaseURL, compat.Name)
				if lower := strings.ToLower(strings.TrimSpace(compat.Name)); lower != "" {
					recordEndpoint("openai-compatible-"+lower, compat.BaseURL, compat.Name)
				}
			}
		}
	}

	if len(r.liveIdentities) > 0 {
		r.liveLabels = requestdb.BuildProviderLabelMap(r.liveIdentities)
		// Collect only live identities whose default (un-disambiguated) label collides
		// with another live credential, so single-entry pages and live streams stay
		// disambiguated consistently without causing false collisions on historical rows
		// that lack auth_id.
		singleLabels := make(map[string][]requestdb.ProviderIdentity, len(r.liveIdentities))
		for _, id := range r.liveIdentities {
			single := requestdb.BuildProviderLabelMap([]requestdb.ProviderIdentity{id})
			base := single[requestdb.ProviderInstanceKey(id)]
			singleLabels[base] = append(singleLabels[base], id)
		}
		for _, peers := range singleLabels {
			if len(peers) > 1 {
				r.collidingLivePeer = append(r.collidingLivePeer, peers...)
			}
		}
	}
	return r
}

func (r *providerResolver) resolveIdentity(id requestdb.ProviderIdentity) requestdb.ProviderIdentity {
	if r == nil {
		id.AuthType = requestdb.InferAuthType(id)
		return id
	}
	resolved := id
	var live requestdb.ProviderIdentity
	matchedLive := false
	if id.AuthID != "" {
		if m, ok := r.byAuthID[id.AuthID]; ok {
			live = m
			matchedLive = true
		}
	}
	if !matchedLive && id.AuthIndex != "" {
		if m, ok := r.byAuthIndex[id.AuthIndex]; ok {
			live = m
			matchedLive = true
		}
	}
	if matchedLive {
		if live.ProviderName != "" {
			resolved.ProviderName = live.ProviderName
		}
		if resolved.AuthType == "" && live.AuthType != "" {
			resolved.AuthType = live.AuthType
		}
		if resolved.BaseURL == "" && live.BaseURL != "" {
			resolved.BaseURL = live.BaseURL
		}
		if resolved.Source == "" && live.Source != "" {
			resolved.Source = live.Source
		}
		resolved.AuthType = requestdb.InferAuthType(resolved)
		return resolved
	}

	// Historical fallback for records whose auth_id is absent or no longer active:
	// only apply unambiguous endpoint-to-name mappings to avoid cross-credential misattribution.
	if resolved.ProviderName == "" && resolved.BaseURL != "" {
		if key := normalizeProviderBaseKey(resolved.Provider, resolved.BaseURL); key != "" {
			if ep, ok := r.byProviderBase[key]; ok && !ep.ambiguous && ep.name != "" {
				resolved.ProviderName = ep.name
			}
		}
		if resolved.ProviderName == "" {
			if hostKey := normalizeProviderHostKey(resolved.Provider, resolved.BaseURL); hostKey != "" {
				if ep, ok := r.byProviderHost[hostKey]; ok && !ep.ambiguous && ep.name != "" {
					resolved.ProviderName = ep.name
				}
			}
		}
	}
	resolved.AuthType = requestdb.InferAuthType(resolved)
	return resolved
}

func (r *providerResolver) resolveEntries(entries []requestdb.Entry) []resolvedProviderDisplay {
	if len(entries) == 0 {
		return nil
	}
	rawKeys := make([]string, len(entries))
	identities := make([]requestdb.ProviderIdentity, len(entries))
	all := make([]requestdb.ProviderIdentity, 0, len(r.collidingLivePeer)+len(entries))
	all = append(all, r.collidingLivePeer...)
	for i := range entries {
		raw := requestdb.EntryProviderIdentity(&entries[i])
		rawKeys[i] = requestdb.ProviderInstanceKey(raw)
		identities[i] = r.resolveIdentity(raw)
		all = append(all, identities[i])
	}
	labels := requestdb.BuildProviderLabelMap(all)
	out := make([]resolvedProviderDisplay, len(entries))
	for i, id := range identities {
		resolvedKey := requestdb.ProviderInstanceKey(id)
		out[i] = resolvedProviderDisplay{
			Key:          rawKeys[i],
			Label:        labels[resolvedKey],
			ProviderName: id.ProviderName,
			AuthType:     id.AuthType,
		}
	}
	return out
}

func (r *providerResolver) resolveEntry(e *requestdb.Entry) resolvedProviderDisplay {
	if e == nil {
		return resolvedProviderDisplay{}
	}
	raw := requestdb.EntryProviderIdentity(e)
	rawKey := requestdb.ProviderInstanceKey(raw)
	id := r.resolveIdentity(raw)
	resolvedKey := requestdb.ProviderInstanceKey(id)
	all := make([]requestdb.ProviderIdentity, 0, len(r.collidingLivePeer)+1)
	all = append(all, r.collidingLivePeer...)
	all = append(all, id)
	labels := requestdb.BuildProviderLabelMap(all)
	return resolvedProviderDisplay{
		Key:          rawKey,
		Label:        labels[resolvedKey],
		ProviderName: id.ProviderName,
		AuthType:     id.AuthType,
	}
}

func (r *providerResolver) enrichBreakdownRows(rows []requestdb.BreakdownRow) {
	if len(rows) == 0 {
		return
	}
	identities := make([]requestdb.ProviderIdentity, len(rows))
	all := make([]requestdb.ProviderIdentity, 0, len(r.collidingLivePeer)+len(rows))
	all = append(all, r.collidingLivePeer...)
	for i := range rows {
		raw := requestdb.ProviderIdentity{
			Provider:     rows[i].Provider,
			ProviderName: rows[i].ProviderName,
			AuthID:       rows[i].AuthID,
			AuthIndex:    rows[i].AuthIndex,
			AuthType:     rows[i].AuthType,
			BaseURL:      rows[i].BaseURL,
			Source:       rows[i].RawSource,
		}
		resolved := r.resolveIdentity(raw)
		identities[i] = resolved
		rows[i].ProviderName = resolved.ProviderName
		rows[i].AuthType = resolved.AuthType
		if rows[i].BaseURL == "" {
			rows[i].BaseURL = resolved.BaseURL
		}
		all = append(all, resolved)
	}
	labels := requestdb.BuildProviderLabelMap(all)
	for i := range rows {
		if label := labels[requestdb.ProviderInstanceKey(identities[i])]; label != "" {
			rows[i].Label = label
		} else if label := labels[rows[i].Key]; label != "" {
			rows[i].Label = label
		}
	}
}

// expandQuery augments free-text provider filters with matching live provider
// instance keys so historical rows (which may lack provider_name or email source)
// still match searches by their current configured name or label.
func (r *providerResolver) expandQuery(q *requestdb.Query) {
	if r == nil || q == nil || len(q.Providers) > 0 {
		return
	}
	term := strings.ToLower(strings.TrimSpace(q.Provider))
	if term == "" || requestdb.IsStructuredProviderKey(q.Provider) {
		return
	}
	seen := make(map[string]struct{})
	for _, id := range r.liveIdentities {
		key := requestdb.ProviderInstanceKey(id)
		label := r.liveLabels[key]
		matched := strings.Contains(strings.ToLower(id.Provider), term) ||
			strings.Contains(strings.ToLower(id.ProviderName), term) ||
			strings.Contains(strings.ToLower(id.AuthID), term) ||
			strings.Contains(strings.ToLower(id.AuthType), term) ||
			strings.Contains(strings.ToLower(id.BaseURL), term) ||
			strings.Contains(strings.ToLower(label), term)
		if !matched && id.AuthType == "oauth" && id.Source != "" {
			matched = strings.Contains(strings.ToLower(id.Source), term)
		}
		if matched {
			if _, exists := seen[key]; !exists {
				seen[key] = struct{}{}
				q.ProviderMatchKeys = append(q.ProviderMatchKeys, key)
			}
		}
	}
}

func (h *Handler) buildProviderNameResolver() func(*requestdb.Entry) string {
	resolver := h.buildProviderResolver()
	return func(e *requestdb.Entry) string {
		if e == nil {
			return ""
		}
		return resolver.resolveIdentity(requestdb.EntryProviderIdentity(e)).ProviderName
	}
}

func newRequestDBRecordResponse(e *requestdb.Entry, withContent bool, resolveProviderName func(*requestdb.Entry) string) requestDBRecordResponse {
	id := requestdb.EntryProviderIdentity(e)
	if resolveProviderName != nil {
		if resolved := strings.TrimSpace(resolveProviderName(e)); resolved != "" {
			id.ProviderName = resolved
		}
	}
	id.AuthType = requestdb.InferAuthType(id)
	key := requestdb.ProviderInstanceKey(id)
	labels := requestdb.BuildProviderLabelMap([]requestdb.ProviderIdentity{id})
	return newRequestDBRecordResponseWithProvider(e, withContent, resolvedProviderDisplay{
		Key:          key,
		Label:        labels[key],
		ProviderName: id.ProviderName,
		AuthType:     id.AuthType,
	})
}

func newRequestDBRecordResponseWithProvider(e *requestdb.Entry, withContent bool, provider resolvedProviderDisplay) requestDBRecordResponse {
	inputTokens := e.InputTokens
	if e.CacheReadTokens > 0 && inputTokens < e.CacheReadTokens {
		inputTokens += e.CacheReadTokens + e.CacheCreationTokens
	}
	totalTokens := e.TotalTokens
	if totalTokens == 0 && (inputTokens > 0 || e.OutputTokens > 0) {
		totalTokens = inputTokens + e.OutputTokens
	}
	providerName := strings.TrimSpace(provider.ProviderName)
	if providerName == "" {
		providerName = strings.TrimSpace(e.ProviderName)
	}
	authType := strings.TrimSpace(provider.AuthType)
	if authType == "" {
		authType = strings.TrimSpace(e.AuthType)
	}

	response := requestDBRecordResponse{
		ID:               e.ID,
		RequestedAt:      e.RequestedAtMS,
		RequestID:        e.RequestID,
		TraceID:          e.TraceID,
		Endpoint:         e.Endpoint,
		ClientIP:         e.ClientIP,
		ResolvedClientIP: e.ResolvedClientIP,
		XForwardedFor:    e.XForwardedFor,
		UserAgent:        e.UserAgent,
		SessionID:        e.SessionID,
		ParentSessionID:  e.ParentSessionID,
		APIKey:           e.APIKey,
		AccessProvider:   e.AccessProvider,
		IsNativeKey:      e.IsNativeKey,
		Provider:         e.Provider,
		ProviderName:     providerName,
		ProviderKey:      provider.Key,
		ProviderLabel:    provider.Label,
		ExecutorType:     e.ExecutorType,
		// CodexWebsocketsExecutor only stamps its name when the upstream call ran
		// over the Responses WebSocket transport; HTTP fallbacks record CodexExecutor.
		UpstreamWebsocket:        e.ExecutorType == "CodexWebsocketsExecutor",
		AuthID:                   e.AuthID,
		AuthIndex:                e.AuthIndex,
		AuthType:                 authType,
		Source:                   e.Source,
		BaseURL:                  e.BaseURL,
		Model:                    e.Model,
		Alias:                    e.Alias,
		ResponseModel:            e.ResponseModel,
		ReasoningEffort:          e.ReasoningEffort,
		RequestedReasoningEffort: e.RequestedReasoningEffort,
		ServiceTier:              e.ServiceTier,
		EffectiveServiceTier:     e.EffectiveServiceTier,
		ResponseServiceTier:      e.ResponseServiceTier,
		Generate:                 e.Generate,
		Stream:                   e.Stream,
		Failed:                   e.Failed,
		StatusCode:               e.StatusCode,
		LatencyMS:                e.LatencyMS,
		TTFTMS:                   e.TTFTMS,
		InputTokens:              inputTokens,
		OutputTokens:             e.OutputTokens,
		ReasoningTokens:          e.ReasoningTokens,
		CachedTokens:             e.CachedTokens,
		CacheReadTokens:          e.CacheReadTokens,
		CacheCreationTokens:      e.CacheCreationTokens,
		TotalTokens:              totalTokens,
	}
	model := e.Model
	if model == "" {
		model = e.Alias
	}
	if model == "" {
		model = e.ResponseModel
	}
	response.EstimatedCostUSD = pricing.CalculateCost(model, inputTokens, e.OutputTokens, e.CacheReadTokens)
	if !withContent {
		return response
	}
	response.TokenBreakdown = json.RawMessage(e.TokenBreakdown)
	response.RequestHeaders = json.RawMessage(e.RequestHeaders)
	response.ResponseHeaders = json.RawMessage(e.ResponseHeaders)
	response.ErrorBody = string(e.ErrorBody)
	response.RequestPreview = string(e.RequestPreview)
	response.ResponsePreview = string(e.ResponsePreview)
	return response
}

func parseRequestDBQuery(c *gin.Context) (requestdb.Query, int, int, error) {
	query, errFilter := parseRequestDBFilter(c)
	if errFilter != nil {
		return query, 0, 0, errFilter
	}
	page := 1
	pageSize := defaultRequestDBPageSize
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return query, 0, 0, errors.New("page must be a positive integer")
		}
		page = parsed
	}
	if raw := strings.TrimSpace(c.Query("page_size")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return query, 0, 0, errors.New("page_size must be a positive integer")
		}
		pageSize = parsed
	}
	if pageSize > maxRequestDBPageSize {
		pageSize = maxRequestDBPageSize
	}
	if raw := strings.TrimSpace(c.Query("before_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			return query, 0, 0, errors.New("before_id must be a positive integer")
		}
		query.BeforeID = parsed
	}
	query.Limit = pageSize
	query.Offset = (page - 1) * pageSize
	return query, page, pageSize, nil
}

func requestDBErrorStatus(err error) int {
	if errors.Is(err, requestdb.ErrDisabled) {
		return 503
	}
	return 500
}

// GetRequestDBStorage returns disk, row, and compression usage statistics of the request database.
func (h *Handler) GetRequestDBStorage(c *gin.Context) {
	if h == nil {
		c.JSON(500, gin.H{"error": "handler not initialized"})
		return
	}
	info, err := requestdb.GetStorageInfo(c.Request.Context())
	if err != nil {
		c.JSON(requestDBErrorStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, info)
}

// CleanRequestDB performs maintenance/cleanup operations (retention, size cap, payload stripping, vacuum).
func (h *Handler) CleanRequestDB(c *gin.Context) {
	if h == nil {
		c.JSON(500, gin.H{"error": "handler not initialized"})
		return
	}
	var opts requestdb.CleanOptions
	if err := c.ShouldBindJSON(&opts); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	result, err := requestdb.Clean(c.Request.Context(), opts)
	if err != nil {
		c.JSON(requestDBErrorStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, result)
}
