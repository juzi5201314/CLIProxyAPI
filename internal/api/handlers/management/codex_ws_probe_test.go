package management

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/MoeForge/moego/json"
	"github.com/MoeForge/moego/ojson"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func runCodexProbeRequest(t *testing.T, h *Handler, payload map[string]any) (int, codexWebsocketProbeResponse, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v8/management/requests/codex-websocket-probe", h.ProbeCodexWebsocket)

	raw, errMarshal := json.Marshal(payload)
	if errMarshal != nil {
		t.Fatalf("marshal request: %v", errMarshal)
	}
	req := httptest.NewRequest(http.MethodPost, "/v8/management/requests/codex-websocket-probe", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var resp codexWebsocketProbeResponse
	if rec.Code == http.StatusOK {
		if errUnmarshal := json.Unmarshal(rec.Body.Bytes(), &resp); errUnmarshal != nil {
			t.Fatalf("unmarshal response: %v; body=%s", errUnmarshal, rec.Body.String())
		}
	}
	return rec.Code, resp, rec.Body.String()
}

func TestProbeCodexWebsocketSupportedAndHeaders(t *testing.T) {
	t.Parallel()

	type capturedReq struct {
		Path       string
		Beta       string
		Auth       string
		CustomHdr  string
		UserAgent  string
		Originator string
		Payload    []byte
	}

	capturedCh := make(chan capturedReq, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, errUpgrade := upgrader.Upgrade(w, r, nil)
		if errUpgrade != nil {
			t.Errorf("upgrade websocket: %v", errUpgrade)
			return
		}
		defer func() {
			if errClose := conn.Close(); errClose != nil {
				t.Logf("close server conn: %v", errClose)
			}
		}()

		_, msg, errRead := conn.ReadMessage()
		if errRead != nil {
			t.Errorf("read probe message: %v", errRead)
			return
		}
		capturedCh <- capturedReq{
			Path:       r.URL.Path,
			Beta:       r.Header.Get("OpenAI-Beta"),
			Auth:       r.Header.Get("Authorization"),
			CustomHdr:  r.Header.Get("X-Custom-Probe"),
			UserAgent:  r.Header.Get("User-Agent"),
			Originator: r.Header.Get("Originator"),
			Payload:    msg,
		}
		if errWrite := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"resp_1"}}`)); errWrite != nil {
			t.Errorf("write response.created: %v", errWrite)
			return
		}
		if errWrite := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp_1"}}`)); errWrite != nil {
			t.Errorf("write response.completed: %v", errWrite)
		}
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{}}

	t.Run("default cloaking enabled", func(t *testing.T) {
		code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
			"base_url": server.URL + "/v1",
			"api_key":  "sk-codex-probe",
			"model":    "gpt-6.2-sol",
			"headers":  map[string]string{"X-Custom-Probe": "custom-val"},
		})
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
		}
		if !resp.Supported || resp.Status != "supported" || resp.ProbeMode != codexWebsocketProbeModePrewarm || resp.EventType != "response.completed" || resp.HTTPStatus != http.StatusSwitchingProtocols {
			t.Fatalf("unexpected probe response: %+v", resp)
		}

		got := <-capturedCh
		if got.Path != "/v1/responses" {
			t.Fatalf("path = %q, want /v1/responses", got.Path)
		}
		if !strings.Contains(got.Beta, "responses_websockets=") {
			t.Fatalf("OpenAI-Beta = %q, want responses_websockets=...", got.Beta)
		}
		if got.Auth != "Bearer sk-codex-probe" {
			t.Fatalf("Authorization = %q, want Bearer sk-codex-probe", got.Auth)
		}
		if got.CustomHdr != "custom-val" {
			t.Fatalf("X-Custom-Probe = %q, want custom-val", got.CustomHdr)
		}
		if !strings.HasPrefix(got.UserAgent, "codex-tui/") || got.Originator != "codex-tui" {
			t.Fatalf("expected codex cloaking headers, got UA=%q Originator=%q", got.UserAgent, got.Originator)
		}
		if ojson.GetBytesNoCopy(got.Payload, "type").String() != "response.create" {
			t.Fatalf("payload type = %q, want response.create", ojson.GetBytesNoCopy(got.Payload, "type").String())
		}
		if ojson.GetBytesNoCopy(got.Payload, "model").String() != "gpt-6.2-sol" {
			t.Fatalf("payload model = %q, want gpt-6.2-sol", ojson.GetBytesNoCopy(got.Payload, "model").String())
		}
		if gen := ojson.GetBytesNoCopy(got.Payload, "generate"); !gen.Exists() || gen.Bool() {
			t.Fatalf("payload generate = %q, want false", gen.Raw)
		}
		if input := ojson.GetBytesNoCopy(got.Payload, "input"); !input.IsArray() || len(input.Array()) != 0 {
			t.Fatalf("payload input = %q, want []", input.Raw)
		}
		if inst := ojson.GetBytesNoCopy(got.Payload, "instructions").String(); !strings.HasPrefix(inst, "You are Codex") {
			t.Fatalf("payload instructions = %q, want Codex base_instructions", inst)
		}
		if parallel := ojson.GetBytesNoCopy(got.Payload, "parallel_tool_calls"); !parallel.Exists() || !parallel.Bool() {
			t.Fatalf("payload parallel_tool_calls = %q, want true", parallel.Raw)
		}
		if inc := ojson.GetBytesNoCopy(got.Payload, "include"); !inc.IsArray() || len(inc.Array()) == 0 || inc.Array()[0].String() != "reasoning.encrypted_content" {
			t.Fatalf("payload include = %q, want [\"reasoning.encrypted_content\"]", inc.Raw)
		}
		if ojson.GetBytesNoCopy(got.Payload, "max_output_tokens").Exists() {
			t.Fatalf("prewarm payload must not set max_output_tokens: %s", string(got.Payload))
		}
	})

	t.Run("disable_codex_cloaking true", func(t *testing.T) {
		disable := true
		code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
			"base_url":               server.URL,
			"api_key":                "sk-codex-probe",
			"disable_codex_cloaking": disable,
		})
		if code != http.StatusOK || !resp.Supported || resp.Status != "supported" {
			t.Fatalf("unexpected response code=%d resp=%+v raw=%s", code, resp, rawBody)
		}
		got := <-capturedCh
		if got.Originator != "" || strings.HasPrefix(got.UserAgent, "codex-tui/") {
			t.Fatalf("expected cloaking disabled for api key, got UA=%q Originator=%q", got.UserAgent, got.Originator)
		}
	})
}

