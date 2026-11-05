package executor

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
	"github.com/tidwall/gjson"
)

const relayTestUser = `{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}`
const relayTestAnswer = `{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"}]}`

func relayExecutorForTest(t *testing.T, url string, cfg *config.Config) (*CodexAutoExecutor, *cliproxyauth.Auth, cliproxyexecutor.Options) {
	t.Helper()
	if cfg == nil {
		cfg = &config.Config{}
	}
	cfg.DisableImageGeneration = config.DisableImageGenerationAll
	cfg.CodexKey = []config.CodexKey{{APIKey: "test", BaseURL: url, WebsocketRelay: true}}
	pool := newCodexHTTPRelayPool()
	configureCodexHTTPRelayPool(pool, cfg)
	ws := NewCodexWebsocketsExecutor(cfg)
	ws.store = &codexWebsocketSessionStore{sessions: make(map[string]*codexWebsocketSession)}
	exec := &CodexAutoExecutor{httpExec: NewCodexExecutor(cfg), wsExec: ws, relayPool: pool}
	t.Cleanup(func() { exec.CloseExecutionSession(cliproxyauth.CloseAllExecutionSessionsID) })
	auth := &cliproxyauth.Auth{ID: t.Name(), Provider: "codex", Attributes: map[string]string{"api_key": "test", "base_url": url, "websocket_relay": "true"}}
	opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatOpenAIResponse, Headers: http.Header{"X-Session-Id": {"session"}}, Metadata: map[string]any{cliproxyexecutor.CallerScopeMetadataKey: "caller"}}
	return exec, auth, opts
}

func relayConsume(t *testing.T, exec *CodexAutoExecutor, ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options, stream bool) string {
	t.Helper()
	if !stream {
		resp, err := exec.Execute(ctx, auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		return string(resp.Payload)
	}
	result, err := exec.ExecuteStream(ctx, auth, req, opts)
	if err != nil {
		t.Fatal(err)
	}
	if result.Headers.Get("Upgrade") != "" || result.Headers.Get("Sec-WebSocket-Accept") != "" {
		t.Fatal("upgrade headers leaked downstream")
	}
	var body strings.Builder
	for chunk := range result.Chunks {
		if chunk.Err != nil {
			t.Fatal(chunk.Err)
		}
		body.Write(chunk.Payload)
	}
	return body.String()
}

func TestCodexHTTPRelayProtocolsAndReuse(t *testing.T) {
	for _, format := range []sdktranslator.Format{sdktranslator.FormatOpenAIResponse, sdktranslator.FormatOpenAI, sdktranslator.FormatClaude} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%t", format, stream), func(t *testing.T) {
				var connections atomic.Int32
				captured := make(chan []byte, 8)
				upgrader := websocket.Upgrader{}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if !websocket.IsWebSocketUpgrade(r) {
						http.Error(w, "WS required", 400)
						return
					}
					if r.URL.Path != "/responses" || r.Header.Get("Originator") != codexOriginator || r.Header.Get("User-Agent") != codexUserAgent || r.Header.Get("OpenAI-Beta") != codexResponsesWebsocketBetaHeaderValue || r.Header.Get("Session-Id") == "" || r.Header.Get("Thread-Id") != r.Header.Get("X-Client-Request-Id") {
						t.Error("missing Codex handshake identity")
						http.Error(w, "Codex required", 403)
						return
					}
					conn, err := upgrader.Upgrade(w, r, nil)
					if err != nil {
						t.Error(err)
						return
					}
					defer func() { _ = conn.Close() }()
					connections.Add(1)
					for {
						_, body, errRead := conn.ReadMessage()
						if errRead != nil {
							return
						}
						captured <- body
						for _, event := range []string{
							`{"type":"response.created","response":{"id":"resp-1","model":"gpt-5.4","status":"in_progress","output":[]}}`,
							`{"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[]}}`,
							`{"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}`,
							`{"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"answer"}`,
							`{"type":"response.output_item.done","output_index":0,"item":` + relayTestAnswer + `}`,
							`{"type":"response.completed","response":{"id":"resp-1","model":"gpt-5.4","status":"completed","output":[` + relayTestAnswer + `],"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}`,
						} {
							if err := conn.WriteMessage(websocket.TextMessage, []byte(event)); err != nil {
								return
							}
						}
					}
				}))
				defer server.Close()
				exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
				opts.SourceFormat = format
				payloads := []string{`{"model":"gpt-5.4","input":[` + relayTestUser + `]}`, `{"model":"gpt-5.4","input":[` + relayTestUser + `,` + relayTestAnswer + `,` + relayTestUser + `]}`}
				if format != sdktranslator.FormatOpenAIResponse {
					payloads = []string{`{"model":"gpt-5.4","max_tokens":100,"messages":[{"role":"user","content":"hello"}]}`, `{"model":"gpt-5.4","max_tokens":100,"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"answer"},{"role":"user","content":"hello again"}]}`}
				}
				for i, payload := range payloads {
					ctx, cancel := context.WithCancel(t.Context())
					body := relayConsume(t, exec, ctx, auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(payload)}, opts, stream)
					cancel()
					if !strings.Contains(body, "answer") {
						t.Fatalf("missing downstream text: %s", body)
					}
					wire := <-captured
					if gjson.GetBytes(wire, "type").String() != "response.create" {
						t.Fatalf("invalid frame: %s", wire)
					}
					if gjson.GetBytes(wire, "client_metadata.session_id").String() == "" {
						t.Fatalf("missing metadata: %s", wire)
					}
					if i == 1 && format == sdktranslator.FormatOpenAIResponse && gjson.GetBytes(wire, "previous_response_id").String() != "resp-1" {
						t.Fatalf("missing incremental continuation: %s", wire)
					}
				}
				if connections.Load() != 1 {
					t.Fatalf("connections = %d, want reuse", connections.Load())
				}
			})
		}
	}
}

