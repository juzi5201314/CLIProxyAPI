package management

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MoeForge/moego/json"
	"github.com/MoeForge/moego/ojson"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	xaiauth "github.com/router-for-me/CLIProxyAPI/v8/internal/auth/xai"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clienterror"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/proxyutil"
	log "github.com/sirupsen/logrus"
)

const (
	defaultAPICallTimeout                = 60 * time.Second
	defaultCodexWebsocketProbeTimeout    = 30 * time.Second
	codexWebsocketProbeMaxPreEventFrames = 8
	codexWebsocketProbeMaxStreamFrames   = 512
	codexWebsocketProbeMaxBodyBytes      = 8192
	codexWebsocketProbeModePrewarm       = "prewarm"
	codexWebsocketProbeModeFallbackChat  = "fallback_chat"
)

const (
	antigravityOAuthClientID     = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
	antigravityOAuthClientSecret = "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"
)

var antigravityOAuthTokenURL = "https://oauth2.googleapis.com/token"

type apiCallRequest struct {
	AuthIndexSnake  *string           `json:"auth_index"`
	AuthIndexCamel  *string           `json:"authIndex"`
	AuthIndexPascal *string           `json:"AuthIndex"`
	Method          string            `json:"method"`
	URL             string            `json:"url"`
	ProxyURL        string            `json:"proxy_url"`
	Header          map[string]string `json:"header"`
	Data            string            `json:"data"`
}

type apiCallResponse struct {
	StatusCode int                 `json:"status_code"`
	Header     map[string][]string `json:"header"`
	Body       string              `json:"body"`
}

// APICall makes a generic HTTP request on behalf of the management API caller.
// It is protected by the management middleware.
//
// Endpoint:
//
//	POST /v0/management/api-call
//
// Authentication:
//
//	Same as other management APIs (requires a management key and remote-management rules).
//	You can provide the key via:
//	- Authorization: Bearer <key>
//	- X-Management-Key: <key>
//
// Request JSON:
//   - auth_index / authIndex / AuthIndex (optional):
//     The credential "auth_index" from GET /v0/management/auth-files (or other endpoints returning it).
//     If omitted, credential-specific proxy selection is skipped.
//     If "$TOKEN$" is present and the credential or token cannot be resolved, the request fails with HTTP 400.
//   - method (required): HTTP method, e.g. GET, POST, PUT, PATCH, DELETE.
//   - url (required): Absolute URL including scheme and host, e.g. "https://api.example.com/v1/ping".
//   - proxy_url (optional): Proxy used for this request. Supports HTTP, HTTPS, SOCKS5, SOCKS5H,
//     and "direct"/"none" to explicitly bypass proxies. When set, credential and global proxies are ignored.
//   - header (optional): Request headers map.
//     Supports magic variable "$TOKEN$" which is replaced using the selected credential:
//     1) metadata.access_token
//     2) attributes.api_key
//     3) metadata.token / metadata.id_token / metadata.cookie
//     Example: {"Authorization":"Bearer $TOKEN$"}.
//     Note: if you need to override the HTTP Host header, set header["Host"].
//   - data (optional): Raw request body as string (useful for POST/PUT/PATCH).
//
// Proxy selection (highest priority first):
//  1. Request proxy_url (when set, lower-priority proxy settings are ignored)
//  2. Selected credential proxy_url
//  3. Global config proxy-url
//  4. Direct connect (environment proxies are not used)
//
// Response JSON (returned with HTTP 200 when the APICall itself succeeds):
//   - status_code: Upstream HTTP status code.
//   - header: Upstream response headers.
//   - body: Upstream response body as string.
//
// Example:
//
//	curl -sS -X POST "http://127.0.0.1:8317/v0/management/api-call" \
//	  -H "Authorization: Bearer <MANAGEMENT_KEY>" \
//	  -H "Content-Type: application/json" \
//	  -d '{"auth_index":"<AUTH_INDEX>","method":"GET","url":"https://api.example.com/v1/ping","header":{"Authorization":"Bearer $TOKEN$"}}'
//
//	curl -sS -X POST "http://127.0.0.1:8317/v0/management/api-call" \
//	  -H "Authorization: Bearer 831227" \
//	  -H "Content-Type: application/json" \
//	  -d '{"auth_index":"<AUTH_INDEX>","method":"POST","url":"https://api.example.com/v1/fetchAvailableModels","header":{"Authorization":"Bearer $TOKEN$","Content-Type":"application/json","User-Agent":"cliproxyapi"},"data":"{}"}'
func (h *Handler) APICall(c *gin.Context) {
	var body apiCallRequest
	if errBindJSON := c.ShouldBindJSON(&body); errBindJSON != nil {
		c.JSON(clienterror.HTTPStatusFromErrorOr(errBindJSON, http.StatusBadRequest), gin.H{"error": "invalid body"})
		return
	}

	method := strings.ToUpper(strings.TrimSpace(body.Method))
	if method == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing method"})
		return
	}

	urlStr := strings.TrimSpace(body.URL)
	if urlStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing url"})
		return
	}
	parsedURL, errParseURL := url.Parse(urlStr)
	if errParseURL != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid url"})
		return
	}

	requestProxyURL := strings.TrimSpace(body.ProxyURL)
	if requestProxyURL != "" {
		if _, errParseProxy := proxyutil.Parse(requestProxyURL); errParseProxy != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
			return
		}
	}

	authIndex := firstNonEmptyString(body.AuthIndexSnake, body.AuthIndexCamel, body.AuthIndexPascal)
	auth := h.authByIndex(authIndex)

	reqHeaders := body.Header
	if reqHeaders == nil {
		reqHeaders = map[string]string{}
	}

	var hostOverride string
	var token string
	var tokenResolved bool
	var tokenErr error

	resolveToken := func() error {
		if !tokenResolved {
			token, tokenErr = h.resolveTokenForAuth(c.Request.Context(), auth, requestProxyURL)
			tokenResolved = true
		}
		if token == "" {
			if tokenErr != nil {
				return errors.New("auth token refresh failed")
			}
			if authIndex != "" && auth == nil {
				return errors.New("auth credential not found for auth_index")
			}
			return errors.New("auth token not found")
		}
		return nil
	}

	for key, value := range reqHeaders {
		if !strings.Contains(value, "$TOKEN$") {
			continue
		}
		if errToken := resolveToken(); errToken != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": errToken.Error()})
			return
		}
		reqHeaders[key] = strings.ReplaceAll(value, "$TOKEN$", token)
	}

	if strings.Contains(body.Data, "$TOKEN$") {
		if errToken := resolveToken(); errToken != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": errToken.Error()})
			return
		}
		replacement := token
		if json.Valid([]byte(body.Data)) && strings.ContainsAny(token, "\"\\\r\n\t") {
			if b, errMarshal := json.Marshal(token); errMarshal == nil && len(b) >= 2 {
				replacement = string(b[1 : len(b)-1])
			}
		}
		body.Data = strings.ReplaceAll(body.Data, "$TOKEN$", replacement)
	}

	var requestBody io.Reader
	if body.Data != "" {
		requestBody = strings.NewReader(body.Data)
	}

	req, errNewRequest := http.NewRequestWithContext(c.Request.Context(), method, urlStr, requestBody)
	if errNewRequest != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to build request"})
		return
	}

	for key, value := range reqHeaders {
		if strings.EqualFold(key, "host") {
			hostOverride = strings.TrimSpace(value)
			continue
		}
		req.Header.Set(key, value)
	}
	if hostOverride != "" {
		req.Host = hostOverride
	}

	httpClient := &http.Client{
		Timeout: defaultAPICallTimeout,
	}
	httpClient.Transport = h.apiCallTransport(auth, requestProxyURL)

	resp, errDo := httpClient.Do(req)
	if errDo != nil {
		log.WithError(errDo).Debug("management APICall request failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": "request failed"})
		return
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("response body close error: %v", errClose)
		}
	}()

	respBody, errReadAll := io.ReadAll(resp.Body)
	if errReadAll != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read response"})
		return
	}

	c.JSON(http.StatusOK, apiCallResponse{
		StatusCode: resp.StatusCode,
		Header:     resp.Header,
		Body:       string(respBody),
	})
}

