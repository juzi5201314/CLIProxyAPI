package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	fileauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestPatchAuthFileFields_MaxConcurrencyAndListAndReset(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	authDir := t.TempDir()
	fileName := "conc.json"
	filePath := filepath.Join(authDir, fileName)
	store := fileauth.NewFileTokenStore()
	store.SetBaseDir(authDir)
	manager := coreauth.NewManager(store, nil, nil)
	record := &coreauth.Auth{
		ID:         fileName,
		FileName:   fileName,
		Provider:   "codex",
		Attributes: map[string]string{"path": filePath},
		Metadata:   map[string]any{"type": "codex"},
	}
	if _, errRegister := manager.Register(context.Background(), record); errRegister != nil {
		t.Fatalf("Register() error = %v", errRegister)
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, manager)

	patch := func(key, value string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		body := `{"name":"conc.json","` + key + `":` + value + `}`
		ctx.Request = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/fields", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		h.PatchAuthFileFields(ctx)
		return rec
	}

	if rec := patch("max_concurrency", "4"); rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	updated, ok := manager.GetByID(fileName)
	if !ok || updated.Attributes[coreauth.AttributeMaxConcurrency] != "4" {
		t.Fatalf("runtime max_concurrency = %#v, want 4", updated)
	}

	// Verify ListAuthFiles exposes max_concurrency.
	listRec := httptest.NewRecorder()
	listCtx, _ := gin.CreateTestContext(listRec)
	listCtx.Request = httptest.NewRequest(http.MethodGet, "/v8/management/credentials", nil)
	h.ListAuthFiles(listCtx)
	if listRec.Code != http.StatusOK {
		t.Fatalf("ListAuthFiles status = %d, body = %s", listRec.Code, listRec.Body.String())
	}
	var listResp struct {
		Files []map[string]any `json:"files"`
	}
	if errUnmarshal := json.Unmarshal(listRec.Body.Bytes(), &listResp); errUnmarshal != nil {
		t.Fatalf("Unmarshal ListAuthFiles error = %v", errUnmarshal)
	}
	if len(listResp.Files) != 1 || listResp.Files[0]["max_concurrency"] != float64(4) {
		t.Fatalf("ListAuthFiles files = %#v, want max_concurrency 4", listResp.Files)
	}

	// Legacy kebab-case alias normalizes to canonical max_concurrency.
	if rec := patch("max-concurrency", "6"); rec.Code != http.StatusOK {
		t.Fatalf("alias update status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	updated, _ = manager.GetByID(fileName)
	if updated.Attributes[coreauth.AttributeMaxConcurrency] != "6" {
		t.Fatalf("runtime alias max_concurrency = %q, want 6", updated.Attributes[coreauth.AttributeMaxConcurrency])
	}

	// Reset with null removes metadata and attribute cleanly.
	if rec := patch("max_concurrency", "null"); rec.Code != http.StatusOK {
		t.Fatalf("reset status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	updated, _ = manager.GetByID(fileName)
	if _, exists := updated.Attributes[coreauth.AttributeMaxConcurrency]; exists {
		t.Fatal("runtime max_concurrency remains after reset")
	}
	raw, errRead := os.ReadFile(filePath)
	if errRead != nil {
		t.Fatalf("ReadFile() after reset error = %v", errRead)
	}
	var persisted map[string]any
	if errUnmarshal := json.Unmarshal(raw, &persisted); errUnmarshal != nil {
		t.Fatalf("Unmarshal() after reset error = %v", errUnmarshal)
	}
	if _, exists := persisted["max_concurrency"]; exists {
		t.Fatal("persisted max_concurrency remains after reset")
	}
}

func TestPatchAuthFileFields_RejectsInvalidMaxConcurrency(t *testing.T) {
	store := &memoryAuthStore{}
	manager := coreauth.NewManager(store, nil, nil)
	record := &coreauth.Auth{ID: "auth.json", FileName: "auth.json", Provider: "codex", Metadata: map[string]any{"type": "codex"}}
	if _, errRegister := manager.Register(context.Background(), record); errRegister != nil {
		t.Fatalf("Register() error = %v", errRegister)
	}
	h := NewHandlerWithoutConfigFilePath(&config.Config{}, manager)

	for _, body := range []string{
		`{"name":"auth.json","max_concurrency":-1}`,
		`{"name":"auth.json","max_concurrency":1.5}`,
		`{"name":"auth.json","max_concurrency":1000001}`,
		`{"name":"auth.json","max_concurrency":9223372036854775808}`,
		`{"name":"auth.json","max_concurrency":"4"}`,
		`{"name":"auth.json","max_concurrency":true}`,
		`{"name":"auth.json","max_concurrency.nested":2}`,
	} {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		ctx.Request = httptest.NewRequest(http.MethodPatch, "/v8/management/credentials/fields", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		h.PatchAuthFileFields(ctx)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status=%d, want 400; resp=%s", body, rec.Code, rec.Body.String())
		}
	}
}

func TestConfigV8MaxConcurrencyRoundTripAndValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("config-version: 8\nserver:\n  port: 8317\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	h := &Handler{cfg: cfg, configFilePath: path}
	router := gin.New()
	router.GET("/v8/management/config/*path", h.ConfigV8)
	router.PUT("/v8/management/config/*path", h.ConfigV8)

	compatBody := `[{"name":"compat-1","base-url":"https://api.example.invalid/v1","max-concurrency":8,"keys":[{"api-key":"sk-1","max-concurrency":3},{"api-key":"sk-2"}]}]`
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/v8/management/config/api-keys/openai-compatibility", strings.NewReader(compatBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT compat status=%d body=%s", rec.Code, rec.Body.String())
	}

	geminiBody := `[{"name":"gemini-1","max-concurrency":2,"keys":[{"api-key":"gk-1"}]}]`
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/v8/management/config/api-keys/gemini", strings.NewReader(geminiBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT gemini status=%d body=%s", rec.Code, rec.Body.String())
	}

	// Verify GET returns both provider-level and per-key max-concurrency.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v8/management/config/api-keys/openai-compatibility", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET compat status=%d body=%s", rec.Code, rec.Body.String())
	}
	var compatOut []map[string]any
	if errUnmarshal := json.Unmarshal(rec.Body.Bytes(), &compatOut); errUnmarshal != nil {
		t.Fatalf("unmarshal compat GET: %v", errUnmarshal)
	}
	if len(compatOut) != 1 || compatOut[0]["max-concurrency"] != float64(8) {
		t.Fatalf("compatOut provider = %#v, want max-concurrency 8", compatOut)
	}
	keysOut, _ := compatOut[0]["keys"].([]any)
	if len(keysOut) != 2 {
		t.Fatalf("compatOut keys = %#v", keysOut)
	}
	k0, _ := keysOut[0].(map[string]any)
	if k0["max-concurrency"] != float64(3) {
		t.Fatalf("compatOut key[0] = %#v, want max-concurrency 3", k0)
	}

	// Verify on-disk parsed config holds both provider and per-key limits.
	loaded, errLoad := config.LoadConfig(path)
	if errLoad != nil {
		t.Fatal(errLoad)
	}
	if len(loaded.OpenAICompatibility) != 1 || loaded.OpenAICompatibility[0].MaxConcurrency == nil || *loaded.OpenAICompatibility[0].MaxConcurrency != 8 {
		t.Fatalf("loaded compat provider = %#v", loaded.OpenAICompatibility)
	}
	if len(loaded.GeminiKey) != 1 || loaded.GeminiKey[0].MaxConcurrency == nil || *loaded.GeminiKey[0].MaxConcurrency != 2 {
		t.Fatalf("loaded gemini = %#v", loaded.GeminiKey)
	}

	// Reject invalid negative provider or key max-concurrency.
	for _, bad := range []string{
		`[{"name":"compat-1","base-url":"https://api.example.invalid/v1","max-concurrency":-1,"keys":[{"api-key":"sk-1"}]}]`,
		`[{"name":"compat-1","base-url":"https://api.example.invalid/v1","keys":[{"api-key":"sk-1","max-concurrency":-2}]}]`,
	} {
		badRec := httptest.NewRecorder()
		router.ServeHTTP(badRec, httptest.NewRequest(http.MethodPut, "/v8/management/config/api-keys/openai-compatibility", strings.NewReader(bad)))
		if badRec.Code < http.StatusBadRequest {
			t.Fatalf("expected >=400 for bad compat payload %s, got %d", bad, badRec.Code)
		}
	}
}
