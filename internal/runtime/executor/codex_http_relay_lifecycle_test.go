package executor

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	"github.com/tidwall/gjson"
)

func TestCodexHTTPRelayIsolationAndHotReload(t *testing.T) {
	var connections atomic.Int32
	closed := make(chan struct{}, 16)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		connections.Add(1)
		defer func() { _ = conn.Close(); closed <- struct{}{} }()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp-1","output":[],"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`)); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
	req := cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":[` + relayTestUser + `]}`)}
	run := func(want int32) {
		t.Helper()
		relayConsume(t, exec, t.Context(), auth, req, opts, true)
		if connections.Load() != want {
			t.Fatalf("connections = %d, want %d", connections.Load(), want)
		}
	}
	run(1)
	run(1)
	opts.Metadata = maps.Clone(opts.Metadata)
	opts.Metadata[cliproxyexecutor.CallerScopeMetadataKey] = "other-caller"
	run(2)
	auth = auth.Clone()
	auth.ID += "-second"
	run(3)
	cfg := exec.httpExec.cfg.CloneForRuntime()
	cfg.Codex.WebsocketRelay.MaxMemory = "0"
	configureCodexHTTPRelayPool(exec.relayPool, cfg)
	for range 3 {
		<-closed
	}
	run(4)
	<-closed
	run(5)
	<-closed
	cfg.Codex.WebsocketRelay.MaxMemory = "128m"
	configureCodexHTTPRelayPool(exec.relayPool, cfg)
	run(6)
	cfg.CodexKey[0].WebsocketRelay = false
	configureCodexHTTPRelayPool(exec.relayPool, cfg)
	<-closed
}

func TestCodexHTTPRelayCancelClosesAndReleases(t *testing.T) {
	started := make(chan struct{}, 2)
	closed := make(chan struct{}, 2)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = conn.Close(); closed <- struct{}{} }()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		started <- struct{}{}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
	req := cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":[` + relayTestUser + `]}`)}
	for range 2 {
		ctx, cancel := context.WithCancel(t.Context())
		result, err := exec.ExecuteStream(ctx, auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		<-started
		cancel()
		for range result.Chunks {
		}
		<-closed
		exec.wsExec.store.mu.Lock()
		remaining := len(exec.wsExec.store.sessions)
		exec.wsExec.store.mu.Unlock()
		if remaining != 0 {
			t.Fatalf("cancel left %d execution sessions", remaining)
		}
	}
}

func TestCodexHTTPRelayRejectedAutomaticReference(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			captured := make(chan []byte, 4)
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = conn.Close() }()
				for {
					_, body, err := conn.ReadMessage()
					if err != nil {
						return
					}
					captured <- body
					event := `{"type":"response.completed","response":{"id":"resp-1","output":[` + relayTestAnswer + `],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`
					if gjson.GetBytes(body, "previous_response_id").Exists() {
						event = `{"type":"error","status":400,"error":{"code":"previous_response_id_not_found","type":"invalid_request_error","message":"missing previous response"}}`
					}
					if err := conn.WriteMessage(websocket.TextMessage, []byte(event)); err != nil {
						return
					}
				}
			}))
			defer server.Close()
			exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
			capture := &task6UsageCapture{id: auth.ID, records: make(chan usage.Record, 8)}
			usage.RegisterNamedPlugin(t.Name(), capture)
			t.Cleanup(func() { usage.RegisterNamedPlugin(t.Name(), codexResponseModelNoopUsagePlugin{}) })
			for _, input := range []string{relayTestUser, relayTestUser + `,` + relayTestAnswer + `,` + relayTestUser} {
				relayConsume(t, exec, t.Context(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":[` + input + `]}`)}, opts, stream)
			}
			usage.PublishRecord(t.Context(), usage.Record{RequestID: auth.ID + "-barrier"})
			successes, failures, tokens := 0, 0, int64(0)
			for record := range capture.records {
				if record.RequestID == auth.ID+"-barrier" {
					break
				}
				if record.Failed {
					failures++
				} else {
					successes++
				}
				tokens += record.Detail.TotalTokens
			}
			if successes != 2 || failures != 1 || tokens != 4 {
				t.Fatalf("usage successes/failures/tokens = %d/%d/%d", successes, failures, tokens)
			}
			<-captured
			delta, retry := <-captured, <-captured
			if !gjson.GetBytes(delta, "previous_response_id").Exists() || gjson.GetBytes(retry, "previous_response_id").Exists() || gjson.GetBytes(retry, "input.#").Int() != 3 {
				t.Fatalf("invalid retry: %s -> %s", delta, retry)
			}
		})
	}
}

func TestCodexHTTPRelayDisabledKeepsHTTP(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || websocket.IsWebSocketUpgrade(r) {
			t.Error("disabled relay changed transport")
		}
		requests.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-1\",\"output\":[],\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}}}\n\n")
	}))
	defer server.Close()
	exec, auth, opts := relayExecutorForTest(t, server.URL, &config.Config{})
	auth.Attributes["websocket_relay"] = "false"
	auth.Attributes["websockets"] = "true"
	for _, stream := range []bool{false, true} {
		relayConsume(t, exec, t.Context(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(`{"input":"hello"}`)}, opts, stream)
	}
	if requests.Load() != 2 {
		t.Fatalf("requests = %d", requests.Load())
	}
}
