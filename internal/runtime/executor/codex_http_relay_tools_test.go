package executor

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator"
)

func TestCodexHTTPRelayToolAndReasoningEvents(t *testing.T) {
	for _, format := range []sdktranslator.Format{sdktranslator.FormatOpenAIResponse, sdktranslator.FormatOpenAI, sdktranslator.FormatClaude} {
		t.Run(format.String(), func(t *testing.T) {
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = conn.Close() }()
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
				for _, event := range []string{
					`{"type":"response.created","response":{"id":"resp-tools","model":"gpt-5.4","status":"in_progress","output":[]}}`,
					`{"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[]}}`,
					`{"type":"response.reasoning_summary_part.added","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}`,
					`{"type":"response.reasoning_summary_text.delta","item_id":"rs_1","output_index":0,"summary_index":0,"delta":"considering"}`,
					`{"type":"response.reasoning_summary_text.done","item_id":"rs_1","output_index":0,"summary_index":0,"text":"considering"}`,
					`{"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"considering"}]}}`,
					`{"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":""}}`,
					`{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"{\"city\":"}`,
					`{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":1,"delta":"\"Paris\"}"}`,
					`{"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":1,"arguments":"{\"city\":\"Paris\"}"}`,
					`{"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"lookup","arguments":"{\"city\":\"Paris\"}"}}`,
					`{"type":"response.completed","response":{"id":"resp-tools","model":"gpt-5.4","status":"completed","output":[],"usage":{"input_tokens":12,"output_tokens":3,"total_tokens":15}}}`,
				} {
					if err := conn.WriteMessage(websocket.TextMessage, []byte(event)); err != nil {
						return
					}
				}
				for {
					if _, _, err := conn.ReadMessage(); err != nil {
						return
					}
				}
			}))
			defer server.Close()
			exec, auth, opts := relayExecutorForTest(t, server.URL, nil)
			opts.SourceFormat = format
			payload := `{"input":"hello"}`
			if format != sdktranslator.FormatOpenAIResponse {
				payload = `{"messages":[{"role":"user","content":"hello"}],"tools":[{"name":"lookup","input_schema":{"type":"object","properties":{"city":{"type":"string"}}}}]}`
			}
			out := relayConsume(t, exec, t.Context(), auth, cliproxyexecutor.Request{Model: "gpt-5.4", Payload: []byte(payload)}, opts, true)
			for _, want := range []string{"considering", "lookup", "Paris"} {
				if !strings.Contains(out, want) {
					t.Fatalf("missing %q in stream: %s", want, out)
				}
			}
			if format == sdktranslator.FormatClaude && !strings.Contains(out, "tool_use") {
				t.Fatalf("missing Claude tool block: %s", out)
			}
			if format == sdktranslator.FormatOpenAI && !strings.Contains(out, "tool_calls") {
				t.Fatalf("missing Chat tool calls: %s", out)
			}
		})
	}
}
