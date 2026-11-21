package executor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/session"
	log "github.com/sirupsen/logrus"
)

// codexHTTPRelaySession owns only transport reuse state, not downstream history.
type codexHTTPRelaySession struct {
	id, identity, configKey string
	executor                *CodexWebsocketsExecutor
	state                   helps.CodexRelayState
	lifetime                context.Context
	cancel                  context.CancelFunc
}

var globalCodexHTTPRelayPool = newCodexHTTPRelayPool()

func newCodexHTTPRelayPool() *helps.CodexRelayPool[*codexHTTPRelaySession] {
	return helps.NewCodexRelayPool(config.CodexWebsocketRelayPolicy{}, func(s *codexHTTPRelaySession) int64 {
		// Reserve 64 KiB for opaque TLS/socket/reader overhead, plus 8 KiB for
		// explicit WS buffers and 2 KiB for session/index bookkeeping. This is
		// weighted idle-cache accounting, not a bound on the process RSS.
		return (64+8+2)*1024 + int64(len(s.id)+len(s.identity)+len(s.configKey)) + s.state.RetainedBytes()
	}, func(s *codexHTTPRelaySession) { s.cancel(); s.executor.CloseExecutionSession(s.id) })
}

func configureCodexHTTPRelayPool(pool *helps.CodexRelayPool[*codexHTTPRelaySession], cfg *config.Config) {
	var settings config.CodexWebsocketRelayConfig
	if cfg != nil {
		settings = cfg.Codex.WebsocketRelay
	}
	policy, err := settings.Policy()
	if err != nil {
		log.WithError(err).Warn("codex websocket relay: invalid cache policy")
		return
	}
	valid := make(map[string]bool)
	if cfg != nil {
		view := cfg.ForAPIKey()
		for _, entry := range cfg.CodexKey {
			if entry.WebsocketRelay && !entry.Disabled {
				valid[codexRelayConfigKey(view, entry)] = true
			}
		}
	}
	pool.Configure(policy, func(s *codexHTTPRelaySession) bool { return valid[s.configKey] })
}

func codexRelayConfigKey(cfg *config.Config, entry config.CodexKey) string {
	var values []any
	values = append(values, entry)
	if cfg != nil {
		behavior := cfg.Codex
		behavior.WebsocketRelay = config.CodexWebsocketRelayConfig{}
		values = append(values, behavior, cfg.Payload, cfg.ProxyURL, cfg.DisableImageGeneration, cfg.Client, cfg.CodexHeaderDefaults)
	}
	raw, err := json.Marshal(values)
	if err != nil {
		log.WithError(err).Error("codex websocket relay: encode transport configuration")
		return ""
	}
	return codexRelayDigest(raw)
}

