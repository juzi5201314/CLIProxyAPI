package helps

import (
	"context"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
)

const relayUser = `{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}`
const relayAnswer = `{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer"}]}`

func TestCodexRelayStateIncremental(t *testing.T) {
	for _, tc := range []struct {
		name, body                   string
		newConn, disabled, wantDelta bool
	}{
		{name: "extension", body: `{"model":"gpt-test","input":[` + relayUser + `,` + relayAnswer + `,` + relayUser + `]}`, wantDelta: true},
		{name: "empty delta", body: `{"model":"gpt-test","input":[` + relayUser + `,` + relayAnswer + `]}`, wantDelta: true},
		{name: "reordered keys", body: `{"input":[` + relayUser + `,` + relayAnswer + `],"model":"gpt-test"}`, wantDelta: true},
		{name: "metadata", body: `{"model":"gpt-test","client_metadata":{"extra":"x"},"stream_options":{"include_usage":true},"input":[` + relayUser + `,` + relayAnswer + `]}`, wantDelta: true},
		{name: "different model", body: `{"model":"other","input":[` + relayUser + `,` + relayAnswer + `]}`},
		{name: "history divergence", body: `{"model":"gpt-test","input":[` + relayUser + `,` + relayUser + `]}`},
		{name: "new connection", body: `{"model":"gpt-test","input":[` + relayUser + `,` + relayAnswer + `]}`, newConn: true},
		{name: "rules disable optimization", body: `{"model":"gpt-test","input":[` + relayUser + `,` + relayAnswer + `]}`, disabled: true},
		{name: "explicit reference", body: `{"model":"gpt-test","previous_response_id":"explicit","input":[` + relayUser + `,` + relayAnswer + `]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &websocket.Conn{}
			turn := &CodexRelayTurn{State: &CodexRelayState{}, Identity: "session", AllowDelta: true}
			defer turn.Stop()
			first, err := turn.Prepare(context.Background(), conn, conn.Close, []byte(`{"model":"gpt-test","input":[`+relayUser+`]}`))
			if err != nil {
				t.Fatal(err)
			}
			if gjson.GetBytes(first, "previous_response_id").Exists() {
				t.Fatal("first request cannot reference a response")
			}
			turn.Observe([]byte(`{"type":"response.completed","response":{"id":"resp-1","output":[` + relayAnswer + `]}}`))
			if tc.newConn {
				conn = &websocket.Conn{}
			}
			turn.AllowDelta = !tc.disabled
			body, err := turn.Prepare(context.Background(), conn, conn.Close, []byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if turn.UsedDelta != tc.wantDelta {
				t.Fatalf("delta = %v, body = %s", turn.UsedDelta, body)
			}
			if tc.wantDelta && gjson.GetBytes(body, "previous_response_id").String() != "resp-1" {
				t.Fatalf("missing previous id: %s", body)
			}
			if tc.name == "empty delta" && gjson.GetBytes(body, "input.#").Int() != 0 {
				t.Fatalf("nonempty delta: %s", body)
			}
			if tc.name == "explicit reference" && gjson.GetBytes(body, "previous_response_id").String() != "explicit" {
				t.Fatalf("changed explicit reference: %s", body)
			}
		})
	}
}

func TestCodexRelayStateTurnAndOutputEvents(t *testing.T) {
	turn := &CodexRelayTurn{State: &CodexRelayState{}, Identity: "session", AllowDelta: true}
	defer turn.Stop()
	conn := &websocket.Conn{}
	if _, err := turn.Prepare(context.Background(), conn, conn.Close, []byte(`{"input":[`+relayUser+`]}`)); err != nil {
		t.Fatal(err)
	}
	turn.Observe([]byte(`{"type":"codex.response.metadata","headers":{"x-codex-turn-state":"opaque"}}`))
	turn.Observe([]byte(`{"type":"response.output_item.done","output_index":0,"item":` + relayAnswer + `}`))
	turn.Observe([]byte(`{"type":"response.completed","response":{"id":"resp-1","output":[]}}`))
	if !turn.Completed || turn.State.items != 2 || turn.output != nil || turn.input != nil {
		t.Fatal("completed state retained transient data or lost output items")
	}
	body, err := turn.Prepare(context.Background(), conn, conn.Close, []byte(`{"input":[`+relayUser+`,`+relayAnswer+`,{"type":"function_call_output","call_id":"call_1","output":"ok"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if !turn.UsedDelta || gjson.GetBytes(body, "client_metadata.x-codex-turn-state").String() != "opaque" {
		t.Fatalf("tool continuation lost turn state: %s", body)
	}
	body, err = turn.Prepare(context.Background(), conn, conn.Close, []byte(`{"input":[`+relayUser+`,`+relayAnswer+`,`+relayUser+`]}`))
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(body, "client_metadata.x-codex-turn-state").Exists() {
		t.Fatal("new user turn inherited opaque state")
	}
	if strings.Contains(string(body), "internal_chat_message_metadata_passthrough") {
		t.Fatal("unexpected metadata")
	}
}
