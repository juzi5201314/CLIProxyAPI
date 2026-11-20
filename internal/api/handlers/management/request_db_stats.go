package management

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MoeForge/moego/json"
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pricing"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestdb"
)

const (
	defaultStreamBacklog = 100
	streamHeartbeatEvery = 15 * time.Second
	// defaultTimeseriesRangeMS backs the timeseries endpoint when the caller
	// sends no from/to bounds; the stats endpoint aggregates the whole table.
	defaultTimeseriesRangeMS = 24 * time.Hour
)

// parseRequestDBFilter fills the equality and range filters of a Query from
// the request; paging fields are left zero.
func parseRequestDBFilter(c *gin.Context) (requestdb.Query, error) {
	query := requestdb.Query{}
	query.Model = strings.TrimSpace(c.Query("model"))
	if rawModels := c.Query("models"); rawModels != "" {
		for _, m := range strings.Split(rawModels, ",") {
			if trimmed := strings.TrimSpace(m); trimmed != "" {
				query.Models = append(query.Models, trimmed)
			}
		}
	} else if arr := c.QueryArray("models[]"); len(arr) > 0 {
		for _, m := range arr {
			if trimmed := strings.TrimSpace(m); trimmed != "" {
				query.Models = append(query.Models, trimmed)
			}
		}
	}

	query.APIKey = strings.TrimSpace(c.Query("api_key"))
	if rawKeys := c.Query("api_keys"); rawKeys != "" {
		for _, k := range strings.Split(rawKeys, ",") {
			if trimmed := strings.TrimSpace(k); trimmed != "" {
				query.APIKeys = append(query.APIKeys, trimmed)
			}
		}
	} else if arr := c.QueryArray("api_keys[]"); len(arr) > 0 {
		for _, k := range arr {
			if trimmed := strings.TrimSpace(k); trimmed != "" {
				query.APIKeys = append(query.APIKeys, trimmed)
			}
		}
	}

	query.Provider = strings.TrimSpace(c.Query("provider"))
	if rawProviders := c.Query("providers"); rawProviders != "" {
		for _, p := range strings.Split(rawProviders, ",") {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				query.Providers = append(query.Providers, trimmed)
			}
		}
	} else if arr := c.QueryArray("providers[]"); len(arr) > 0 {
		for _, p := range arr {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				query.Providers = append(query.Providers, trimmed)
			}
		}
	}

	query.SessionID = strings.TrimSpace(c.Query("session_id"))
	query.RequestID = strings.TrimSpace(c.Query("request_id"))
	query.TraceID = strings.TrimSpace(c.Query("trace_id"))
	if raw := strings.TrimSpace(c.Query("failed")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return query, errors.New("failed must be true or false")
		}
		query.Failed = &parsed
	}
	if raw := strings.TrimSpace(c.Query("status_code")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return query, errors.New("status_code must be a positive integer")
		}
		query.StatusCode = parsed
	}
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, errors.New("from must be a non-negative unix millisecond timestamp")
		}
		query.FromMS = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return query, errors.New("to must be a non-negative unix millisecond timestamp")
		}
		query.ToMS = parsed
	}
	return query, nil
}

// GetRequestDBStats returns the aggregate summary (counts, tokens, latency /
// TTFT / TPS percentiles, TPS histogram) for the filtered range.
func (h *Handler) GetRequestDBStats(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	stats, errQuery := requestdb.GetStats(c.Request.Context(), query)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, stats)
}