func TestProbeCodexWebsocketInformationalFrameBeforeCreated(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, errUpgrade := upgrader.Upgrade(w, r, nil)
		if errUpgrade != nil {
			t.Errorf("upgrade websocket: %v", errUpgrade)
			return
		}
		defer func() {
			if errClose := conn.Close(); errClose != nil {
				t.Logf("close server conn: %v", errClose)
			}
		}()
		if _, _, errRead := conn.ReadMessage(); errRead != nil {
			t.Errorf("read message: %v", errRead)
			return
		}
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"rate_limits.updated","rate_limits":{}}`))
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"resp_ok"}}`))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{}}
	code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
		"base_url": server.URL,
		"api_key":  "sk-test",
	})
	if code != http.StatusOK || !resp.Supported || resp.Status != "supported" || resp.EventType != "response.created" {
		t.Fatalf("got code=%d resp=%+v raw=%s", code, resp, rawBody)
	}
}

func TestProbeCodexWebsocketClose1013NoAvailableAccount(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, errUpgrade := upgrader.Upgrade(w, r, nil)
		if errUpgrade != nil {
			t.Errorf("upgrade websocket: %v", errUpgrade)
			return
		}
		defer func() {
			if errClose := conn.Close(); errClose != nil {
				t.Logf("close server conn: %v", errClose)
			}
		}()
		_, _, _ = conn.ReadMessage()
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "no available account"))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{}}
	code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
		"base_url": server.URL,
		"api_key":  "sk-test",
		"model":    "gpt-6.2-sol",
	})
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
	}
	if resp.Supported || resp.Status != "unsupported" || resp.CloseCode != websocket.CloseTryAgainLater {
		t.Fatalf("got %+v, want supported=false status=unsupported close_code=1013", resp)
	}
	if !strings.Contains(resp.RawError, "1013") || !strings.Contains(resp.Message, "no available account") {
		t.Fatalf("expected 1013 and 'no available account' in response, got %+v", resp)
	}
}

