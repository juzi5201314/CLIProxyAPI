package helps

import (
	"context"
	"net"
	"net/http"

	"github.com/gorilla/websocket"
)

// DialCodexRelayWebsocket makes cancellation interrupt the entire upgrade,
// including proxy, TLS, and HTTP response reads. Gorilla's DialContext only
// applies context cancellation to the initial net dial; its later reads use
// deadlines. The raw-connection guard is detached before returning a live WS.
func DialCodexRelayWebsocket(ctx context.Context, dialer *websocket.Dialer, url string, headers http.Header) (*websocket.Conn, *http.Response, error) {
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
	conn, resp, err := dialer.DialContext(ctx, url, headers)
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