func firstNonEmptyString(values ...*string) string {
	for _, v := range values {
		if v == nil {
			continue
		}
		if out := strings.TrimSpace(*v); out != "" {
			return out
		}
	}
	return ""
}

func tokenValueForAuth(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if v := tokenValueFromMetadata(auth.Metadata); v != "" {
		return v
	}
	if auth.Attributes != nil {
		if v := strings.TrimSpace(auth.Attributes["api_key"]); v != "" {
			return v
		}
		if v := strings.TrimSpace(auth.Attributes["session_token"]); v != "" {
			return v
		}
	}
	return ""
}

func (h *Handler) resolveTokenForAuth(ctx context.Context, auth *coreauth.Auth, requestProxyURL string) (string, error) {
	if auth == nil {
		return "", nil
	}

	if strings.EqualFold(strings.TrimSpace(auth.Provider), "antigravity") {
		token, errToken := h.refreshAntigravityOAuthAccessToken(ctx, auth, requestProxyURL)
		return token, errToken
	}

	if strings.EqualFold(strings.TrimSpace(auth.Provider), "meta") {
		token, errToken := h.resolveMetaToken(ctx, auth, requestProxyURL)
		return token, errToken
	}

	if strings.EqualFold(strings.TrimSpace(auth.Provider), "xai") {
		token, errToken := h.resolveXAIToken(ctx, auth, requestProxyURL)
		return token, errToken
	}

	return tokenValueForAuth(auth), nil
}

func (h *Handler) resolveXAIToken(ctx context.Context, auth *coreauth.Auth, requestProxyURL string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if auth == nil {
		return "", nil
	}

	current := xaiTokenValue(auth)
	if current != "" && !xaiOAuthTokenNeedsRefresh(auth) {
		return current, nil
	}

	refreshToken := xaiRefreshToken(auth)
	if refreshToken == "" {
		return current, nil
	}

	proxyURL := strings.TrimSpace(requestProxyURL)
	if proxyURL == "" {
		proxyURL = strings.TrimSpace(auth.ProxyURL)
	}
	var cfg *config.Config
	if h != nil {
		cfg = h.cfg
	}
	svc := xaiauth.NewXAIAuthWithProxyURL(cfg, proxyURL)
	tokenEndpoint := xaiTokenEndpoint(auth)
	td, errRefresh := svc.RefreshTokens(ctx, refreshToken, tokenEndpoint)
	if errRefresh != nil {
		return "", errRefresh
	}
	if td == nil || strings.TrimSpace(td.AccessToken) == "" {
		return "", fmt.Errorf("xai oauth token refresh returned empty access_token")
	}

	now := time.Now()
	metadata := make(map[string]any, len(auth.Metadata)+10)
	if auth.Metadata != nil {
		for k, v := range auth.Metadata {
			metadata[k] = v
		}
	}
	metadata["type"] = "xai"
	metadata["auth_kind"] = "oauth"
	metadata["access_token"] = strings.TrimSpace(td.AccessToken)
	if strings.TrimSpace(td.RefreshToken) != "" {
		metadata["refresh_token"] = strings.TrimSpace(td.RefreshToken)
	}
	if strings.TrimSpace(td.IDToken) != "" {
		metadata["id_token"] = strings.TrimSpace(td.IDToken)
	}
	if strings.TrimSpace(td.TokenType) != "" {
		metadata["token_type"] = strings.TrimSpace(td.TokenType)
	}
	if td.ExpiresIn > 0 {
		metadata["expires_in"] = td.ExpiresIn
	}
	if strings.TrimSpace(td.Expire) != "" {
		metadata["expired"] = strings.TrimSpace(td.Expire)
	}
	if strings.TrimSpace(td.Email) != "" {
		metadata["email"] = strings.TrimSpace(td.Email)
	}
	if strings.TrimSpace(td.Subject) != "" {
		metadata["sub"] = strings.TrimSpace(td.Subject)
	}
	if tokenEndpoint != "" {
		metadata["token_endpoint"] = tokenEndpoint
	}
	if stringValue(metadata, "base_url") == "" {
		metadata["base_url"] = xaiauth.DefaultAPIBaseURL
	}
	metadata["last_refresh"] = now.UTC().Format(time.RFC3339)
	auth.Metadata = metadata

	attributes := make(map[string]string, len(auth.Attributes)+2)
	if auth.Attributes != nil {
		for k, v := range auth.Attributes {
			attributes[k] = v
		}
	}
	attributes["auth_kind"] = "oauth"
	if strings.TrimSpace(attributes["base_url"]) == "" {
		attributes["base_url"] = xaiauth.DefaultAPIBaseURL
	}
	auth.Attributes = attributes

	if ts := xaiTokenStorage(auth); ts != nil {
		copyStorage := *ts
		copyStorage.AccessToken = strings.TrimSpace(td.AccessToken)
		if strings.TrimSpace(td.RefreshToken) != "" {
			copyStorage.RefreshToken = strings.TrimSpace(td.RefreshToken)
		}
		if strings.TrimSpace(td.IDToken) != "" {
			copyStorage.IDToken = strings.TrimSpace(td.IDToken)
		}
		if strings.TrimSpace(td.TokenType) != "" {
			copyStorage.TokenType = strings.TrimSpace(td.TokenType)
		}
		if td.ExpiresIn > 0 {
			copyStorage.ExpiresIn = td.ExpiresIn
		}
		if strings.TrimSpace(td.Expire) != "" {
			copyStorage.Expire = strings.TrimSpace(td.Expire)
		}
		if strings.TrimSpace(td.Email) != "" {
			copyStorage.Email = strings.TrimSpace(td.Email)
		}
		if strings.TrimSpace(td.Subject) != "" {
			copyStorage.Subject = strings.TrimSpace(td.Subject)
		}
		copyStorage.LastRefresh = now.UTC().Format(time.RFC3339)
		auth.Storage = &copyStorage
	}

	if store := h.tokenStoreWithBaseDir(); store != nil && !coreauth.IsConfigAPIKeyAuth(auth) {
		if _, errSave := store.Save(ctx, auth); errSave != nil {
			log.WithError(errSave).Warn("management APICall: failed to persist refreshed xai oauth token")
		}
	}
	if h != nil && h.authManager != nil {
		auth.LastRefreshedAt = now
		auth.UpdatedAt = now
		if _, errUpdate := h.authManager.Update(ctx, auth); errUpdate != nil {
			log.WithError(errUpdate).Warn("management APICall: failed to update refreshed xai oauth credential in manager")
		}
	}

	return strings.TrimSpace(td.AccessToken), nil
}