// GetRequestDBTimeseries returns fixed-width interval buckets for the filtered
// range. interval (seconds) may be given explicitly; otherwise it is chosen so
// the range yields roughly 60-100 buckets. Without from/to the default range
// is the last 24 hours.
func (h *Handler) GetRequestDBTimeseries(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	if query.FromMS <= 0 && query.ToMS <= 0 {
		query.ToMS = time.Now().UnixMilli()
		query.FromMS = query.ToMS - defaultTimeseriesRangeMS.Milliseconds()
	} else if query.FromMS <= 0 {
		query.FromMS = query.ToMS - defaultTimeseriesRangeMS.Milliseconds()
	} else if query.ToMS <= 0 {
		query.ToMS = time.Now().UnixMilli()
	}
	interval := autoTimeseriesIntervalMS(query.ToMS - query.FromMS)
	if raw := strings.TrimSpace(c.Query("interval")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			c.JSON(400, gin.H{"error": "interval must be a positive number of seconds"})
			return
		}
		interval = parsed * 1000
	}
	points, errQuery := requestdb.GetTimeseries(c.Request.Context(), query, interval)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, gin.H{
		"interval_ms": interval,
		"from_ms":     query.FromMS,
		"to_ms":       query.ToMS,
		"points":      points,
	})
}

// autoTimeseriesIntervalMS picks a human-friendly bucket width that yields
// roughly 60-100 buckets over the requested range.
func autoTimeseriesIntervalMS(rangeMS int64) int64 {
	if rangeMS <= 0 {
		rangeMS = defaultTimeseriesRangeMS.Milliseconds()
	}
	steps := []int64{
		60_000, 300_000, 900_000, 1_800_000, 3_600_000,
		10_800_000, 21_600_000, 43_200_000, 86_400_000,
	}
	target := rangeMS / 90
	for _, step := range steps {
		if step >= target {
			return step
		}
	}
	return steps[len(steps)-1]
}

// GetRequestDBBreakdown returns the top groups of one dimension
// (model|provider|api_key|auth_id|session_id) for the filtered range.
func (h *Handler) GetRequestDBBreakdown(c *gin.Context) {
	query, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	dimension := strings.TrimSpace(c.Query("dimension"))
	if dimension == "" {
		c.JSON(400, gin.H{"error": "dimension is required (model, provider, api_key, auth_id, session_id)"})
		return
	}
	limit := 10
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			c.JSON(400, gin.H{"error": "limit must be a positive integer"})
			return
		}
		limit = parsed
	}
	rows, errQuery := requestdb.GetBreakdown(c.Request.Context(), query, dimension, limit)
	if errQuery != nil {
		c.JSON(requestDBErrorStatus(errQuery), gin.H{"error": errQuery.Error()})
		return
	}
	c.JSON(200, gin.H{"dimension": dimension, "rows": rows})
}

// GetRequestDBStream pushes live request records as server-sent events.
// Event types: "backlog" ({"records":[...]}) replayed on connect (oldest
// event first), "request" (one record) for live entries, and ": ping"
// comment heartbeats. When the server-side buffer overflows the stream is
// closed; clients reconnect and re-play the backlog.
func (h *Handler) GetRequestDBStream(c *gin.Context) {
	filter, errParse := parseRequestDBFilter(c)
	if errParse != nil {
		c.JSON(400, gin.H{"error": errParse.Error()})
		return
	}
	sub := requestdb.SubscribeStream(filter)
	defer requestdb.UnsubscribeStream(sub)

	writer := c.Writer
	header := writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	writer.WriteHeader(200)

	// Replay the recent backlog; live-only when the store is disabled. The
	// subscription is active already, so the client deduplicates by record id.
	backlog, errBacklog := requestdb.TailBacklog(c.Request.Context(), filter, defaultStreamBacklog)
	if errBacklog == nil && len(backlog) > 0 {
		resolveProviderName := h.buildProviderNameResolver()
		records := make([]requestDBRecordResponse, 0, len(backlog))
		for i := range backlog {
			records = append(records, newRequestDBRecordResponse(&backlog[i], false, resolveProviderName))
		}
		if !writeSSEEvent(writer, "backlog", gin.H{"records": records}) {
			return
		}
	}

	ticker := time.NewTicker(streamHeartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			if _, err := writer.WriteString(": ping\n\n"); err != nil {
				return
			}
			writer.Flush()
		case entry, ok := <-sub.Channel():
			if !ok {
				// Dropped as a slow consumer; the client reconnects.
				return
			}
			if !writeSSEEvent(writer, "request", newRequestDBRecordResponse(entry, false, h.buildProviderNameResolver())) {
				return
			}
		}
	}
}

