package requestdb

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/MoeForge/moego/json"
	"github.com/google/uuid"
	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	coresession "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/session"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

func init() {
	coreusage.RegisterPlugin(&usageRecordPlugin{})
}

// usageRecordPlugin converts usage records into requestdb entries. It runs on
// the usage dispatcher goroutine, so HandleUsage only performs cheap row
// assembly; blob compression and SQLite writes happen on the writer goroutine.
type usageRecordPlugin struct{}

var ephemeralStreamID atomic.Int64

func (p *usageRecordPlugin) HandleUsage(ctx context.Context, record coreusage.Record) {
	mu.Lock()
	mgr := active
	mu.Unlock()
	streamSubs := streamSubscriberCount()
	if mgr == nil && streamSubs == 0 {
		return
	}
	entry := buildEntry(ctx, record)
	if mgr == nil {
		// Store is disabled, but live stream is active. Assign an ephemeral ID.
		entry.ID = ephemeralStreamID.Add(1)
		publishStreamEntry(&entry)
		return
	}
	mgr.enqueue(entry)
}

// buildEntry maps a usage record plus request-scoped context holders onto a
// database row. It mirrors the conversion semantics of internal/redisqueue.
func buildEntry(ctx context.Context, record coreusage.Record) Entry {
	requestedAt := record.RequestedAt
	if requestedAt.IsZero() {
		requestedAt = time.Now()
	}

	requestID := strings.TrimSpace(internallogging.GetRequestID(ctx))
	executionID := strings.TrimSpace(record.RequestID)
	if executionID == "" {
		executionID = requestID
	}
	if executionID == "" {
		executionID = uuid.NewString()
	}
	traceID := strings.TrimSpace(record.TraceID)
	if traceID == "" {
		traceID = requestID
	}

	clientMeta := internallogging.GetClientRequestMetadata(ctx)

	accessProvider := strings.TrimSpace(record.AccessProvider)
	if accessProvider == "" {
		accessProvider = strings.TrimSpace(coreusage.AccessProviderFromContext(ctx))
	}
	isNativeKey := record.IsNativeKey
	if !isNativeKey {
		if nativeExplicit, ok := coreusage.IsNativeKeyFromContext(ctx); ok {
			isNativeKey = nativeExplicit
		} else if accessProvider != "" {
			isNativeKey = coreusage.IsNativeAccessProvider(accessProvider)
		}
	}

	sessionID := strings.TrimSpace(record.SessionID)
	parentSessionID := strings.TrimSpace(record.ParentSessionID)
	if sessionID == "" {
		sessionID = strings.TrimSpace(clientMeta.SessionID)
		parentSessionID = strings.TrimSpace(clientMeta.ParentSessionID)
	} else if parentSessionID == "" && sessionID == strings.TrimSpace(clientMeta.SessionID) {
		parentSessionID = strings.TrimSpace(clientMeta.ParentSessionID)
	}
	sessionID = coresession.NormalizeToCanonicalUUID(sessionID)
	parentSessionID = coresession.NormalizeToCanonicalUUID(parentSessionID)
	if sessionID == "" || sessionID == parentSessionID {
		parentSessionID = ""
	}

	// record.ReasoningEffort is the level actually sent upstream (post
	// translation); the context value is the client-requested level.
	requestedReasoningEffort := strings.TrimSpace(coreusage.ReasoningEffortFromContext(ctx))

	serviceTier := strings.TrimSpace(record.ServiceTier)
	if serviceTier == "" {
		serviceTier = strings.TrimSpace(record.RequestServiceTier)
	}
	if serviceTier == "" {
		serviceTier = coreusage.ServiceTierFromContext(ctx)
	}

	failed := record.Failed
	if !failed {
		failed = !resolveSuccess(ctx)
	}
	statusCode := 200
	if failed {
		statusCode = resolveFailureStatus(ctx, record)
	}

	usageDetail := coreusage.EnsureTokenBreakdownForProvider(record.Detail, record.Provider, record.ExecutorType)

	inputTokens := usageDetail.InputTokens
	if usageDetail.TokenBreakdown.Valid() && usageDetail.TokenBreakdown.Input.TotalTokens > 0 {
		inputTokens = usageDetail.TokenBreakdown.Input.TotalTokens
	} else if usageDetail.CacheReadTokens > 0 && inputTokens < usageDetail.CacheReadTokens {
		inputTokens += usageDetail.CacheReadTokens + usageDetail.CacheCreationTokens
	}

	outputTokens := usageDetail.OutputTokens
	if usageDetail.TokenBreakdown.Valid() && usageDetail.TokenBreakdown.Output.TotalTokens > 0 {
		outputTokens = usageDetail.TokenBreakdown.Output.TotalTokens
	}

	totalTokens := usageDetail.TotalTokens
	if usageDetail.TokenBreakdown.Valid() && usageDetail.TokenBreakdown.TotalTokens > 0 {
		totalTokens = usageDetail.TokenBreakdown.TotalTokens
	} else if totalTokens == 0 && (inputTokens > 0 || outputTokens > 0) {
		totalTokens = inputTokens + outputTokens
	}

	return Entry{
		RequestedAtMS:            requestedAt.UnixMilli(),
		RequestID:                executionID,
		TraceID:                  traceID,
		Endpoint:                 strings.TrimSpace(internallogging.GetEndpoint(ctx)),
		ClientIP:                 clientMeta.ClientIP,
		ResolvedClientIP:         clientMeta.ResolvedClientIP,
		XForwardedFor:            clientMeta.XForwardedFor,
		UserAgent:                clientMeta.UserAgent,
		SessionID:                sessionID,
		ParentSessionID:          parentSessionID,
		APIKey:                   strings.TrimSpace(record.APIKey),
		AccessProvider:           accessProvider,
		IsNativeKey:              isNativeKey,
		Provider:                 strings.TrimSpace(record.Provider),
		ProviderName:             strings.TrimSpace(record.ProviderName),
		ExecutorType:             strings.TrimSpace(record.ExecutorType),
		AuthID:                   strings.TrimSpace(record.AuthID),
		AuthIndex:                strings.TrimSpace(record.AuthIndex),
		AuthType:                 strings.TrimSpace(record.AuthType),
		Source:                   strings.TrimSpace(record.Source),
		BaseURL:                  strings.TrimSpace(record.BaseURL),
		Model:                    strings.TrimSpace(record.Model),
		Alias:                    strings.TrimSpace(record.Alias),
		ResponseModel:            strings.TrimSpace(record.ResponseModel),
		ReasoningEffort:          strings.TrimSpace(record.ReasoningEffort),
		RequestedReasoningEffort: requestedReasoningEffort,
		ServiceTier:              serviceTier,
		EffectiveServiceTier:     strings.TrimSpace(record.EffectiveServiceTier),
		ResponseServiceTier:      strings.TrimSpace(record.ResponseServiceTier),
		Generate:                 coreusage.GenerateEnabled(record.Generate),
		Stream:                   record.Stream || coreusage.StreamFromContext(ctx),
		Failed:                   failed,
		StatusCode:               statusCode,
		LatencyMS:                record.Latency.Milliseconds(),
		TTFTMS:                   record.TTFT.Milliseconds(),
		InputTokens:              inputTokens,
		OutputTokens:             outputTokens,
		ReasoningTokens:          usageDetail.ReasoningTokens,
		CachedTokens:             usageDetail.CachedTokens,
		CacheReadTokens:          usageDetail.CacheReadTokens,
		CacheCreationTokens:      usageDetail.CacheCreationTokens,
		TotalTokens:              totalTokens,
		TokenBreakdown:           marshalJSON(usageDetail.TokenBreakdown),
		TimingBreakdown:          timingBreakdown(record.Timing),
		RequestHeaders:           marshalJSON(clientMeta.Headers),
		ResponseHeaders:          marshalJSON(record.ResponseHeaders),
		ErrorBody:                truncateErrorBody(record.Fail.Body),
		RequestPreview:           requestPreview(ctx),
		ResponsePreview:          responsePreview(ctx),
	}
}

