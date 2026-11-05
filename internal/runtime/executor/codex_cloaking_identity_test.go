package executor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
)

func TestCodexCloakingOfficialSessionHeaders(t *testing.T) {
	for _, transport := range []string{"http", "websocket"} {
		for _, disabled := range []bool{false, true} {
			t.Run(transport+"/disabled="+strconv.FormatBool(disabled), func(t *testing.T) {
				cfg := &config.Config{Codex: config.CodexConfig{DisableCodexCloaking: disabled}}
				auth := &cliproxyauth.Auth{Provider: "codex", Attributes: map[string]string{"api_key": "test"}}
				ctx := util.WithSessionID(t.Context(), "playground-session")
				build := func() http.Header {
					if transport == "websocket" {
						return applyCodexWebsocketHeaders(ctx, nil, auth, "test", cfg, false, http.Header{"User-Agent": {"Mozilla/5.0"}})
					}
					req := httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
					applyCodexHeadersFromSources(req, auth, "test", true, cfg, http.Header{"User-Agent": {"Mozilla/5.0"}})
					return req.Header
				}
				headers := build()
				if disabled {
					for _, key := range []string{"Session-Id", "Thread-Id", "X-Codex-Window-Id", "Version"} {
						if got := headers.Get(key); got != "" {
							t.Errorf("disabled cloaking injected %s=%q", key, got)
						}
					}
					return
				}
				session := headers.Get("Session-Id")
				if _, err := uuid.Parse(session); err != nil {
					t.Fatalf("missing valid session UUID: %q", session)
				}
				for _, key := range []string{"Thread-Id", "X-Codex-Window-Id"} {
					if headers.Get(key) != session {
						t.Errorf("%s=%q, want %q", key, headers.Get(key), session)
					}
				}
				if version := headers.Get("Version"); version == "" || !strings.Contains(headers.Get("User-Agent"), "/"+version+" ") {
					t.Fatalf("inconsistent client version: %q / %q", version, headers.Get("User-Agent"))
				}
				if headers.Get("Originator") != codexOriginator || headerValueCaseInsensitive(headers, "session_id") != "" {
					t.Fatal("wrong originator or legacy underscore session header")
				}
				if next := build(); next.Get("Session-Id") != session {
					t.Fatal("same session received a different identity")
				}
				if transport == "websocket" && headers.Get("X-Client-Request-Id") != headers.Get("Thread-Id") {
					t.Fatal("websocket request ID must default to thread ID")
				}
			})
		}
	}
}

func TestCodexCloakingPreservesExplicitSessionHeaders(t *testing.T) {
	for _, ws := range []bool{false, true} {
		t.Run(strconv.FormatBool(ws), func(t *testing.T) {
			cfg := &config.Config{}
			auth := &cliproxyauth.Auth{Provider: "codex", Attributes: map[string]string{"api_key": "test", "header:X-Codex-Window-Id": "configured-window"}}
			client := http.Header{"Session-Id": {"client-session"}, "Thread-Id": {"client-thread"}, "X-Codex-Window-Id": {"client-window"}, "X-Client-Request-Id": {"client-request"}, "Version": {"custom-version"}}
			var headers http.Header
			if ws {
				headers = applyCodexWebsocketHeaders(context.Background(), nil, auth, "test", cfg, true, client)
			} else {
				req := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
				applyCodexHeadersFromSources(req, auth, "test", true, cfg, client)
				headers = req.Header
			}
			for key, want := range map[string]string{"Session-Id": "client-session", "Thread-Id": "client-thread", "X-Codex-Window-Id": "configured-window", "X-Client-Request-Id": "client-request", "Version": "custom-version"} {
				if got := headers.Get(key); got != want {
					t.Errorf("%s=%q, want %q", key, got, want)
				}
			}
		})
	}
}

func TestCodexExecutorPlaygroundReceivesOfficialHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, key := range []string{"Session-Id", "Thread-Id", "X-Codex-Window-Id", "Version"} {
			if r.Header.Get(key) == "" {
				http.Error(w, "This account only allows Codex official clients: missing "+key, http.StatusForbidden)
				return
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-test\",\"output\":[]}}\n\n"))
	}))
	defer server.Close()
	cfg := &config.Config{}
	cfg.DisableImageGeneration = config.DisableImageGenerationAll
	auth := &cliproxyauth.Auth{Provider: "codex", Attributes: map[string]string{"api_key": "test", "base_url": server.URL}}
	req := cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"model":"gpt-5.4","input":[{"role":"user","content":"hello"}],"stream":true}`)}
	opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatOpenAIResponse, Headers: http.Header{"User-Agent": {"Mozilla/5.0"}}}
	result, err := NewCodexExecutor(cfg).ExecuteStream(helps.EnsureSessionContext(t.Context(), opts, req.Payload), auth, req, opts)
	if err != nil {
		t.Fatal(err)
	}
	for chunk := range result.Chunks {
		if chunk.Err != nil {
			t.Fatal(chunk.Err)
		}
	}
}
