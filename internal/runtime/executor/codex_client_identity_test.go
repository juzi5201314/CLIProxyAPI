package executor

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
)

func TestCodexClientIdentityPolicyAfterModelOverrides(t *testing.T) {
	for _, transport := range []string{"http", "websocket"} {
		for _, mode := range []string{"builtin", "passthrough", "fallback"} {
			for _, supplied := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/supplied=%v", transport, mode, supplied), func(t *testing.T) {
					identity := config.CodexClientIdentityConfig{UserAgentMode: mode, ClientVersion: "0.173.0", VersionMode: "builtin"}
					cfg := &config.Config{Codex: config.CodexConfig{ClientIdentity: identity}}
					source := http.Header{}
					if supplied {
						source.Set("User-Agent", "custom-client/1.0")
						source.Set("Version", "old-version")
					}
					auth := codexOAuthTestAuth("https://example.invalid")
					headers := http.Header{}
					if transport == "http" {
						req := httptest.NewRequest(http.MethodPost, "/responses", nil)
						applyCodexHeaders(req, auth, "test-token", true, cfg, source)
						headers = req.Header
					} else {
						headers = applyCodexWebsocketHeaders(t.Context(), headers, auth, "test-token", cfg, false, source)
					}
					// This catalog entry pins an old UA; operator policy must remain final.
					applyModelHeaderOverrides(t.Context(), headers, "gpt-5.6-luna", cfg, auth, source)
					wantUA := identity.UserAgent()
					if mode != "builtin" && supplied {
						wantUA = "custom-client/1.0"
					} else if mode == "passthrough" {
						wantUA = ""
					}
					if got := headers.Get("User-Agent"); got != wantUA {
						t.Fatalf("UA = %q, want %q", got, wantUA)
					}
					if got := headers.Get("Version"); got != "0.173.0" {
						t.Fatalf("Version = %q, want configured built-in version", got)
					}
				})
			}
		}
	}
}

func TestCodexClientVersionPolicies(t *testing.T) {
	for _, tt := range []struct {
		mode, downstream, want string
	}{
		{"auto", "", config.DefaultCodexClientVersion},
		{"auto", "client-version", "client-version"},
		{"builtin", "client-version", config.DefaultCodexClientVersion},
		{"passthrough", "client-version", "client-version"},
		{"passthrough", "", ""},
		{"override", "client-version", "fixed-version"},
		{"override", "", "fixed-version"},
	} {
		for _, transport := range []string{"http", "websocket"} {
			t.Run(transport+"/"+tt.mode+"/"+tt.downstream, func(t *testing.T) {
				cfg := &config.Config{Codex: config.CodexConfig{ClientIdentity: config.CodexClientIdentityConfig{VersionMode: tt.mode, Version: "fixed-version"}}}
				auth := codexOAuthTestAuth("https://example.invalid")
				source := http.Header{}
				if tt.downstream != "" {
					source.Set("Version", tt.downstream)
				}
				var headers http.Header
				if transport == "http" {
					req := httptest.NewRequest(http.MethodPost, "/responses", nil)
					applyCodexHeaders(req, auth, "test-token", true, cfg, source)
					headers = req.Header
				} else {
					headers = applyCodexWebsocketHeaders(t.Context(), nil, auth, "test-token", cfg, false, source)
				}
				if got := headers.Get("Version"); got != tt.want {
					t.Fatalf("Version = %q, want %q", got, tt.want)
				}
			})
		}
	}
}

