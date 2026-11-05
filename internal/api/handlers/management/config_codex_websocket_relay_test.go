package management

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestV8CodexWebsocketRelaySave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("config-version: 8\nserver: {port: 8317}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{cfg: cfg, configFilePath: path}
	router := gin.New()
	router.PATCH("/v8/management/config", h.ConfigV8)
	router.GET("/v8/management/config/*path", h.ConfigV8)
	body := `{"upstream":{"codex":{"websocket-relay":{"idle-ttl":"7m","max-memory":"128m"}}},"api-keys":{"codex":[{"name":"relay","base-url":"https://example.invalid/v1","keys":[{"api-key":"test","websocket-relay":true}]}]}}`
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPatch, "/v8/management/config", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("save: %d %s", response.Code, response.Body.String())
	}
	loaded, err := config.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	policy, err := loaded.ForAPIKey().Codex.WebsocketRelay.Policy()
	if err != nil || policy.IdleTTL != 7*time.Minute || policy.MaxMemory != 128<<20 || !loaded.CodexKey[0].WebsocketRelay {
		t.Fatalf("saved policy = %+v, error = %v", policy, err)
	}
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v8/management/config/upstream/codex/websocket-relay", nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "128m") {
		t.Fatalf("get: %d %s", get.Code, get.Body.String())
	}
	invalid := httptest.NewRecorder()
	router.ServeHTTP(invalid, httptest.NewRequest(http.MethodPatch, "/v8/management/config", strings.NewReader(`{"upstream":{"codex":{"websocket-relay":{"max-memory":"-1m"}}}}`)))
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid update: %d %s", invalid.Code, invalid.Body.String())
	}
	after, err := config.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.Codex.WebsocketRelay != loaded.Codex.WebsocketRelay {
		t.Fatal("invalid update changed saved policy")
	}
}