// writeSSEEvent writes one named SSE event and flushes; false on client disconnect.
func writeSSEEvent(writer gin.ResponseWriter, event string, payload any) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		// Marshaling cannot fail for these shapes; keep the stream alive.
		return true
	}
	if _, err = writer.WriteString("event: " + event + "\ndata: " + string(data) + "\n\n"); err != nil {
		return false
	}
	writer.Flush()
	return true
}

// GetModelPrices returns the loaded model prices catalog, including custom overrides.
func (h *Handler) GetModelPrices(c *gin.Context) {
	prices := pricing.Global().GetAllPrices()
	customPrices := pricing.Global().GetCustomPrices()
	c.JSON(http.StatusOK, gin.H{
		"prices":        prices,
		"custom_prices": customPrices,
		"count":         len(prices),
	})
}

type setModelPriceRequest struct {
	Model                 string                        `json:"model"`
	InputCostPerToken     *float64                      `json:"input_cost_per_token"`
	OutputCostPerToken    *float64                      `json:"output_cost_per_token"`
	CacheReadCostPerToken *float64                      `json:"cache_read_cost_per_token"`
	Price                 *pricing.ModelPrice           `json:"price"`
	Prices                map[string]pricing.ModelPrice `json:"prices"`
}

// SetModelPrices updates or adds custom model pricing overrides.
func (h *Handler) SetModelPrices(c *gin.Context) {
	var req setModelPriceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	mgr := pricing.Global()

	// Batch update mode
	if len(req.Prices) > 0 {
		for model, p := range req.Prices {
			trimmed := strings.TrimSpace(model)
			if trimmed == "" {
				continue
			}
			if p.InputCostPerToken < 0 || p.OutputCostPerToken < 0 || p.CacheReadCostPerToken < 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "token costs cannot be negative"})
				return
			}
			if err := mgr.SetCustomPrice(trimmed, p); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"message":       "prices updated",
			"custom_prices": mgr.GetCustomPrices(),
		})
		return
	}

	// Single model mode
	model := strings.TrimSpace(req.Model)
	if model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model name is required"})
		return
	}

	var p pricing.ModelPrice
	if req.Price != nil {
		p = *req.Price
	} else {
		if req.InputCostPerToken != nil {
			p.InputCostPerToken = *req.InputCostPerToken
		}
		if req.OutputCostPerToken != nil {
			p.OutputCostPerToken = *req.OutputCostPerToken
		}
		if req.CacheReadCostPerToken != nil {
			p.CacheReadCostPerToken = *req.CacheReadCostPerToken
		}
	}

	if p.InputCostPerToken < 0 || p.OutputCostPerToken < 0 || p.CacheReadCostPerToken < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token costs cannot be negative"})
		return
	}

	if err := mgr.SetCustomPrice(model, p); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "price updated",
		"model":         model,
		"price":         p,
		"custom_prices": mgr.GetCustomPrices(),
	})
}

// DeleteModelPrice removes a custom price override for a model.
func (h *Handler) DeleteModelPrice(c *gin.Context) {
	model := strings.TrimSpace(c.Query("model"))
	if model == "" {
		var body struct {
			Model string `json:"model"`
		}
		if err := c.ShouldBindJSON(&body); err == nil {
			model = strings.TrimSpace(body.Model)
		}
	}

	if model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model parameter is required"})
		return
	}

	if err := pricing.Global().DeleteCustomPrice(model); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "custom price deleted",
		"model":         model,
		"custom_prices": pricing.Global().GetCustomPrices(),
	})
}
