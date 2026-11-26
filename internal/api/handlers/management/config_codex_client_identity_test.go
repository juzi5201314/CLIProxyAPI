package management

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestConfigV8CodexClientIdentity(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.yaml")
	if errWrite := os.WriteFile(file, []byte("config-version: 8\nserver: {port: 8317}\n"), 0600); errWrite != nil {
		t.Fatal(errWrite)
	}
	cfg, errLoad := config.LoadConfig(file)
	if errLoad != nil {
		t.Fatal(errLoad)
	}
	h := &Handler{cfg: cfg, configFilePath: file}
	router := gin.New()
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		router.Handle(method, "/v8/management/config/*path", h.ConfigV8)
	}
	request := func(method, path, body string, want int) string {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, "/v8/management/config/upstream/codex/client-identity"+path, strings.NewReader(body)))
		if response.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response.Body.String()
	}
	request(http.MethodPut, "", `{"user-agent-mode":"fallback","client-version":"0.173.0","version-mode":"override","version":"fixed-version"}`, http.StatusOK)
	if got := request(http.MethodGet, "/version", "", http.StatusOK); got != `"fixed-version"` {
		t.Fatalf("Version override was not exposed: %s", got)
	}
	loaded, errLoad := config.LoadConfig(file)
	if errLoad != nil || loaded.Codex.ClientIdentity.UserAgentMode != "fallback" || loaded.ForAPIKey().Codex.ClientIdentity.Version != "fixed-version" {
		t.Fatalf("client identity did not round-trip: %+v, %v", loaded, errLoad)
	}
	before, errRead := os.ReadFile(file)
	if errRead != nil {
		t.Fatal(errRead)
	}
	request(http.MethodPut, "/user-agent-mode", `"invalid"`, http.StatusUnprocessableEntity)
	request(http.MethodPut, "/version", `"bad\r\nInjected: yes"`, http.StatusUnprocessableEntity)
	if after, errRead := os.ReadFile(file); errRead != nil || string(after) != string(before) {
		t.Fatal("invalid client identity changed the stored configuration")
	}
	request(http.MethodDelete, "", "", http.StatusOK)
	loaded, errLoad = config.LoadConfig(file)
	if errLoad != nil || loaded.Codex.ClientIdentity != (config.CodexClientIdentityConfig{}) {
		t.Fatalf("deleted identity did not return to defaults: %v", errLoad)
	}
}