func codexRelayDigest(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func codexWebsocketRelayEnabled(auth *cliproxyauth.Auth) bool {
	if !codexAuthUsesAPIKey(auth) {
		return false
	}
	enabled, err := strconv.ParseBool(auth.Attributes["websocket_relay"])
	return err == nil && enabled
}

func (e *CodexAutoExecutor) acquireHTTPRelay(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (*helps.CodexRelayLease[*codexHTTPRelaySession], cliproxyexecutor.Options, error) {
	var settings config.CodexWebsocketRelayConfig
	if e.httpExec.cfg != nil {
		settings = e.httpExec.cfg.Codex.WebsocketRelay
	}
	if _, err := settings.Policy(); err != nil {
		return nil, opts, err
	}
	caller := metadataString(opts.Metadata, cliproxyexecutor.CallerScopeMetadataKey)
	if caller == "" {
		caller = metadataString(req.Metadata, cliproxyexecutor.CallerScopeMetadataKey)
	}
	if caller == "" {
		caller = helps.APIKeyFromContext(ctx)
	}
	original := opts.OriginalRequest
	if len(original) == 0 {
		original = req.Payload
	}
	identity := ""
	if info, ok := session.ExtractSessionInfo(opts.Headers, original, nil); ok {
		identity = info.SessionID
	}
	if identity == "" {
		identity = helps.DerivedSessionID(opts.Metadata, req.Metadata)
	}
	if identity == "" {
		identity = executionSessionIDFromOptions(opts)
	}
	entry := resolveCodexKeyConfig(e.httpExec.cfg, auth)
	if entry == nil {
		entry = &config.CodexKey{APIKey: auth.Attributes["api_key"], BaseURL: auth.Attributes["base_url"], ProxyURL: auth.ProxyURL, WebsocketRelay: true}
	}
	configKey := codexRelayConfigKey(e.httpExec.cfg, *entry)
	key := ""
	providerID := uuid.NewString()
	if caller != "" && identity != "" {
		custom := (&http.Request{Header: make(http.Header)}).WithContext(ctx)
		util.ApplyCustomHeadersFromAttrs(custom, auth.Attributes, opts.Headers)
		token, baseURL := codexCredsForRequest(ctx, auth, opts.Headers)
		raw, err := json.Marshal([]any{caller, identity, auth.ID, configKey, token, baseURL, custom.Header, executionProxyURL(ctx, e.httpExec.cfg, auth), req.Model, opts.SourceFormat.String()})
		if err != nil {
			return nil, opts, err
		}
		key = codexRelayDigest(raw)
		providerID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(key)).String()
	}
	lease, err := e.relayPool.Acquire(ctx, key, auth.ID, func() *codexHTTPRelaySession {
		lifetime, cancel := context.WithCancel(context.Background())
		return &codexHTTPRelaySession{id: "codex-http-relay:" + uuid.NewString(), identity: providerID, configKey: configKey, executor: e.wsExec, lifetime: lifetime, cancel: cancel}
	})
	if err != nil {
		return nil, opts, err
	}
	opts.Metadata = maps.Clone(opts.Metadata)
	opts.EnsureMetadata()[cliproxyexecutor.ExecutionSessionMetadataKey] = lease.Value.id
	return lease, opts, nil
}

func (e *CodexAutoExecutor) relayTurn(s *codexHTTPRelaySession) *helps.CodexRelayTurn {
	allowDelta := true
	if cfg := e.httpExec.cfg; cfg != nil {
		p := cfg.Payload
		allowDelta = len(p.Default)+len(p.DefaultRaw)+len(p.Override)+len(p.OverrideRaw)+len(p.Filter) == 0
	}
	return &helps.CodexRelayTurn{State: &s.state, Identity: s.identity, AllowDelta: allowDelta}
}

func (e *CodexAutoExecutor) executeHTTPRelay(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	lease, opts, err := e.acquireHTTPRelay(ctx, auth, req, opts)
	if err != nil {
		return cliproxyexecutor.Response{}, err
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(lease.Value.lifetime, cancel)
	defer func() { stop(); cancel() }()
	healthy := false
	defer func() {
		if !healthy || lease.Value.lifetime.Err() != nil {
			e.wsExec.CloseExecutionSession(lease.Value.id)
			healthy = false
		}
		lease.Release(healthy)
	}()
	turn := e.relayTurn(lease.Value)
	defer turn.Stop()
	for attempt := 0; ; attempt++ {
		resp, errExecute := e.wsExec.Execute(helps.WithCodexRelayTurn(ctx, turn), auth, req, opts)
		if errExecute != nil && attempt == 0 && turn.ReferenceRejected && ctx.Err() == nil {
			e.wsExec.CloseExecutionSession(lease.Value.id)
			turn.AllowDelta = false
			continue
		}
		healthy = errExecute == nil && turn.Completed && ctx.Err() == nil
		resp.Headers = codexRelayResponseHeaders(resp.Headers)
		return resp, errExecute
	}
}

func (e *CodexAutoExecutor) streamHTTPRelay(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	lease, opts, err := e.acquireHTTPRelay(ctx, auth, req, opts)
	if err != nil {
		return nil, err
	}
	turn := e.relayTurn(lease.Value)
	streamCtx, cancelRequest := context.WithCancel(helps.WithCodexRelayTurn(ctx, turn))
	stop := context.AfterFunc(lease.Value.lifetime, cancelRequest)
	cancel := func() { stop(); cancelRequest() }
	result, err := e.wsExec.ExecuteStream(streamCtx, auth, req, opts)
	retried := false
	if err != nil && turn.ReferenceRejected && ctx.Err() == nil {
		e.wsExec.CloseExecutionSession(lease.Value.id)
		turn.AllowDelta, retried = false, true
		result, err = e.wsExec.ExecuteStream(streamCtx, auth, req, opts)
	}
	if err != nil {
		turn.Stop()
		cancel()
		e.wsExec.CloseExecutionSession(lease.Value.id)
		lease.Release(false)
		return nil, err
	}
	out := make(chan cliproxyexecutor.StreamChunk)
	headers := codexRelayResponseHeaders(result.Headers)
	go func() {
		defer close(out)
		defer cancel()
		healthy := false
		defer func() {
			if !healthy || lease.Value.lifetime.Err() != nil {
				e.wsExec.CloseExecutionSession(lease.Value.id)
				healthy = false
			}
			lease.Release(healthy)
		}()
		defer turn.Stop()
		emitted := false
		for {
			failed := false
			var rejected error
			for chunk := range result.Chunks {
				if chunk.Err != nil {
					failed = true
					if !retried && !emitted && turn.ReferenceRejected {
						rejected = chunk.Err
						continue
					}
				}
				select {
				case out <- chunk:
					emitted = true
				case <-ctx.Done():
					cancel()
					e.wsExec.CloseExecutionSession(lease.Value.id)
					// Wait for the producer before releasing its mutable turn state.
					for range result.Chunks {
					}
					return
				}
			}
			if rejected != nil && ctx.Err() == nil {
				e.wsExec.CloseExecutionSession(lease.Value.id)
				turn.AllowDelta, retried = false, true
				next, errRetry := e.wsExec.ExecuteStream(streamCtx, auth, req, opts)
				if errRetry == nil {
					result = next
					continue
				}
				select {
				case out <- cliproxyexecutor.StreamChunk{Err: errRetry}:
				case <-ctx.Done():
				}
				return
			}
			healthy = !failed && turn.Completed && ctx.Err() == nil
			return
		}
	}()
	return &cliproxyexecutor.StreamResult{Headers: headers, Chunks: out}, nil
}

func codexRelayResponseHeaders(headers http.Header) http.Header {
	out := headers.Clone()
	for _, token := range strings.Split(out.Get("Connection"), ",") {
		out.Del(strings.TrimSpace(token))
	}
	for key := range out {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "sec-websocket-") {
			delete(out, key)
			continue
		}
		switch lower {
		case "connection", "upgrade", "content-length", "transfer-encoding", "keep-alive", "trailer":
			delete(out, key)
		}
	}
	return out
}