func xaiTokenValue(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if auth.Attributes != nil {
		if v := strings.TrimSpace(auth.Attributes["api_key"]); v != "" {
			return v
		}
	}
	if auth.Metadata != nil {
		if v := stringValue(auth.Metadata, "api_key"); v != "" {
			return v
		}
		if v := stringValue(auth.Metadata, "access_token"); v != "" {
			return v
		}
		if v := stringValue(auth.Metadata, "accessToken"); v != "" {
			return v
		}
	}
	if ts := xaiTokenStorage(auth); ts != nil {
		if v := strings.TrimSpace(ts.AccessToken); v != "" {
			return v
		}
	}
	return ""
}

func xaiRefreshToken(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if v := stringValue(auth.Metadata, "refresh_token"); v != "" {
		return v
	}
	if ts := xaiTokenStorage(auth); ts != nil {
		return strings.TrimSpace(ts.RefreshToken)
	}
	return ""
}

func xaiTokenEndpoint(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if v := stringValue(auth.Metadata, "token_endpoint"); v != "" {
		return v
	}
	if ts := xaiTokenStorage(auth); ts != nil {
		return strings.TrimSpace(ts.TokenEndpoint)
	}
	return ""
}

func xaiTokenStorage(auth *coreauth.Auth) *xaiauth.TokenStorage {
	if auth == nil {
		return nil
	}
	ts, ok := auth.Storage.(*xaiauth.TokenStorage)
	if !ok {
		return nil
	}
	return ts
}

func xaiOAuthTokenNeedsRefresh(auth *coreauth.Auth) bool {
	if auth == nil {
		return true
	}
	tokenStr := xaiTokenValue(auth)
	if tokenStr == "" {
		return true
	}

	lead := xaiauth.RefreshLead()
	now := time.Now()
	if lead > 0 {
		now = now.Add(lead)
	}

	temp := auth.Clone()
	if temp.Metadata == nil {
		temp.Metadata = make(map[string]any)
	}
	if stringValue(temp.Metadata, "access_token") == "" {
		temp.Metadata["access_token"] = tokenStr
	}
	if ts := xaiTokenStorage(auth); ts != nil {
		if stringValue(temp.Metadata, "expired") == "" && strings.TrimSpace(ts.Expire) != "" {
			temp.Metadata["expired"] = strings.TrimSpace(ts.Expire)
		}
		if _, ok := temp.Metadata["expires_in"]; !ok && ts.ExpiresIn > 0 {
			temp.Metadata["expires_in"] = ts.ExpiresIn
		}
		if stringValue(temp.Metadata, "last_refresh") == "" && strings.TrimSpace(ts.LastRefresh) != "" {
			temp.Metadata["last_refresh"] = strings.TrimSpace(ts.LastRefresh)
		}
	}

	return !temp.HasValidAccessToken(now)
}

func (h *Handler) refreshAntigravityOAuthAccessToken(ctx context.Context, auth *coreauth.Auth, requestProxyURL string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if auth == nil {
		return "", nil
	}

	metadata := auth.Metadata
	if len(metadata) == 0 {
		return "", fmt.Errorf("antigravity oauth metadata missing")
	}

	current := strings.TrimSpace(tokenValueFromMetadata(metadata))
	if current != "" && !antigravityTokenNeedsRefresh(metadata) {
		return current, nil
	}

	refreshToken := stringValue(metadata, "refresh_token")
	if refreshToken == "" {
		return "", fmt.Errorf("antigravity refresh token missing")
	}

	tokenURL := strings.TrimSpace(antigravityOAuthTokenURL)
	if tokenURL == "" {
		tokenURL = "https://oauth2.googleapis.com/token"
	}
	form := url.Values{}
	form.Set("client_id", antigravityOAuthClientID)
	form.Set("client_secret", antigravityOAuthClientSecret)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)

	req, errReq := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if errReq != nil {
		return "", errReq
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	httpClient := &http.Client{
		Timeout:   defaultAPICallTimeout,
		Transport: h.apiCallTransport(auth, requestProxyURL),
	}
	resp, errDo := httpClient.Do(req)
	if errDo != nil {
		return "", errDo
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("response body close error: %v", errClose)
		}
	}()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil {
		return "", errRead
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("antigravity oauth token refresh failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}
	if errUnmarshal := json.Unmarshal(bodyBytes, &tokenResp); errUnmarshal != nil {
		return "", errUnmarshal
	}

	if strings.TrimSpace(tokenResp.AccessToken) == "" {
		return "", fmt.Errorf("antigravity oauth token refresh returned empty access_token")
	}

	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	now := time.Now()
	auth.Metadata["access_token"] = strings.TrimSpace(tokenResp.AccessToken)
	if strings.TrimSpace(tokenResp.RefreshToken) != "" {
		auth.Metadata["refresh_token"] = strings.TrimSpace(tokenResp.RefreshToken)
	}
	if tokenResp.ExpiresIn > 0 {
		auth.Metadata["expires_in"] = tokenResp.ExpiresIn
		auth.Metadata["timestamp"] = now.UnixMilli()
		auth.Metadata["expired"] = now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second).Format(time.RFC3339)
	}
	auth.Metadata["type"] = "antigravity"

	if h != nil && h.authManager != nil {
		auth.LastRefreshedAt = now
		auth.UpdatedAt = now
		_, _ = h.authManager.Update(ctx, auth)
	}

	return strings.TrimSpace(tokenResp.AccessToken), nil
}

func metaTokenFromAuth(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	if auth.Metadata != nil {
		if k, ok := auth.Metadata["api_key"].(string); ok && strings.TrimSpace(k) != "" && !strings.HasPrefix(strings.TrimSpace(k), "dca:") {
			return strings.TrimSpace(k)
		}
		if t, ok := auth.Metadata["access_token"].(string); ok && strings.TrimSpace(t) != "" && !strings.HasPrefix(strings.TrimSpace(t), "dca:") {
			return strings.TrimSpace(t)
		}
	}
	if auth.Attributes != nil {
		if k := strings.TrimSpace(auth.Attributes["api_key"]); k != "" && !strings.HasPrefix(k, "dca:") {
			return k
		}
		if t := strings.TrimSpace(auth.Attributes["access_token"]); t != "" && !strings.HasPrefix(t, "dca:") {
			return t
		}
	}
	return ""
}

// metaManagementPreparer applies the tool's proxy override only to acquisition.
// The saved credential retains its configured proxy.
type metaManagementPreparer struct {
	executor *executor.MetaExecutor
	proxyURL string
}

