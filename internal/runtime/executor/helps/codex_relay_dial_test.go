package helps

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
)

func TestDialCodexRelayWebsocketRedirect(t *testing.T) {
	for _, status := range []int{301, 302, 303, 307, 308} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var upgrades atomic.Int32
			upgrader := websocket.Upgrader{}
			target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RequestURI() != "/responses?route=1" || r.Header.Get("Authorization") != "Bearer test" || r.Header.Get("Session-Id") != "test-session" {
					t.Error("redirect lost path, query, or handshake headers")
				}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = conn.Close() }()
				upgrades.Add(1)
				if err = conn.WriteMessage(websocket.TextMessage, []byte("connected")); err != nil {
					t.Error(err)
				}
			}))
			defer target.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, target.URL+"/responses?route=1", status)
			}))
			defer source.Close()
			dialer := websocket.Dialer{NetDialContext: (&net.Dialer{}).DialContext, TLSClientConfig: target.Client().Transport.(*http.Transport).TLSClientConfig.Clone()}
			dialer.TLSClientConfig.InsecureSkipVerify = false
			dialer.TLSClientConfig.RootCAs = x509.NewCertPool()
			dialer.TLSClientConfig.RootCAs.AddCert(target.Certificate())
			headers := http.Header{"Authorization": {"Bearer test"}, "Session-Id": {"test-session"}}
			conn, resp, err := DialCodexRelayWebsocket(t.Context(), &dialer, "ws"+strings.TrimPrefix(source.URL, "http")+"/responses", headers)
			if resp != nil && resp.Body != nil {
				defer func() { _ = resp.Body.Close() }()
			}
			if err != nil {
				t.Fatalf("HTTP to HTTPS websocket redirect failed: %v", err)
			}
			defer func() { _ = conn.Close() }()
			_, message, err := conn.ReadMessage()
			if err != nil || string(message) != "connected" || upgrades.Load() != 1 {
				t.Fatalf("message=%q upgrades=%d error=%v", message, upgrades.Load(), err)
			}
		})
	}
}

func TestDialCodexRelayWebsocketRedirectCancellation(t *testing.T) {
	reached := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/responses" {
			http.Redirect(w, r, "/redirected", http.StatusMovedPermanently)
			return
		}
		close(reached)
		<-release
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	dialer := websocket.Dialer{NetDialContext: (&net.Dialer{}).DialContext}
	go func() {
		conn, resp, err := DialCodexRelayWebsocket(ctx, &dialer, "ws"+strings.TrimPrefix(server.URL, "http")+"/responses", nil)
		if conn != nil {
			_ = conn.Close()
		}
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		done <- err
	}()
	select {
	case <-reached:
	case err := <-done:
		t.Fatalf("handshake ended before redirect: %v", err)
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context cancellation", err)
	}
}

func TestDialCodexRelayWebsocketRejectsTLSDowngrade(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://"+r.Host+"/responses", http.StatusMovedPermanently)
	}))
	defer server.Close()
	dialer := websocket.Dialer{NetDialContext: (&net.Dialer{}).DialContext, TLSClientConfig: server.Client().Transport.(*http.Transport).TLSClientConfig}
	conn, resp, err := DialCodexRelayWebsocket(t.Context(), &dialer, "wss"+strings.TrimPrefix(server.URL, "https")+"/responses", nil)
	if conn != nil {
		_ = conn.Close()
		t.Fatal("unexpected websocket")
	}
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if err == nil || resp == nil || resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("response=%v error=%v, want original redirect rejection", resp, err)
	}
}

func TestDialCodexRelayWebsocketRedirectPolicy(t *testing.T) {
	for _, tc := range []struct {
		name     string
		location string
		status   int
		wantHits int32
	}{
		{"relative loop", "/responses", 301, 10},
		{"cross host", "http://localhost:1/responses", 301, 1},
		{"unsupported scheme", "ftp://127.0.0.1/responses", 301, 1},
		{"missing location", "", 301, 1},
		{"not redirect", "/responses", 401, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var hits atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				w.Header().Set("Location", tc.location)
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, "original error")
			}))
			defer server.Close()
			dialer := websocket.Dialer{NetDialContext: (&net.Dialer{}).DialContext}
			conn, resp, err := DialCodexRelayWebsocket(t.Context(), &dialer, "ws"+strings.TrimPrefix(server.URL, "http")+"/responses", nil)
			if conn != nil {
				_ = conn.Close()
				t.Fatal("unexpected websocket")
			}
			if err == nil || resp == nil || resp.StatusCode != tc.status {
				t.Fatalf("response=%v error=%v", resp, err)
			}
			defer func() { _ = resp.Body.Close() }()
			body, err := io.ReadAll(resp.Body)
			if err != nil || string(body) != "original error" || hits.Load() != tc.wantHits {
				t.Fatalf("body=%q hits=%d want=%d error=%v", body, hits.Load(), tc.wantHits, err)
			}
		})
	}
}
