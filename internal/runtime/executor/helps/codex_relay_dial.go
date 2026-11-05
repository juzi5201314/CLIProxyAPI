package helps

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// DialCodexRelayWebsocket follows same-host upgrade redirects without allowing
// TLS downgrades or forwarding credentials to another host. Each handshake is
// cancellation-aware, including proxy, TLS, and HTTP response reads.
func DialCodexRelayWebsocket(ctx context.Context, dialer *websocket.Dialer, wsURL string, headers http.Header) (*websocket.Conn, *http.Response, error) {
	for attempts := 0; ; attempts++ {
		conn, resp, err := dialCodexRelayWebsocketOnce(ctx, dialer, wsURL, headers)
		if err == nil || resp == nil || ctx.Err() != nil || attempts >= 9 {
			return conn, resp, err
		}
		switch resp.StatusCode {
		case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		default:
			return conn, resp, err
		}
		location := resp.Header.Get("Location")
		current, errURL := url.Parse(wsURL)
		if location == "" || errURL != nil {
			return conn, resp, err
		}
		next, errLocation := current.Parse(location)
		if errLocation != nil {
			return conn, resp, err
		}
		switch strings.ToLower(next.Scheme) {
		case "http", "ws":
			next.Scheme = "ws"
		case "https", "wss":
			next.Scheme = "wss"
		default:
			return conn, resp, err
		}
		if !strings.EqualFold(current.Hostname(), next.Hostname()) || next.User != nil || (current.Scheme == "wss" && next.Scheme != "wss") {
			return conn, resp, err
		}
		if resp.Body != nil {
			if errClose := resp.Body.Close(); errClose != nil {
				return nil, resp, errClose
			}
		}
		wsURL = next.String()
	}
}

// Gorilla applies cancellation only to the initial net dial. Detach the raw
// connection guard before returning a live websocket, and keep the caller's
// dialer unchanged so redirects do not stack guards from earlier attempts.
func dialCodexRelayWebsocketOnce(ctx context.Context, original *websocket.Dialer, wsURL string, headers http.Header) (*websocket.Conn, *http.Response, error) {
	dialer := *original
	netDial := dialer.NetDialContext
	stop := func() bool { return true }
	done := make(chan struct{})
	dialer.NetDialContext = func(dialCtx context.Context, network, address string) (net.Conn, error) {
		conn, err := netDial(dialCtx, network, address)
		if err != nil {
			return nil, err
		}
		stop = context.AfterFunc(ctx, func() {
			defer close(done)
			// Closing an already failed/canceled socket is intentionally idempotent.
			_ = conn.Close()
		})
		return conn, nil
	}
	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if !stop() {
		<-done
	}
	if errCtx := ctx.Err(); errCtx != nil {
		if conn != nil {
			_ = conn.Close()
		}
		return nil, resp, errCtx
	}
	return conn, resp, err
}