func (p metaManagementPreparer) ShouldPrepareRequestAuth(auth *coreauth.Auth) bool {
	return p.executor.ShouldPrepareRequestAuth(auth)
}

func (p metaManagementPreparer) PrepareRequestAuth(ctx context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	proxyURL := auth.ProxyURL
	if strings.TrimSpace(p.proxyURL) != "" {
		auth.ProxyURL = p.proxyURL
	}
	updated, err := p.executor.PrepareRequestAuth(ctx, auth)
	if updated != nil {
		updated.ProxyURL = proxyURL
	}
	return updated, err
}

func (h *Handler) resolveMetaToken(ctx context.Context, auth *coreauth.Auth, requestProxyURL string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if auth == nil {
		return "", nil
	}
	if token := metaTokenFromAuth(auth); token != "" {
		return token, nil
	}
	var cfg *config.Config
	if h != nil {
		cfg = h.cfg
	}
	preparer := metaManagementPreparer{executor: executor.NewMetaExecutor(cfg), proxyURL: requestProxyURL}
	if !preparer.ShouldPrepareRequestAuth(auth) {
		return "", nil
	}
	if h == nil || h.authManager == nil || auth.ID == "" {
		return "", fmt.Errorf("meta token mint requires a registered credential")
	}
	updated, err := h.authManager.PrepareRequestAuth(ctx, preparer, auth)
	if err != nil {
		return "", err
	}
	return metaTokenFromAuth(updated), nil
}

func antigravityTokenNeedsRefresh(metadata map[string]any) bool {
	// Refresh a bit early to avoid requests racing token expiry.
	const skew = 30 * time.Second

	if metadata == nil {
		return true
	}
	if expStr, ok := metadata["expired"].(string); ok {
		if ts, errParse := time.Parse(time.RFC3339, strings.TrimSpace(expStr)); errParse == nil {
			return !ts.After(time.Now().Add(skew))
		}
	}
	expiresIn := int64Value(metadata["expires_in"])
	timestampMs := int64Value(metadata["timestamp"])
	if expiresIn > 0 && timestampMs > 0 {
		exp := time.UnixMilli(timestampMs).Add(time.Duration(expiresIn) * time.Second)
		return !exp.After(time.Now().Add(skew))
	}
	return true
}

func int64Value(raw any) int64 {
	switch typed := raw.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case uint:
		return int64(typed)
	case uint32:
		return int64(typed)
	case uint64:
		if typed > uint64(^uint64(0)>>1) {
			return 0
		}
		return int64(typed)
	case float32:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		if i, errParse := typed.Int64(); errParse == nil {
			return i
		}
	case string:
		if s := strings.TrimSpace(typed); s != "" {
			if i, errParse := json.Number(s).Int64(); errParse == nil {
				return i
			}
		}
	}
	return 0
}

