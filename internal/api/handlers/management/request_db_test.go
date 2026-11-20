package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestdb"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestParseRequestDBQueryDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records", nil)

	query, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if page != 1 || pageSize != defaultRequestDBPageSize {
		t.Fatalf("pagination = %d/%d, want 1/%d", page, pageSize, defaultRequestDBPageSize)
	}
	if query.Limit != defaultRequestDBPageSize || query.Offset != 0 {
		t.Fatalf("query paging = limit %d offset %d", query.Limit, query.Offset)
	}
	if query.Model != "" || query.Failed != nil || query.FromMS != 0 {
		t.Fatalf("empty query should produce zero filters: %+v", query)
	}
}

func TestParseRequestDBQueryFilters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records?model=gpt-test&api_key=key-1&provider=codex&session_id=s-1&request_id=r-1&failed=true&status_code=502&from=100&to=200&page=3&page_size=20", nil)

	query, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if page != 3 || pageSize != 20 {
		t.Fatalf("pagination = %d/%d, want 3/20", page, pageSize)
	}
	if query.Model != "gpt-test" || query.APIKey != "key-1" || query.Provider != "codex" {
		t.Fatalf("string filters mismatch: %+v", query)
	}
	if query.SessionID != "s-1" || query.RequestID != "r-1" {
		t.Fatalf("id filters mismatch: %+v", query)
	}
	if query.Failed == nil || !*query.Failed {
		t.Fatalf("failed filter = %v, want true", query.Failed)
	}
	if query.StatusCode != 502 || query.FromMS != 100 || query.ToMS != 200 {
		t.Fatalf("numeric filters mismatch: %+v", query)
	}
	if query.Limit != 20 || query.Offset != 40 {
		t.Fatalf("query paging = limit %d offset %d, want 20/40", query.Limit, query.Offset)
	}
}

func TestParseRequestDBQueryRejectsInvalidValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := map[string]string{
		"page":        "page=0",
		"page_size":   "page_size=-1",
		"failed":      "failed=yes",
		"status_code": "status_code=-5",
		"from":        "from=abc",
		"to":          "to=xyz",
	}
	for name, queryString := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/records?"+queryString, nil)
		if _, _, _, err := parseRequestDBQuery(c); err == nil {
			t.Fatalf("%s: parseRequestDBQuery() accepted invalid value", name)
		}
	}
}

func TestParseRequestDBQueryClampsPageSize(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records?page_size=100000", nil)

	_, page, pageSize, err := parseRequestDBQuery(c)
	if err != nil {
		t.Fatalf("parseRequestDBQuery() error = %v", err)
	}
	if pageSize != maxRequestDBPageSize {
		t.Fatalf("pageSize = %d, want clamped to %d", pageSize, maxRequestDBPageSize)
	}
	if page != 1 {
		t.Fatalf("page = %d, want 1", page)
	}
}

func TestGetRequestDBRecordsDisabledReturns503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/records", nil)

	handler.GetRequestDBRecords(c)
	if c.Writer.Status() != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when the request database is disabled", c.Writer.Status())
	}
}

func TestGetRequestDBStorageDisabledReturns503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/storage", nil)

	handler.GetRequestDBStorage(c)
	if c.Writer.Status() != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when the request database is disabled", c.Writer.Status())
	}
}

func TestCleanRequestDBDisabledReturns503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/clean", strings.NewReader(`{"action":"vacuum"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	handler.CleanRequestDB(c)
	if c.Writer.Status() != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when the request database is disabled", c.Writer.Status())
	}
}

func TestModelPricesManagementHandlers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{}

	// 1. Set a custom model price
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/observability/model-prices", strings.NewReader(`{
		"model": "test-custom-llm",
		"input_cost_per_token": 0.000003,
		"output_cost_per_token": 0.000012,
		"cache_read_cost_per_token": 0.000001
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	handler.SetModelPrices(c)
	if w.Code != http.StatusOK {
		t.Fatalf("SetModelPrices status = %d, want 200: %s", w.Code, w.Body.String())
	}

	// 2. Get model prices and verify custom price is present
	wGet := httptest.NewRecorder()
	cGet, _ := gin.CreateTestContext(wGet)
	cGet.Request = httptest.NewRequest(http.MethodGet, "/observability/model-prices", nil)

	handler.GetModelPrices(cGet)
	if wGet.Code != http.StatusOK {
		t.Fatalf("GetModelPrices status = %d, want 200: %s", wGet.Code, wGet.Body.String())
	}
	bodyStr := wGet.Body.String()
	if !strings.Contains(bodyStr, "test-custom-llm") {
		t.Fatalf("GetModelPrices body should contain test-custom-llm, got: %s", bodyStr)
	}

	// 3. Delete custom model price
	wDel := httptest.NewRecorder()
	cDel, _ := gin.CreateTestContext(wDel)
	cDel.Request = httptest.NewRequest(http.MethodDelete, "/observability/model-prices?model=test-custom-llm", nil)

	handler.DeleteModelPrice(cDel)
	if wDel.Code != http.StatusOK {
		t.Fatalf("DeleteModelPrice status = %d, want 200: %s", wDel.Code, wDel.Body.String())
	}
}

func TestRequestDBRecordResolvesConfiguredProviderName(t *testing.T) {
	manager := coreauth.NewManager(nil, nil, nil)
	_, errReg := manager.Register(context.Background(), &coreauth.Auth{
		ID:       "codex:apikey:fcbc1b1408d9",
		Provider: "codex",
		Label:    "chatflowsai",
		Attributes: map[string]string{
			"provider_name": "chatflowsai",
			"base_url":      "https://ai.chatflowsai.com/v1",
		},
	})
	if errReg != nil {
		t.Fatalf("manager.Register() error = %v", errReg)
	}

	handler := &Handler{
		authManager: manager,
		cfg: &config.Config{
			CodexKey: []config.CodexKey{
				{
					Name:    "千刀",
					BaseURL: "https://api666.zzzcoding.org/v1",
					APIKey:  "sk-test",
				},
			},
		},
	}

	resolver := handler.buildProviderNameResolver()

	// 1. Historical row with empty provider_name matched by AuthID
	byAuthID := newRequestDBRecordResponse(&requestdb.Entry{
		ID:       1,
		Provider: "codex",
		AuthID:   "codex:apikey:fcbc1b1408d9",
		BaseURL:  "https://ai.chatflowsai.com/v1",
	}, false, resolver)
	if byAuthID.ProviderName != "chatflowsai" {
		t.Fatalf("byAuthID.ProviderName = %q, want %q", byAuthID.ProviderName, "chatflowsai")
	}

	// 2. Historical row with empty provider_name matched by provider + base_url/host fallback
	byBaseURL := newRequestDBRecordResponse(&requestdb.Entry{
		ID:       2,
		Provider: "codex",
		BaseURL:  "http://api666.zzzcoding.org/v1",
	}, false, resolver)
	if byBaseURL.ProviderName != "千刀" {
		t.Fatalf("byBaseURL.ProviderName = %q, want %q", byBaseURL.ProviderName, "千刀")
	}
}