func TestProbeCodexWebsocketHandshakeRejections(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		statusCode int
		body       string
		wantStatus string
	}{
		{name: "405 method not allowed", statusCode: http.StatusMethodNotAllowed, body: "method not allowed", wantStatus: "unsupported"},
		{name: "426 upgrade required", statusCode: http.StatusUpgradeRequired, body: "websocket upgrade required", wantStatus: "unsupported"},
		{name: "404 not found", statusCode: http.StatusNotFound, body: "not found", wantStatus: "unsupported"},
		{name: "501 not implemented", statusCode: http.StatusNotImplemented, body: "not implemented", wantStatus: "unsupported"},
		{name: "200 html response", statusCode: http.StatusOK, body: "<html>hello</html>", wantStatus: "unsupported"},
		{name: "401 unauthorized", statusCode: http.StatusUnauthorized, body: `{"error":{"message":"invalid api key","code":"invalid_api_key"}}`, wantStatus: "auth_error"},
		{name: "403 forbidden default", statusCode: http.StatusForbidden, body: "forbidden", wantStatus: "auth_error"},
		{name: "403 websocket disabled", statusCode: http.StatusForbidden, body: "WebSocket transport is disabled for this account", wantStatus: "unsupported"},
		{name: "429 rate limited", statusCode: http.StatusTooManyRequests, body: "too many requests", wantStatus: "rate_limited"},
		{name: "500 generic upstream error", statusCode: http.StatusInternalServerError, body: "internal server error", wantStatus: "upstream_error"},
		{name: "500 no available account", statusCode: http.StatusInternalServerError, body: "websocket: close 1013: no available account", wantStatus: "unsupported"},
	}

	h := &Handler{cfg: &config.Config{}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.WriteHeader(tc.statusCode)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()

			code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
				"base_url": server.URL,
				"api_key":  "sk-test",
			})
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
			}
			if resp.Supported || resp.Status != tc.wantStatus || resp.Stage != "handshake" || resp.HTTPStatus != tc.statusCode {
				t.Fatalf("got %+v, want supported=false status=%q stage=handshake http_status=%d", resp, tc.wantStatus, tc.statusCode)
			}
		})
	}
}

func TestProbeCodexWebsocketPostHandshakeErrorFrames(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		frame      string
		wantStatus string
	}{
		{
			name:       "model not found",
			frame:      `{"type":"error","error":{"code":"model_not_found","message":"The model does not exist"}}`,
			wantStatus: "model_error",
		},
		{
			name:       "invalid api key",
			frame:      `{"type":"error","status":401,"error":{"code":"invalid_api_key","message":"Incorrect API key provided"}}`,
			wantStatus: "auth_error",
		},
		{
			name:       "connection limit reached",
			frame:      `{"type":"error","error":{"code":"websocket_connection_limit_reached","message":"Too many open websocket connections"}}`,
			wantStatus: "rate_limited",
		},
		{
			name:       "websocket not supported",
			frame:      `{"type":"error","error":{"message":"This model does not support websocket transport"}}`,
			wantStatus: "unsupported",
		},
		{
			name:       "no available account in error frame",
			frame:      `{"type":"error","error":{"message":"no available account"}}`,
			wantStatus: "unsupported",
		},
		{
			name:       "response failed model error",
			frame:      `{"type":"response.failed","response":{"error":{"code":"unsupported_model","message":"model is not supported"}}}`,
			wantStatus: "model_error",
		},
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	h := &Handler{cfg: &config.Config{}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, errUpgrade := upgrader.Upgrade(w, r, nil)
				if errUpgrade != nil {
					t.Errorf("upgrade websocket: %v", errUpgrade)
					return
				}
				defer func() {
					if errClose := conn.Close(); errClose != nil {
						t.Logf("close server conn: %v", errClose)
					}
				}()
				_, _, _ = conn.ReadMessage()
				_ = conn.WriteMessage(websocket.TextMessage, []byte(tc.frame))
			}))
			defer server.Close()

			code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
				"base_url": server.URL,
				"api_key":  "sk-test",
			})
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
			}
			if resp.Supported || resp.Status != tc.wantStatus || resp.Stage != "response" {
				t.Fatalf("got %+v, want supported=false status=%q stage=response", resp, tc.wantStatus)
			}
		})
	}
}