func stringValue(metadata map[string]any, key string) string {
	if len(metadata) == 0 || key == "" {
		return ""
	}
	if v, ok := metadata[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func tokenValueFromMetadata(metadata map[string]any) string {
	if len(metadata) == 0 {
		return ""
	}
	if v, ok := metadata["accessToken"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := metadata["access_token"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if tokenRaw, ok := metadata["token"]; ok && tokenRaw != nil {
		switch typed := tokenRaw.(type) {
		case string:
			if v := strings.TrimSpace(typed); v != "" {
				return v
			}
		case map[string]any:
			if v, ok := typed["access_token"].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
			if v, ok := typed["accessToken"].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		case map[string]string:
			if v := strings.TrimSpace(typed["access_token"]); v != "" {
				return v
			}
			if v := strings.TrimSpace(typed["accessToken"]); v != "" {
				return v
			}
		}
	}
	if v, ok := metadata["token"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := metadata["id_token"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := metadata["api_key"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := metadata["session_token"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	if v, ok := metadata["cookie"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return ""
}

func (h *Handler) authByIndex(authIndex string) *coreauth.Auth {
	authIndex = strings.TrimSpace(authIndex)
	if authIndex == "" || h == nil || h.authManager == nil {
		return nil
	}
	auths := h.authManager.List()
	for _, auth := range auths {
		if auth == nil {
			continue
		}
		auth.EnsureIndex()
		if auth.Index == authIndex {
			return auth
		}
	}
	return nil
}

func (h *Handler) apiCallTransport(auth *coreauth.Auth, requestProxyURL string) http.RoundTripper {
	if proxyStr := strings.TrimSpace(requestProxyURL); proxyStr != "" {
		if transport := buildProxyTransport(proxyStr); transport != nil {
			return transport
		}
		return directAPICallTransport()
	}

	var proxyCandidates []string
	if auth != nil {
		if proxyStr := strings.TrimSpace(auth.ProxyURL); proxyStr != "" {
			proxyCandidates = append(proxyCandidates, proxyStr)
		}
		if h != nil && h.cfg != nil {
			if proxyStr := strings.TrimSpace(proxyURLFromAPIKeyConfig(h.cfg, auth)); proxyStr != "" {
				proxyCandidates = append(proxyCandidates, proxyStr)
			}
		}
	}
	if h != nil && h.cfg != nil {
		if proxyStr := strings.TrimSpace(h.cfg.ProxyURL); proxyStr != "" {
			proxyCandidates = append(proxyCandidates, proxyStr)
		}
	}

	for _, proxyStr := range proxyCandidates {
		if transport := buildProxyTransport(proxyStr); transport != nil {
			return transport
		}
	}

	return directAPICallTransport()
}

func directAPICallTransport() http.RoundTripper {
	transport, ok := http.DefaultTransport.(*http.Transport)
	if !ok || transport == nil {
		return &http.Transport{Proxy: nil}
	}
	clone := transport.Clone()
	clone.Proxy = nil
	return clone
}

type apiKeyConfigEntry interface {
	GetAPIKey() string
	GetBaseURL() string
}

func resolveAPIKeyConfig[T apiKeyConfigEntry](entries []T, auth *coreauth.Auth) *T {
	if auth == nil || len(entries) == 0 {
		return nil
	}
	attrKey, attrBase := "", ""
	if auth.Attributes != nil {
		attrKey = strings.TrimSpace(auth.Attributes["api_key"])
		attrBase = strings.TrimSpace(auth.Attributes["base_url"])
	}
	for i := range entries {
		entry := &entries[i]
		cfgKey := strings.TrimSpace((*entry).GetAPIKey())
		cfgBase := strings.TrimSpace((*entry).GetBaseURL())
		if attrKey != "" && attrBase != "" {
			if strings.EqualFold(cfgKey, attrKey) && strings.EqualFold(cfgBase, attrBase) {
				return entry
			}
			continue
		}
		if attrKey != "" && strings.EqualFold(cfgKey, attrKey) {
			if cfgBase == "" || strings.EqualFold(cfgBase, attrBase) {
				return entry
			}
		}
		if attrKey == "" && attrBase != "" && strings.EqualFold(cfgBase, attrBase) {
			return entry
		}
	}
	if attrKey != "" {
		for i := range entries {
			entry := &entries[i]
			if strings.EqualFold(strings.TrimSpace((*entry).GetAPIKey()), attrKey) {
				return entry
			}
		}
	}
	return nil
}

func proxyURLFromAPIKeyConfig(cfg *config.Config, auth *coreauth.Auth) string {
	if cfg == nil || auth == nil {
		return ""
	}
	authKind, authAccount := auth.AccountInfo()
	if !strings.EqualFold(strings.TrimSpace(authKind), "api_key") {
		return ""
	}

	attrs := auth.Attributes
	compatName := ""
	providerKey := ""
	if len(attrs) > 0 {
		compatName = strings.TrimSpace(attrs["compat_name"])
		providerKey = strings.TrimSpace(attrs["provider_key"])
	}
	if compatName != "" || strings.EqualFold(strings.TrimSpace(auth.Provider), "openai-compatibility") {
		return resolveOpenAICompatAPIKeyProxyURL(cfg, auth, strings.TrimSpace(authAccount), providerKey, compatName)
	}

	switch strings.ToLower(strings.TrimSpace(auth.Provider)) {
	case "gemini":
		if entry := resolveAPIKeyConfig(cfg.GeminiKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	case "gemini-interactions":
		if entry := resolveAPIKeyConfig(cfg.InteractionsKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	case "claude":
		if entry := resolveAPIKeyConfig(cfg.ClaudeKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	case "codex":
		if entry := resolveAPIKeyConfig(cfg.CodexKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	case "xai":
		if entry := resolveAPIKeyConfig(cfg.XAIKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	case "meta":
		if entry := resolveAPIKeyConfig(cfg.MetaKey, auth); entry != nil {
			return strings.TrimSpace(entry.ProxyURL)
		}
	}
	return ""
}

func resolveOpenAICompatAPIKeyProxyURL(cfg *config.Config, auth *coreauth.Auth, apiKey, providerKey, compatName string) string {
	if cfg == nil || auth == nil {
		return ""
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return ""
	}
	candidates := make([]string, 0, 3)
	if v := strings.TrimSpace(compatName); v != "" {
		candidates = append(candidates, v)
	}
	if v := strings.TrimSpace(providerKey); v != "" {
		candidates = append(candidates, v)
	}
	if v := strings.TrimSpace(auth.Provider); v != "" {
		candidates = append(candidates, v)
	}

	for i := range cfg.OpenAICompatibility {
		compat := &cfg.OpenAICompatibility[i]
		if compat.Disabled {
			continue
		}
		for _, candidate := range candidates {
			if candidate != "" && strings.EqualFold(strings.TrimSpace(candidate), compat.Name) {
				for j := range compat.APIKeyEntries {
					entry := &compat.APIKeyEntries[j]
					if strings.EqualFold(strings.TrimSpace(entry.APIKey), apiKey) {
						return strings.TrimSpace(entry.ProxyURL)
					}
				}
				return ""
			}
		}
	}
	return ""
}

func buildProxyTransport(proxyStr string) *http.Transport {
	transport, _, errBuild := proxyutil.BuildHTTPTransport(proxyStr)
	if errBuild != nil {
		log.WithError(errBuild).Debug("build proxy transport failed")
		return nil
	}
	return transport
}

type codexWebsocketProbeRequest struct {
	BaseURL              string            `json:"base_url"`
	APIKey               string            `json:"api_key"`
	ProxyURL             string            `json:"proxy_url,omitempty"`
	Headers              map[string]string `json:"headers,omitempty"`
	Model                string            `json:"model,omitempty"`
	DisableCodexCloaking *bool             `json:"disable_codex_cloaking,omitempty"`
}

type codexWebsocketProbeResponse struct {
	Supported  bool   `json:"supported"`
	Status     string `json:"status"`
	Stage      string `json:"stage"`
	ProbeMode  string `json:"probe_mode,omitempty"`
	Endpoint   string `json:"endpoint"`
	Model      string `json:"model"`
	HTTPStatus int    `json:"http_status,omitempty"`
	CloseCode  int    `json:"close_code,omitempty"`
	ErrorCode  string `json:"error_code,omitempty"`
	EventType  string `json:"event_type,omitempty"`
	LatencyMS  int64  `json:"latency_ms"`
	Message    string `json:"message,omitempty"`
	RawError   string `json:"raw_error,omitempty"`
}

var codexProbeDisguisedPrompts = []string{
	"What is the difference between git fetch and git pull? Reply in one short sentence.",
	"What does HTTP status code 304 mean? Reply in one short sentence.",
	"What is the difference between TCP and UDP? Reply in one short sentence.",
	"What does the Go defer keyword do? Reply in one short sentence.",
	"What does chmod 644 mean on Linux? Reply in one short sentence.",
	"What is a race condition in concurrent programming? Reply in one short sentence.",
	"What does the SQL INNER JOIN clause return? Reply in one short sentence.",
	"What is the purpose of a DNS CNAME record? Reply in one short sentence.",
}

func pickCodexProbePrompt() string {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codexProbeDisguisedPrompts))))
	if err != nil {
		return codexProbeDisguisedPrompts[0]
	}
	return codexProbeDisguisedPrompts[n.Int64()]
}

func buildCodexWebsocketPrewarmPayload(model, instructions, sessionID string) []byte {
	doc := ojson.NewDocString(`{"type":"response.create","model":"","instructions":"","input":[],"generate":false,"store":false,"stream":true,"parallel_tool_calls":true,"include":["reasoning.encrypted_content"],"prompt_cache_key":""}`)
	_ = doc.Set("model", model)
	_ = doc.Set("instructions", instructions)
	_ = doc.Set("prompt_cache_key", sessionID)
	return doc.Bytes()
}

func buildCodexWebsocketFallbackChatPayload(model, instructions, sessionID, prompt string) []byte {
	doc := ojson.NewDocString(`{"type":"response.create","model":"","instructions":"","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":""}]}],"store":false,"stream":true,"parallel_tool_calls":true,"include":["reasoning.encrypted_content"],"prompt_cache_key":""}`)
	_ = doc.Set("model", model)
	_ = doc.Set("instructions", instructions)
	_ = doc.Set("input.0.content.0.text", prompt)
	_ = doc.Set("prompt_cache_key", sessionID)
	return doc.Bytes()
}

// ProbeCodexWebsocket tests whether a Codex upstream supports Responses API over WebSocket.
// It uses a native Codex CLI prewarm turn (generate=false) first, and falls back to a
// disguised normal Codex CLI coding question if the upstream rejects prewarm semantics.
// Endpoint: POST /v8/management/requests/codex-websocket-probe
func (h *Handler) ProbeCodexWebsocket(c *gin.Context) {
	var body codexWebsocketProbeRequest
	if errBindJSON := c.ShouldBindJSON(&body); errBindJSON != nil {
		c.JSON(clienterror.HTTPStatusFromErrorOr(errBindJSON, http.StatusBadRequest), gin.H{"error": "invalid body"})
		return
	}

	baseURL := strings.TrimSpace(body.BaseURL)
	if baseURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing base_url"})
		return
	}
	parsedURL, errParseURL := url.Parse(baseURL)
	if errParseURL != nil || parsedURL.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid base_url"})
		return
	}
	switch strings.ToLower(parsedURL.Scheme) {
	case "http", "https", "ws", "wss":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid base_url"})
		return
	}

	apiKey := strings.TrimSpace(body.APIKey)
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing api_key"})
		return
	}

	requestProxyURL := strings.TrimSpace(body.ProxyURL)
	if requestProxyURL != "" {
		if _, errParseProxy := proxyutil.Parse(requestProxyURL); errParseProxy != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proxy_url"})
			return
		}
	}

	model := strings.TrimSpace(body.Model)
	if model == "" {
		for _, m := range registry.GetStaticModelDefinitionsByChannel("codex") {
			if m != nil && strings.TrimSpace(m.ID) != "" {
				model = strings.TrimSpace(m.ID)
				break
			}
		}
		if model == "" {
			model = "gpt-5.4"
		}
	}

	attrs := map[string]string{
		"api_key":  apiKey,
		"base_url": baseURL,
	}
	if body.DisableCodexCloaking != nil {
		attrs[coreauth.AttributeCodexDisableCloaking] = strconv.FormatBool(*body.DisableCodexCloaking)
	}
	for k, v := range body.Headers {
		hk := strings.TrimSpace(k)
		hv := strings.TrimSpace(v)
		if hk == "" || hv == "" {
			continue
		}
		attrs["header:"+hk] = hv
	}
	syntheticAuth := &coreauth.Auth{
		Provider:   "codex",
		ProxyURL:   requestProxyURL,
		Attributes: attrs,
	}

	var cfg *config.Config
	if h != nil {
		h.mu.Lock()
		cfg = h.cfg
		h.mu.Unlock()
	}

	instructions := registry.CodexClientModelBaseInstructions(model)
	probeCtx, cancel := context.WithTimeout(c.Request.Context(), defaultCodexWebsocketProbeTimeout)
	defer cancel()
	start := time.Now()

	res, shouldFallback, errPrep := runCodexWebsocketProbeAttempt(probeCtx, cfg, syntheticAuth, model, instructions, codexWebsocketProbeModePrewarm)
	if errPrep != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": errPrep.Error()})
		return
	}
	if shouldFallback && probeCtx.Err() == nil {
		fallbackRes, _, errFallbackPrep := runCodexWebsocketProbeAttempt(probeCtx, cfg, syntheticAuth, model, instructions, codexWebsocketProbeModeFallbackChat)
		if errFallbackPrep != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": errFallbackPrep.Error()})
			return
		}
		res = fallbackRes
	}

	res.Model = model
	res.LatencyMS = time.Since(start).Milliseconds()
	c.JSON(http.StatusOK, res)
}

func runCodexWebsocketProbeAttempt(probeCtx context.Context, cfg *config.Config, syntheticAuth *coreauth.Auth, model, instructions, mode string) (codexWebsocketProbeResponse, bool, error) {
	sessionID := uuid.NewString()
	wsURL, wsHeaders, dialer, compressionEnabled, errPrep := executor.PrepareCodexWebsocketProbe(probeCtx, cfg, syntheticAuth, model, sessionID)
	if errPrep != nil {
		return codexWebsocketProbeResponse{}, false, errPrep
	}

	conn, resp, errDial := helps.DialCodexRelayWebsocket(probeCtx, dialer, wsURL, wsHeaders)
	if errDial != nil {
		var respBody []byte
		if resp != nil && resp.Body != nil {
			limited := io.LimitReader(resp.Body, codexWebsocketProbeMaxBodyBytes)
			respBody, _ = io.ReadAll(limited)
			if errClose := resp.Body.Close(); errClose != nil {
				log.Errorf("codex websocket probe response body close error: %v", errClose)
			}
		}
		res := classifyCodexWebsocketHandshakeError(probeCtx, resp, respBody, errDial)
		res.Endpoint = wsURL
		res.ProbeMode = mode
		return res, false, nil
	}

	if resp != nil && resp.Body != nil {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("codex websocket probe handshake body close error: %v", errClose)
		}
	}

	var closeOnce sync.Once
	closeConn := func() {
		closeOnce.Do(func() {
			if errClose := conn.Close(); errClose != nil && !errors.Is(errClose, net.ErrClosed) {
				log.Debugf("codex websocket probe close error: %v", errClose)
			}
		})
	}
	stopClose := context.AfterFunc(probeCtx, closeConn)
	defer func() {
		stopClose()
		closeConn()
	}()

	conn.EnableWriteCompression(compressionEnabled)

	var payload []byte
	if mode == codexWebsocketProbeModeFallbackChat {
		payload = buildCodexWebsocketFallbackChatPayload(model, instructions, sessionID, pickCodexProbePrompt())
	} else {
		payload = buildCodexWebsocketPrewarmPayload(model, instructions, sessionID)
	}

	if errWrite := conn.WriteMessage(websocket.TextMessage, payload); errWrite != nil {
		_, _, errRead := conn.ReadMessage()
		if errRead != nil && mode == codexWebsocketProbeModePrewarm && isPrewarmIncompatibleCloseError(errRead) {
			return codexWebsocketProbeResponse{Endpoint: wsURL, ProbeMode: mode}, true, nil
		}
		var closeErr *websocket.CloseError
		var res codexWebsocketProbeResponse
		if errRead != nil && errors.As(errRead, &closeErr) {
			res = classifyCodexWebsocketReadError(probeCtx, errRead)
		} else if isProbeTimeout(probeCtx, errWrite) {
			res = codexWebsocketProbeResponse{
				Supported: false,
				Status:    "timeout",
				Stage:     "write",
				Message:   "websocket probe timed out while sending request",
				RawError:  truncateProbeText(errWrite.Error()),
			}
		} else {
			res = codexWebsocketProbeResponse{
				Supported: false,
				Status:    "unsupported",
				Stage:     "write",
				Message:   truncateProbeText(errWrite.Error()),
				RawError:  truncateProbeText(errWrite.Error()),
			}
		}
		res.Endpoint = wsURL
		res.ProbeMode = mode
		if res.HTTPStatus == 0 {
			res.HTTPStatus = http.StatusSwitchingProtocols
		}
		return res, false, nil
	}

	sawResponseEvent := false
	firstEventType := ""
	preEventFrames := 0

	for i := 0; i < codexWebsocketProbeMaxStreamFrames; i++ {
		msgType, msg, errRead := conn.ReadMessage()
		if errRead != nil {
			if sawResponseEvent {
				return codexWebsocketProbeResponse{
					Supported:  true,
					Status:     "supported",
					Stage:      "response",
					ProbeMode:  mode,
					Endpoint:   wsURL,
					HTTPStatus: http.StatusSwitchingProtocols,
					EventType:  firstEventType,
				}, false, nil
			}
			if mode == codexWebsocketProbeModePrewarm && isPrewarmIncompatibleCloseError(errRead) {
				return codexWebsocketProbeResponse{Endpoint: wsURL, ProbeMode: mode}, true, nil
			}
			res := classifyCodexWebsocketReadError(probeCtx, errRead)
			res.Endpoint = wsURL
			res.ProbeMode = mode
			if res.HTTPStatus == 0 {
				res.HTTPStatus = http.StatusSwitchingProtocols
			}
			return res, false, nil
		}

		if msgType != websocket.TextMessage || !ojson.ValidBytes(msg) {
			if sawResponseEvent {
				return codexWebsocketProbeResponse{
					Supported:  true,
					Status:     "supported",
					Stage:      "response",
					ProbeMode:  mode,
					Endpoint:   wsURL,
					HTTPStatus: http.StatusSwitchingProtocols,
					EventType:  firstEventType,
				}, false, nil
			}
			detail := "unexpected binary websocket frame"
			if msgType == websocket.TextMessage {
				detail = truncateProbeText(string(msg))
			}
			return codexWebsocketProbeResponse{
				Supported:  false,
				Status:     "unsupported",
				Stage:      "response",
				ProbeMode:  mode,
				Endpoint:   wsURL,
				HTTPStatus: http.StatusSwitchingProtocols,
				Message:    detail,
				RawError:   detail,
			}, false, nil
		}

		eventType := helps.CodexResponseEventType(msg)
		if eventType == "error" || eventType == "response.failed" {
			if !sawResponseEvent && mode == codexWebsocketProbeModePrewarm && shouldFallbackFromCodexPrewarm(msg, eventType) {
				_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				closeConn()
				return codexWebsocketProbeResponse{Endpoint: wsURL, ProbeMode: mode}, true, nil
			}
			res := classifyCodexWebsocketEventError(msg, eventType)
			res.Endpoint = wsURL
			res.ProbeMode = mode
			if res.HTTPStatus == 0 {
				res.HTTPStatus = http.StatusSwitchingProtocols
			}
			return res, false, nil
		}

		if eventType == "response.completed" || eventType == "response.done" || eventType == "response.incomplete" {
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			closeConn()
			return codexWebsocketProbeResponse{
				Supported:  true,
				Status:     "supported",
				Stage:      "response",
				ProbeMode:  mode,
				Endpoint:   wsURL,
				HTTPStatus: http.StatusSwitchingProtocols,
				EventType:  eventType,
			}, false, nil
		}

		if strings.HasPrefix(eventType, "response.") {
			if !sawResponseEvent {
				sawResponseEvent = true
				firstEventType = eventType
			}
			continue
		}

		if !sawResponseEvent {
			preEventFrames++
			if preEventFrames >= codexWebsocketProbeMaxPreEventFrames {
				return codexWebsocketProbeResponse{
					Supported:  false,
					Status:     "unsupported",
					Stage:      "response",
					ProbeMode:  mode,
					Endpoint:   wsURL,
					HTTPStatus: http.StatusSwitchingProtocols,
					Message:    "no Responses API event received",
				}, false, nil
			}
		}
	}

	if sawResponseEvent {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		closeConn()
		return codexWebsocketProbeResponse{
			Supported:  true,
			Status:     "supported",
			Stage:      "response",
			ProbeMode:  mode,
			Endpoint:   wsURL,
			HTTPStatus: http.StatusSwitchingProtocols,
			EventType:  firstEventType,
		}, false, nil
	}

	return codexWebsocketProbeResponse{
		Supported:  false,
		Status:     "unsupported",
		Stage:      "response",
		ProbeMode:  mode,
		Endpoint:   wsURL,
		HTTPStatus: http.StatusSwitchingProtocols,
		Message:    "no Responses API event received",
	}, false, nil
}

func shouldFallbackFromCodexPrewarm(payload []byte, eventType string) bool {
	classified := classifyCodexWebsocketEventError(payload, eventType)
	switch classified.Status {
	case "unsupported", "auth_error", "model_error", "rate_limited":
		return false
	}
	if classified.HTTPStatus != 0 && classified.HTTPStatus != http.StatusBadRequest && classified.HTTPStatus != http.StatusUnprocessableEntity {
		return false
	}

	var errType, errParam string
	for _, path := range []string{"error.type", "body.error.type", "response.error.type", "type"} {
		if v := strings.TrimSpace(ojson.GetBytesNoCopy(payload, path).String()); v != "" && v != "error" && v != "response.failed" {
			errType = strings.ToLower(v)
			break
		}
	}
	for _, path := range []string{"error.param", "body.error.param", "response.error.param", "param"} {
		if v := strings.TrimSpace(ojson.GetBytesNoCopy(payload, path).String()); v != "" {
			errParam = strings.ToLower(v)
			break
		}
	}

	switch strings.ToLower(classified.ErrorCode) {
	case "unknown_parameter", "unsupported_parameter", "bad_request":
		return true
	}
	switch errType {
	case "invalid_request_error", "bad_request":
		return true
	}

	lower := strings.ToLower(classified.Message + " " + errParam + " " + string(payload))
	for _, phrase := range []string{
		"generate",
		"empty input",
		"input must",
		"input is required",
		"messages cannot be empty",
		"at least 1",
		"extra_forbidden",
		"unknown parameter",
		"unsupported parameter",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func isPrewarmIncompatibleCloseError(err error) bool {
	var closeErr *websocket.CloseError
	if !errors.As(err, &closeErr) {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(closeErr.Text))
	if lower == "" {
		return false
	}
	if looksLikeAuthError(lower, "") || looksLikeRateLimitError(lower, "") || looksLikeModelError(lower, "") || looksLikeWebsocketUnsupported(lower) {
		return false
	}
	for _, phrase := range []string{"generate", "empty input", "input is required"} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func classifyCodexWebsocketHandshakeError(ctx context.Context, resp *http.Response, body []byte, errDial error) codexWebsocketProbeResponse {
	res := codexWebsocketProbeResponse{
		Supported: false,
		Stage:     "handshake",
	}
	rawParts := make([]string, 0, 2)
	if errDial != nil {
		rawParts = append(rawParts, strings.TrimSpace(errDial.Error()))
	}
	bodyText := strings.TrimSpace(string(body))
	if bodyText != "" {
		rawParts = append(rawParts, bodyText)
	}
	combined := strings.Join(rawParts, ": ")
	res.RawError = truncateProbeText(combined)

	extractedMsg, extractedCode := extractCodexProbeJSONError(body)
	if extractedCode != "" {
		res.ErrorCode = extractedCode
	}
	if extractedMsg != "" {
		res.Message = truncateProbeText(extractedMsg)
	} else if bodyText != "" {
		res.Message = truncateProbeText(bodyText)
	} else if errDial != nil {
		res.Message = truncateProbeText(errDial.Error())
	}

	if isProbeTimeout(ctx, errDial) {
		res.Status = "timeout"
		if resp != nil {
			res.HTTPStatus = resp.StatusCode
		}
		return res
	}
	if resp == nil {
		res.Status = "network_error"
		return res
	}

	res.HTTPStatus = resp.StatusCode
	bodyLower := strings.ToLower(bodyText + " " + extractedMsg + " " + extractedCode)
	lower := strings.ToLower(combined + " " + extractedMsg + " " + extractedCode)
	errCodeLower := strings.ToLower(extractedCode)

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		res.Status = "auth_error"
	case resp.StatusCode == http.StatusForbidden:
		if looksLikeWebsocketUnsupported(bodyLower) {
			res.Status = "unsupported"
		} else {
			res.Status = "auth_error"
		}
	case resp.StatusCode == http.StatusTooManyRequests:
		res.Status = "rate_limited"
	case resp.StatusCode == http.StatusNotFound,
		resp.StatusCode == http.StatusMethodNotAllowed,
		resp.StatusCode == http.StatusUpgradeRequired,
		resp.StatusCode == http.StatusNotImplemented,
		resp.StatusCode < 400:
		res.Status = "unsupported"
	case resp.StatusCode == http.StatusBadRequest:
		if looksLikeAuthError(lower, errCodeLower) {
			res.Status = "auth_error"
		} else {
			res.Status = "unsupported"
		}
	case resp.StatusCode >= 500:
		if looksLikeWebsocketUnsupported(bodyLower) {
			res.Status = "unsupported"
		} else {
			res.Status = "upstream_error"
		}
	default:
		res.Status = "unsupported"
	}
	return res
}

func classifyCodexWebsocketReadError(ctx context.Context, errRead error) codexWebsocketProbeResponse {
	res := codexWebsocketProbeResponse{
		Supported: false,
		Stage:     "response",
	}
	if errRead != nil {
		res.RawError = truncateProbeText(errRead.Error())
		res.Message = truncateProbeText(errRead.Error())
	}
	if isProbeTimeout(ctx, errRead) {
		res.Status = "timeout"
		return res
	}

	var closeErr *websocket.CloseError
	if errors.As(errRead, &closeErr) {
		res.CloseCode = closeErr.Code
		closeText := strings.TrimSpace(closeErr.Text)
		if closeText != "" {
			res.Message = truncateProbeText(closeText)
		}
		lower := strings.ToLower(errRead.Error() + " " + closeText)
		switch {
		case looksLikeAuthError(lower, ""):
			res.Status = "auth_error"
		case looksLikeRateLimitError(lower, ""):
			res.Status = "rate_limited"
		case looksLikeModelError(lower, ""):
			res.Status = "model_error"
		default:
			res.Status = "unsupported"
		}
		return res
	}

	res.Status = "unsupported"
	return res
}

func classifyCodexWebsocketEventError(payload []byte, eventType string) codexWebsocketProbeResponse {
	res := codexWebsocketProbeResponse{
		Supported: false,
		Stage:     "response",
		EventType: eventType,
	}

	var httpStatus int
	for _, path := range []string{
		"status", "status_code",
		"body.status", "body.status_code",
		"error.status", "error.status_code",
		"response.error.status", "response.error.status_code",
	} {
		if v := int(ojson.GetBytesNoCopy(payload, path).Int()); v > 0 {
			httpStatus = v
			break
		}
	}
	if httpStatus > 0 {
		res.HTTPStatus = httpStatus
	}

	errMsg, errCode := extractCodexProbeJSONError(payload)
	if errCode != "" {
		res.ErrorCode = errCode
	}
	if errMsg == "" {
		errMsg = truncateProbeText(string(payload))
	} else {
		errMsg = truncateProbeText(errMsg)
	}
	res.Message = errMsg
	res.RawError = truncateProbeText(string(payload))

	lower := strings.ToLower(errMsg + " " + errCode + " " + string(payload))
	errCodeLower := strings.ToLower(errCode)

	switch {
	case looksLikeWebsocketUnsupported(lower) || httpStatus == http.StatusMethodNotAllowed || httpStatus == http.StatusUpgradeRequired || httpStatus == http.StatusNotImplemented:
		res.Status = "unsupported"
	case httpStatus == http.StatusUnauthorized || httpStatus == http.StatusForbidden || looksLikeAuthError(lower, errCodeLower):
		res.Status = "auth_error"
	case httpStatus == http.StatusTooManyRequests || looksLikeRateLimitError(lower, errCodeLower):
		res.Status = "rate_limited"
	case looksLikeModelError(lower, errCodeLower):
		res.Status = "model_error"
	default:
		res.Status = "upstream_error"
	}
	return res
}

func extractCodexProbeJSONError(payload []byte) (msg string, code string) {
	if len(payload) == 0 || !ojson.ValidBytes(payload) {
		return "", ""
	}
	for _, path := range []string{"error.code", "body.error.code", "response.error.code", "code"} {
		if v := strings.TrimSpace(ojson.GetBytesNoCopy(payload, path).String()); v != "" {
			code = v
			break
		}
	}
	for _, path := range []string{"error.message", "body.error.message", "response.error.message", "message"} {
		if v := strings.TrimSpace(ojson.GetBytesNoCopy(payload, path).String()); v != "" {
			msg = v
			break
		}
	}
	return msg, code
}

func looksLikeWebsocketUnsupported(lower string) bool {
	for _, phrase := range []string{
		"no available account",
		"no available channel",
		"no available provider",
		"no available credential",
		"no available upstream",
		"upgrade required",
		"upgrade not supported",
		"upgrade failed",
		"method not allowed",
		"not implemented",
		"unknown event type",
		"unsupported event type",
		"invalid event type",
		"unsupported protocol",
		"unsupported transport",
		"responses_websockets",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	if strings.Contains(lower, "websocket") || strings.Contains(lower, "web socket") {
		for _, hint := range []string{
			"not support",
			"unsupported",
			"disabled",
			"not allowed",
			"not enabled",
			"not available",
			"not implement",
			"forbidden",
			"rejected",
			"unavailable",
			"only",
		} {
			if strings.Contains(lower, hint) {
				return true
			}
		}
	}
	return false
}

func looksLikeAuthError(lower, errCode string) bool {
	switch errCode {
	case "invalid_api_key", "authentication_error", "unauthorized", "permission_denied", "auth_unavailable", "invalid_token":
		return true
	}
	for _, phrase := range []string{
		"unauthorized",
		"invalid api key",
		"invalid_api_key",
		"incorrect api key",
		"authentication",
		"invalid token",
		"expired token",
		"permission denied",
		"access denied",
		"auth_unavailable",
		"missing authorization",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func looksLikeRateLimitError(lower, errCode string) bool {
	switch errCode {
	case "rate_limit_exceeded", "insufficient_quota", "websocket_connection_limit_reached", "server_is_overloaded", "usage_limit_reached":
		return true
	}
	for _, phrase := range []string{
		"rate limit",
		"too many requests",
		"insufficient_quota",
		"quota exceeded",
		"connection limit",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func looksLikeModelError(lower, errCode string) bool {
	switch errCode {
	case "model_not_found", "invalid_model", "unsupported_model", "unknown_model":
		return true
	}
	if strings.Contains(lower, "model") {
		for _, phrase := range []string{
			"not found",
			"does not exist",
			"do not have access",
			"unsupported",
			"unknown",
			"invalid",
			"not available",
			"not allowed",
			"not supported",
		} {
			if strings.Contains(lower, phrase) {
				return true
			}
		}
	}
	return false
}

func isProbeTimeout(ctx context.Context, err error) bool {
	if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func truncateProbeText(s string) string {
	s = strings.TrimSpace(s)
	const maxLen = 300
	if len(s) <= maxLen {
		return s
	}
	return strings.TrimSpace(s[:maxLen]) + "..."
}
