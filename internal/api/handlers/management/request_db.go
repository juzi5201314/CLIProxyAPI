package management

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
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
	entries, total, errQuery := requestdb.QueryEntries(c.Request.Context(), query)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	records := make([]requestDBRecordResponse, 0, len(entries))
	for i := range entries {
		records = append(records, newRequestDBRecordResponse(&entries[i], false))
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
	c.JSON(200, newRequestDBRecordResponse(entry, true))
}

func newRequestDBRecordResponse(e *requestdb.Entry, withContent bool) requestDBRecordResponse {
	inputTokens := e.InputTokens
	if e.CacheReadTokens > 0 && inputTokens < e.CacheReadTokens {
		inputTokens += e.CacheReadTokens + e.CacheCreationTokens
	}
	totalTokens := e.TotalTokens
	if totalTokens == 0 && (inputTokens > 0 || e.OutputTokens > 0) {
		totalTokens = inputTokens + e.OutputTokens
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
		ProviderName:     e.ProviderName,
		ExecutorType:     e.ExecutorType,
		// CodexWebsocketsExecutor only stamps its name when the upstream call ran
		// over the Responses WebSocket transport; HTTP fallbacks record CodexExecutor.
		UpstreamWebsocket:        e.ExecutorType == "CodexWebsocketsExecutor",
		AuthID:                   e.AuthID,
		AuthIndex:                e.AuthIndex,
		AuthType:                 e.AuthType,
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
	query := requestdb.Query{}
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
	query.Model = strings.TrimSpace(c.Query("model"))
	query.APIKey = strings.TrimSpace(c.Query("api_key"))
	query.Provider = strings.TrimSpace(c.Query("provider"))
	query.SessionID = strings.TrimSpace(c.Query("session_id"))
	query.RequestID = strings.TrimSpace(c.Query("request_id"))
	if raw := strings.TrimSpace(c.Query("failed")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return query, 0, 0, errors.New("failed must be true or false")
		}
		query.Failed = &parsed
	}
	if raw := strings.TrimSpace(c.Query("status_code")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return query, 0, 0, errors.New("status_code must be a positive integer")
		}
		query.StatusCode = parsed
	}
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, 0, 0, errors.New("from must be a non-negative unix millisecond timestamp")
		}
		query.FromMS = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, 0, 0, errors.New("to must be a non-negative unix millisecond timestamp")
		}
		query.ToMS = parsed
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
