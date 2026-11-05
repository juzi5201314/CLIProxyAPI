package helps

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
)

// ApplyCodexClientIdentityHeaders completes the identity emitted by Codex's
// build_session_headers and CodexResponsesMetadata::compatibility_headers.
// Existing session/thread/window identities take precedence; a derived CPA
// session supplies a stable UUID for clients such as the browser playground.
// Source: openai/codex codex-rs/{codex-api/src/requests/headers.rs,
// core/src/responses_metadata.rs,model-provider-info/src/lib.rs} (2026-11-05).
func ApplyCodexClientIdentityHeaders(ctx context.Context, headers http.Header, version string) {
	sessionID := strings.TrimSpace(headers.Get("Session-Id"))
	if sessionID == "" {
		for key, values := range headers {
			if strings.EqualFold(key, "session_id") && len(values) > 0 {
				sessionID = strings.TrimSpace(values[0])
				break
			}
		}
	}
	if sessionID == "" {
		if identity := util.SessionIDFromContext(ctx); identity != "" {
			sessionID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("cli-proxy-api:codex:client-session:"+identity)).String()
		} else {
			sessionID = uuid.NewString()
		}
	}
	// Official current HTTP and WS clients use hyphens, not legacy underscores.
	for key := range headers {
		if strings.EqualFold(key, "session_id") || strings.EqualFold(key, "conversation_id") {
			delete(headers, key)
		}
	}
	headers.Set("Session-Id", sessionID)
	if strings.TrimSpace(headers.Get("Thread-Id")) == "" {
		headers.Set("Thread-Id", sessionID)
	}
	if strings.TrimSpace(headers.Get("X-Codex-Window-Id")) == "" {
		headers.Set("X-Codex-Window-Id", headers.Get("Thread-Id"))
	}
	if strings.TrimSpace(headers.Get("Version")) == "" {
		headers.Set("Version", version)
	}
}
