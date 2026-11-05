package executor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

func TestCodexHTTPRelayAuthRemovalDuringHandshake(t *testing.T) {
	for _, identified := range []bool{false, true} {
		t.Run(map[bool]string{false: "transient", true: "cached"}[identified], func(t *testing.T) {
			started := make(chan struct{})
			upstreamCanceled := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				<-r.Context().Done()
				close(upstreamCanceled)
			}))
			defer server.Close()
			exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
			if !identified {
				opts.Headers, opts.Metadata = nil, nil
			}
			finished := make(chan error, 1)
			go func() {
				_, err := exec.Execute(context.Background(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":"hello"}`)}, opts)
				finished <- err
			}()
			<-started
			exec.CloseAuthExecutionSessions(auth.ID)
			if err := <-finished; err == nil {
				t.Fatal("removed credential completed handshake")
			}
			<-upstreamCanceled
			exec.wsExec.store.mu.Lock()
			remaining := len(exec.wsExec.store.sessions)
			exec.wsExec.store.mu.Unlock()
			if remaining != 0 {
				t.Fatalf("removed credential left %d sessions", remaining)
			}
		})
	}
}
