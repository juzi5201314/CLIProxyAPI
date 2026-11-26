package management

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MoeForge/moego/json"
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pluginhost"
)

func TestGetServerInfoReportsPluginSupportAndEnabledState(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name               string
		handler            *Handler
		wantPluginsEnabled bool
	}{
		{
			name:               "nil handler defaults plugins_enabled to false",
			handler:            nil,
			wantPluginsEnabled: false,
		},
		{
			name: "plugins disabled in config",
			handler: &Handler{
				cfg: &config.Config{
					Plugins: config.PluginsConfig{Enabled: false},
				},
			},
			wantPluginsEnabled: false,
		},
		{
			name: "plugins enabled in config",
			handler: &Handler{
				cfg: &config.Config{
					Plugins: config.PluginsConfig{Enabled: true},
				},
			},
			wantPluginsEnabled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodGet, "/v8/management/server/info", nil)

			tt.handler.GetServerInfo(c)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}

			var body struct {
				PluginSupport  string `json:"plugin_support"`
				PluginsEnabled bool   `json:"plugins_enabled"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal response: %v", err)
			}
			if wantSupport := pluginhost.SupportPluginHeaderValue(); body.PluginSupport != wantSupport {
				t.Fatalf("plugin_support = %q, want %q", body.PluginSupport, wantSupport)
			}
			if body.PluginsEnabled != tt.wantPluginsEnabled {
				t.Fatalf("plugins_enabled = %v, want %v", body.PluginsEnabled, tt.wantPluginsEnabled)
			}
		})
	}
}