func TestCodexExplicitIdentityOverridesCatalogAndCredentialHeaders(t *testing.T) {
	reg := registry.GetGlobalRegistry()
	clientID := "identity-header-policy-test"
	reg.RegisterClient(clientID, "codex", []*registry.ModelInfo{{
		ID: "identity-header-policy-model",
		Config: &registry.ModelConfig{OverrideHeader: map[string]string{
			"User-Agent": "catalog-client/0.1", "Version": "catalog-version", "X-Other": "catalog-value",
		}},
	}})
	t.Cleanup(func() { reg.UnregisterClient(clientID) })
	for _, mode := range []string{"builtin", "passthrough", "override"} {
		t.Run(mode, func(t *testing.T) {
			cfg := &config.Config{Codex: config.CodexConfig{
				DisableCodexCloaking: true,
				ClientIdentity:       config.CodexClientIdentityConfig{UserAgentMode: "passthrough", VersionMode: mode, Version: "fixed-version"},
			}}
			auth := codexOAuthTestAuth("https://example.invalid")
			auth.Attributes["header:User-Agent"] = "credential-client/0.1"
			auth.Attributes["header:Version"] = "credential-version"
			req := httptest.NewRequest(http.MethodPost, "/responses", nil)
			applyCodexHeaders(req, auth, "test-token", true, cfg, http.Header{})
			applyModelHeaderOverrides(t.Context(), req.Header, "identity-header-policy-model", cfg, auth, http.Header{})
			wantVersion := map[string]string{"builtin": config.DefaultCodexClientVersion, "passthrough": "", "override": "fixed-version"}[mode]
			if req.Header.Get("User-Agent") != "" || req.Header.Get("Version") != wantVersion || req.Header.Get("X-Other") != "catalog-value" {
				t.Fatalf("explicit identity lost to catalog/credential headers: %v", req.Header)
			}
		})
	}
}

func TestCodexClientIdentityOnWire(t *testing.T) {
	for _, transport := range []string{"http", "sse", "websocket"} {
		for _, supplied := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/supplied=%v", transport, supplied), func(t *testing.T) {
				captured := make(chan http.Header, 1)
				completed := `{"type":"response.completed","response":{"id":"resp_identity","status":"completed","model":"gpt-6.1-sol","output":[]}}`
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					captured <- r.Header.Clone()
					if transport == "websocket" {
						conn, errUpgrade := (&websocket.Upgrader{}).Upgrade(w, r, nil)
						if errUpgrade != nil {
							t.Error(errUpgrade)
							return
						}
						defer func() {
							if errClose := conn.Close(); errClose != nil {
								t.Logf("close upstream websocket: %v", errClose)
							}
						}()
						if _, _, errRead := conn.ReadMessage(); errRead != nil {
							t.Error(errRead)
							return
						}
						if errWrite := conn.WriteMessage(websocket.TextMessage, []byte(completed)); errWrite != nil {
							t.Error(errWrite)
						}
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if _, errWrite := io.WriteString(w, "data: "+completed+"\n\n"); errWrite != nil {
						t.Error(errWrite)
					}
				}))
				t.Cleanup(upstream.Close)
				cfg := &config.Config{Codex: config.CodexConfig{ClientIdentity: config.CodexClientIdentityConfig{UserAgentMode: "passthrough", VersionMode: "passthrough"}}}
				cfg.DisableImageGeneration = config.DisableImageGenerationAll
				req := cliproxyexecutor.Request{Model: "gpt-6.1-sol", Payload: []byte(`{"model":"gpt-6.1-sol","input":[{"role":"user","content":"OK"}],"store":false}`)}
				opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatOpenAIResponse, Headers: http.Header{}}
				if supplied {
					opts.Headers.Set("User-Agent", "custom-client/1.0")
					opts.Headers.Set("Version", "custom-version")
				}
				auth := codexOAuthTestAuth(upstream.URL)
				ctx := context.Background()
				var errExecute error
				switch transport {
				case "http":
					_, errExecute = NewCodexExecutor(cfg).Execute(ctx, auth, req, opts)
				case "sse":
					var stream *cliproxyexecutor.StreamResult
					stream, errExecute = NewCodexExecutor(cfg).ExecuteStream(ctx, auth, req, opts)
					if errExecute == nil {
						for chunk := range stream.Chunks {
							if chunk.Err != nil {
								t.Fatal(chunk.Err)
							}
						}
					}
				case "websocket":
					_, errExecute = NewCodexWebsocketsExecutor(cfg).Execute(ctx, auth, req, opts)
				}
				if errExecute != nil {
					t.Fatal(errExecute)
				}
				headers := <-captured
				if supplied {
					if headers.Get("User-Agent") != "custom-client/1.0" || headers.Get("Version") != "custom-version" {
						t.Fatalf("upstream identity changed: UA=%q Version=%q", headers.Get("User-Agent"), headers.Get("Version"))
					}
				} else {
					for name := range headers {
						if strings.EqualFold(name, "User-Agent") || strings.EqualFold(name, "Version") {
							t.Fatalf("strict passthrough injected %s=%q on the wire", name, headers.Values(name))
						}
					}
				}
			})
		}
	}
}