func TestProbeCodexWebsocketAbruptCloseAndCloseCodes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		closeCode  int
		closeText  string
		rawDrop    bool
		wantStatus string
	}{
		{name: "abrupt EOF", rawDrop: true, wantStatus: "unsupported"},
		{name: "policy violation generic", closeCode: websocket.ClosePolicyViolation, closeText: "not allowed", wantStatus: "unsupported"},
		{name: "policy violation unauthorized", closeCode: websocket.ClosePolicyViolation, closeText: "unauthorized", wantStatus: "auth_error"},
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	h := &Handler{cfg: &config.Config{}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, errUpgrade := upgrader.Upgrade(w, r, nil)
				if errUpgrade != nil {
					t.Errorf("upgrade websocket: %v", errUpgrade)
					return
				}
				_, _, _ = conn.ReadMessage()
				if !tc.rawDrop {
					_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(tc.closeCode, tc.closeText))
				}
				_ = conn.Close()
			}))
			defer server.Close()

			code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
				"base_url": server.URL,
				"api_key":  "sk-test",
			})
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
			}
			if resp.Supported || resp.Status != tc.wantStatus {
				t.Fatalf("got %+v, want supported=false status=%q", resp, tc.wantStatus)
			}
			if !tc.rawDrop && resp.CloseCode != tc.closeCode {
				t.Fatalf("close_code = %d, want %d", resp.CloseCode, tc.closeCode)
			}
		})
	}
}

func TestProbeCodexWebsocketValidationErrors(t *testing.T) {
	t.Parallel()

	h := &Handler{cfg: &config.Config{}}
	cases := []struct {
		name    string
		payload map[string]any
	}{
		{name: "missing base_url", payload: map[string]any{"api_key": "sk-test"}},
		{name: "missing api_key", payload: map[string]any{"base_url": "https://example.com"}},
		{name: "invalid base_url scheme", payload: map[string]any{"base_url": "ftp://example.com", "api_key": "sk-test"}},
		{name: "invalid proxy_url", payload: map[string]any{"base_url": "https://example.com", "api_key": "sk-test", "proxy_url": "://bad-proxy"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			code, _, rawBody := runCodexProbeRequest(t, h, tc.payload)
			if code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", code, rawBody)
			}
		})
	}
}