// requestPreview/responsePreview read the middleware-captured first-N-bytes
// previews from the request-scoped holder; nil when capture is disabled.
func requestPreview(ctx context.Context) []byte {
	request, _ := internallogging.GetContentPreviewHolder(ctx).Previews()
	return request
}

func responsePreview(ctx context.Context) []byte {
	_, response := internallogging.GetContentPreviewHolder(ctx).Previews()
	return response
}

func timingBreakdown(timing *coreusage.TimingBreakdown) []byte {
	if !timing.Valid() {
		return nil
	}
	return marshalJSON(timing)
}

func truncateErrorBody(body string) []byte {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	limit := int(cfgErrorBodyMax.Load())
	if limit > 0 && len(body) > limit {
		body = body[:limit]
	}
	return []byte(body)
}

func marshalJSON(value any) []byte {
	if value == nil {
		return nil
	}
	if headers, ok := value.(http.Header); ok && len(headers) == 0 {
		return nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		log.WithError(err).Warn("requestdb: failed to marshal entry blob; skipping blob")
		return nil
	}
	return payload
}

func resolveSuccess(ctx context.Context) bool {
	status := internallogging.GetResponseStatus(ctx)
	if status == 0 {
		return true
	}
	return status < 400
}

func resolveFailureStatus(ctx context.Context, record coreusage.Record) int {
	if record.Fail.StatusCode > 0 {
		return record.Fail.StatusCode
	}
	if status := internallogging.GetResponseStatus(ctx); status > 0 {
		return status
	}
	return 500
}