func TestCodexHTTPRelayRedirectAndReuse(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var redirects, connections atomic.Int32
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/responses" {
					redirects.Add(1)
					http.Redirect(w, r, "/v1/responses", http.StatusMovedPermanently)
					return
				}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = conn.Close() }()
				connections.Add(1)
				for {
					if _, _, errRead := conn.ReadMessage(); errRead != nil {
						return
					}
					if errWrite := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp-redirect","status":"completed","output":[`+relayTestAnswer+`]}}`)); errWrite != nil {
						return
					}
				}
			}))
			defer server.Close()
			exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
			for _, payload := range []string{
				`{"model":"gpt-5.4","input":[` + relayTestUser + `]}`,
				`{"model":"gpt-5.4","input":[` + relayTestUser + `,` + relayTestAnswer + `,` + relayTestUser + `]}`,
			} {
				body := relayConsume(t, exec, t.Context(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(payload)}, opts, stream)
				if !strings.Contains(body, "answer") {
					t.Fatalf("missing response after redirect: %s", body)
				}
			}
			if redirects.Load() != 1 || connections.Load() != 1 {
				t.Fatalf("redirects=%d connections=%d, want one reused websocket", redirects.Load(), connections.Load())
			}
		})
	}
}

func TestCodexHTTPRelayNoHTTPFallback(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					posts.Add(1)
				}
				http.Error(w, "unavailable", 426)
			}))
			defer server.Close()
			exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
			req := cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":"hello"}`)}
			var err error
			if stream {
				_, err = exec.ExecuteStream(t.Context(), auth, req, opts)
			} else {
				_, err = exec.Execute(t.Context(), auth, req, opts)
			}
			if err == nil || posts.Load() != 0 {
				t.Fatalf("error = %v, HTTP attempts = %d", err, posts.Load())
			}
		})
	}
}

func TestCodexHTTPRelayPayloadBarrier(t *testing.T) {
	captured := make(chan []byte, 4)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = conn.Close() }()
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			captured <- body
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp-1","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}}}`)); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	cfg := &config.Config{Payload: config.PayloadConfig{Filter: []config.PayloadFilterRule{{Models: []config.PayloadModelRule{{Name: "*"}}, Params: []string{"input.0", "client_metadata", "prompt_cache_key", "instructions", "previous_response_id"}}}}}
	exec, auth, opts := relayExecutorForTest(t, server.URL, cfg)
	for _, stream := range []bool{false, true} {
		relayConsume(t, exec, t.Context(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":[` + relayTestUser + `,` + relayTestUser + `]}`)}, opts, stream)
		wire := <-captured
		if gjson.GetBytes(wire, "input.#").Int() != 1 {
			t.Fatalf("filter applied more than once: %s", wire)
		}
		for _, path := range []string{"client_metadata", "prompt_cache_key", "instructions", "previous_response_id"} {
			if gjson.GetBytes(wire, path).Exists() {
				t.Fatalf("%s restored after filter: %s", path, wire)
			}
		}
	}
}