func TestProbeCodexWebsocketFallbackChat(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		rejectMsg string
	}{
		{
			name:      "rejects generate parameter",
			rejectMsg: `{"type":"error","status":400,"error":{"type":"invalid_request_error","code":"unknown_parameter","param":"generate","message":"Unknown parameter: 'generate'."}}`,
		},
		{
			name:      "rejects empty input",
			rejectMsg: `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"input must not be empty"}}`,
		},
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	h := &Handler{cfg: &config.Config{}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var connCount atomic.Int32
			payloads := make(chan []byte, 2)

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, errUpgrade := upgrader.Upgrade(w, r, nil)
				if errUpgrade != nil {
					t.Errorf("upgrade websocket: %v", errUpgrade)
					return
				}
				defer func() {
					if errClose := conn.Close(); errClose != nil {
						t.Logf("close server conn: %v", errClose)
					}
				}()

				idx := connCount.Add(1)
				_, msg, errRead := conn.ReadMessage()
				if errRead != nil {
					t.Errorf("read message #%d: %v", idx, errRead)
					return
				}
				payloads <- msg

				if idx == 1 {
					_ = conn.WriteMessage(websocket.TextMessage, []byte(tc.rejectMsg))
					return
				}
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"resp_fb"}}`))
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.output_text.delta","delta":"OK"}`))
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp_fb"}}`))
			}))
			defer server.Close()

			code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
				"base_url": server.URL,
				"api_key":  "sk-test",
				"model":    "gpt-6.2-sol",
			})
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
			}
			if !resp.Supported || resp.Status != "supported" || resp.ProbeMode != codexWebsocketProbeModeFallbackChat || resp.EventType != "response.completed" {
				t.Fatalf("got %+v, want supported=true status=supported probe_mode=fallback_chat event_type=response.completed", resp)
			}
			if got := connCount.Load(); got != 2 {
				t.Fatalf("connection count = %d, want 2", got)
			}

			first := <-payloads
			second := <-payloads
			if ojson.GetBytesNoCopy(first, "generate").Bool() || !ojson.GetBytesNoCopy(first, "generate").Exists() {
				t.Fatalf("first payload must have generate=false, got %s", string(first))
			}
			if ojson.GetBytesNoCopy(second, "generate").Exists() {
				t.Fatalf("fallback payload must omit generate, got %s", string(second))
			}
			if ojson.GetBytesNoCopy(second, "max_output_tokens").Exists() {
				t.Fatalf("fallback payload must omit max_output_tokens, got %s", string(second))
			}
			text := ojson.GetBytesNoCopy(second, "input.0.content.0.text").String()
			if strings.TrimSpace(text) == "" || strings.EqualFold(strings.TrimSpace(text), "ping") {
				t.Fatalf("fallback payload text = %q, want natural non-ping prompt", text)
			}
			inst := ojson.GetBytesNoCopy(second, "instructions").String()
			if !strings.HasPrefix(inst, "You are Codex") {
				t.Fatalf("fallback instructions = %q, want Codex base_instructions", inst)
			}
		})
	}
}

func TestProbeCodexWebsocketNoFallbackOnNonPrewarmFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		frame      string
		close1013  bool
		wantStatus string
	}{
		{
			name:       "1013 no available account",
			close1013:  true,
			wantStatus: "unsupported",
		},
		{
			name:       "model not found",
			frame:      `{"type":"error","status":400,"error":{"type":"invalid_request_error","code":"model_not_found","message":"The model does not exist"}}`,
			wantStatus: "model_error",
		},
		{
			name:       "invalid api key",
			frame:      `{"type":"error","status":401,"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key"}}`,
			wantStatus: "auth_error",
		},
		{
			name:       "websocket not supported",
			frame:      `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"websocket is not supported for this upstream"}}`,
			wantStatus: "unsupported",
		},
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	h := &Handler{cfg: &config.Config{}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var connCount atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, errUpgrade := upgrader.Upgrade(w, r, nil)
				if errUpgrade != nil {
					t.Errorf("upgrade websocket: %v", errUpgrade)
					return
				}
				defer func() {
					if errClose := conn.Close(); errClose != nil {
						t.Logf("close server conn: %v", errClose)
					}
				}()
				connCount.Add(1)
				_, _, _ = conn.ReadMessage()
				if tc.close1013 {
					_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "no available account"))
					return
				}
				_ = conn.WriteMessage(websocket.TextMessage, []byte(tc.frame))
			}))
			defer server.Close()

			code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
				"base_url": server.URL,
				"api_key":  "sk-test",
			})
			if code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", code, rawBody)
			}
			if resp.Supported || resp.Status != tc.wantStatus {
				t.Fatalf("got %+v, want supported=false status=%q", resp, tc.wantStatus)
			}
			if got := connCount.Load(); got != 1 {
				t.Fatalf("connection count = %d, want 1 (must not fallback)", got)
			}
		})
	}
}

func TestProbeCodexWebsocketClosesGracefullyAfterCreatedOnly(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, errUpgrade := upgrader.Upgrade(w, r, nil)
		if errUpgrade != nil {
			t.Errorf("upgrade websocket: %v", errUpgrade)
			return
		}
		_, _, _ = conn.ReadMessage()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"resp_only"}}`))
		_ = conn.Close()
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{}}
	code, resp, rawBody := runCodexProbeRequest(t, h, map[string]any{
		"base_url": server.URL,
		"api_key":  "sk-test",
	})
	if code != http.StatusOK || !resp.Supported || resp.Status != "supported" || resp.EventType != "response.created" {
		t.Fatalf("got code=%d resp=%+v raw=%s", code, resp, rawBody)
	}
}
