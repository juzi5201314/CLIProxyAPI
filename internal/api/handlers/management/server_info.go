package management

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/pluginhost"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/requestdb"
)

// GetServerInfo reports build metadata and server state as JSON. It mirrors
// the X-CPA-* response headers so clients get one structured endpoint.
func (h *Handler) GetServerInfo(c *gin.Context) {
	pluginsEnabled := false
	if h != nil {
		h.mu.Lock()
		if h.cfg != nil {
			pluginsEnabled = h.cfg.Plugins.Enabled
		}
		h.mu.Unlock()
	}
	c.JSON(200, gin.H{
		"version":         buildinfo.Version,
		"commit":          buildinfo.Commit,
		"build_date":      buildinfo.BuildDate,
		"plugin_support":  pluginhost.SupportPluginHeaderValue(),
		"plugins_enabled": pluginsEnabled,
		"uptime_seconds":  int64(time.Since(buildinfo.StartedAt).Seconds()),
		"request_db": gin.H{
			"enabled": requestdb.Enabled(),
		},
	})
}
