package helps

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash"
	"net/http"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

var codexRelayInstallationID = uuid.NewString()

// CodexRelayState retains constant-sized history digests, never conversation bodies.
// The pool lease serializes every access to this state.
type CodexRelayState struct {
	conn       *websocket.Conn
	responseID string
	properties [32]byte
	prefix     [32]byte
	items      int
	turn       [32]byte
	turnState  string
}

// RetainedBytes counts detached variable-sized state plus fixed digest storage.
func (s *CodexRelayState) RetainedBytes() int64 {
	return 256 + int64(len(s.responseID)) + int64(len(s.turnState))
}

// CodexRelayTurn owns temporary per-request state until the executor ends.
type CodexRelayTurn struct {
	State             *CodexRelayState
	Identity          string
	AllowDelta        bool
	Completed         bool
	UsedDelta         bool
	ReferenceRejected bool
	properties        [32]byte
	input             hash.Hash
	items             int
	output            map[int64][]byte
	valid             bool
	sawOutput         bool
	stopCancel        func() bool
	cancelDone        chan struct{}
}

// Stop detaches request cancellation before a healthy connection returns to cache.
func (t *CodexRelayTurn) Stop() {
	if t.stopCancel != nil {
		if !t.stopCancel() {
			<-t.cancelDone
		}
		t.stopCancel, t.cancelDone = nil, nil
	}
}

type codexRelayTurnKey struct{}

// WithCodexRelayTurn carries private transport state outside request metadata.
func WithCodexRelayTurn(ctx context.Context, turn *CodexRelayTurn) context.Context {
	return context.WithValue(ctx, codexRelayTurnKey{}, turn)
}

// CodexRelayTurnFromContext identifies HTTP requests explicitly routed over WS.
func CodexRelayTurnFromContext(ctx context.Context) *CodexRelayTurn {
	if ctx == nil {
		return nil
	}
	turn, _ := ctx.Value(codexRelayTurnKey{}).(*CodexRelayTurn)
	return turn
}

// Headers supplies the session/thread handshake used by the official client.
func (t *CodexRelayTurn) Headers(headers http.Header) {
	for key := range headers {
		switch strings.ToLower(key) {
		case "session_id", "session-id", "conversation_id", "thread-id", "x-client-request-id", "x-codex-turn-state":
			delete(headers, key)
		}
	}
	headers.Set("Session-Id", t.Identity)
	headers.Set("Thread-Id", t.Identity)
	headers.Set("X-Client-Request-Id", t.Identity)
	headers.Set("X-Codex-Window-Id", t.Identity)
}

// Prepare runs after selecting a live connection and before the payload barrier.
func (t *CodexRelayTurn) Prepare(ctx context.Context, conn *websocket.Conn, closeConnection func() error, body []byte) ([]byte, error) {
	t.Stop()
	done := make(chan struct{})
	t.cancelDone = done
	t.stopCancel = context.AfterFunc(ctx, func() { defer close(done); _ = closeConnection() })
	t.sawOutput = false
	t.Completed, t.UsedDelta, t.ReferenceRejected = false, false, false
	t.output = nil
	t.input = sha256.New()
	t.items = 0
	t.valid = false
	if t.State.conn != conn {
		*t.State = CodexRelayState{conn: conn}
	}
	root := gjson.ParseBytes(body)
	input := root.Get("input")
	if !input.IsArray() {
		return body, fmt.Errorf("codex websocket relay: translated input must be an array")
	}
	items := input.Array()
	turnHash := sha256.New()
	for i, item := range items {
		canonical, err := codexRelayCanonical([]byte(item.Raw), true)
		if err != nil {
			return nil, err
		}
		writeCodexRelayItem(t.input, canonical)
		if item.Get("role").String() == "user" {
			turnHash.Reset()
			var index [8]byte
			binary.LittleEndian.PutUint64(index[:], uint64(i))
			_, _ = turnHash.Write(index[:])
			writeCodexRelayItem(turnHash, canonical)
		}
	}
	if explicit := root.Get("client_metadata.turn_id").String(); explicit != "" {
		turnHash.Reset()
		_, _ = turnHash.Write([]byte(explicit))
	}
	var turn [32]byte
	copy(turn[:], turnHash.Sum(nil))
	if turn != t.State.turn {
		t.State.turn, t.State.turnState = turn, ""
	}
	turnID := uuid.NewSHA1(uuid.NameSpaceOID, turn[:]).String()
	for key, value := range map[string]string{
		"session_id": t.Identity, "thread_id": t.Identity, "turn_id": turnID,
		"x-codex-installation-id": codexRelayInstallationID, "x-codex-window-id": t.Identity,
	} {
		path := "client_metadata." + key
		if !gjson.GetBytes(body, path).Exists() {
			body = SetStringIfDifferent(body, path, value)
		}
	}
	if t.State.turnState != "" && !gjson.GetBytes(body, "client_metadata.x-codex-turn-state").Exists() {
		body = SetStringIfDifferent(body, "client_metadata.x-codex-turn-state", t.State.turnState)
	}
	if !gjson.GetBytes(body, "prompt_cache_key").Exists() {
		body = SetStringIfDifferent(body, "prompt_cache_key", t.Identity)
	}
	properties, err := codexRelayProperties(body)
	if err != nil {
		return nil, err
	}
	t.properties = properties
	t.items = len(items)
	// Explicit references describe a delta whose missing prefix we do not know.
	t.valid = t.AllowDelta && !root.Get("previous_response_id").Exists()
	if t.valid && t.State.responseID != "" && properties == t.State.properties && len(items) >= t.State.items {
		prefix := sha256.New()
		for _, item := range items[:t.State.items] {
			canonical, err := codexRelayCanonical([]byte(item.Raw), true)
			if err != nil {
				return nil, err
			}
			writeCodexRelayItem(prefix, canonical)
		}
		if bytes.Equal(prefix.Sum(nil), t.State.prefix[:]) {
			delta := make([]json.RawMessage, 0, len(items)-t.State.items)
			for _, item := range items[t.State.items:] {
				delta = append(delta, json.RawMessage(item.Raw))
			}
			body, err = sjson.SetBytes(body, "input", delta)
			if err != nil {
				return nil, err
			}
			body, err = sjson.SetBytes(body, "previous_response_id", t.State.responseID)
			if err != nil {
				return nil, err
			}
			t.UsedDelta = true
		}
	}
	return body, nil
}

// Observe sees raw upstream events before downstream protocol translation.
func (t *CodexRelayTurn) Observe(payload []byte) {
	root := gjson.ParseBytes(payload)
	kind := root.Get("type").String()
	if kind == "codex.response.metadata" && t.State.turnState == "" {
		t.State.turnState = strings.Clone(root.Get("headers.x-codex-turn-state").String())
	}
	if HasMeaningfulCodexOutputDelta(payload) || kind == "response.output_item.done" {
		t.sawOutput = true
	}
	if kind == "error" && t.UsedDelta && !t.sawOutput {
		for _, path := range []string{"error.code", "body.error.code"} {
			if root.Get(path).String() == "previous_response_id_not_found" {
				t.ReferenceRejected = true
			}
		}
	}
	if kind == "response.output_item.done" {
		if t.output == nil {
			t.output = make(map[int64][]byte)
		}
		t.output[root.Get("output_index").Int()] = []byte(root.Get("item").Raw)
	}
	if kind != "response.completed" && kind != "response.done" {
		return
	}
	status := root.Get("response.status").String()
	if status != "" && status != "completed" {
		return
	}
	t.Completed = true
	t.State.responseID = ""
	if !t.valid {
		t.output = nil
		t.input = nil
		return
	}
	output := root.Get("response.output").Array()
	var items [][]byte
	if len(output) > 0 {
		for _, item := range output {
			items = append(items, []byte(item.Raw))
		}
	} else {
		indexes := make([]int64, 0, len(t.output))
		for index := range t.output {
			indexes = append(indexes, index)
		}
		sort.Slice(indexes, func(i, j int) bool { return indexes[i] < indexes[j] })
		for _, index := range indexes {
			items = append(items, t.output[index])
		}
	}
	for _, item := range items {
		canonical, err := codexRelayCanonical(item, true)
		if err != nil {
			t.output = nil
			t.input = nil
			return
		}
		writeCodexRelayItem(t.input, canonical)
	}
	t.State.responseID = strings.Clone(root.Get("response.id").String())
	t.State.properties, t.State.items = t.properties, t.items+len(items)
	copy(t.State.prefix[:], t.input.Sum(nil))
	t.output, t.input = nil, nil
}

func codexRelayCanonical(raw []byte, item bool) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("codex websocket relay: decode request: %w", err)
	}
	if object, ok := value.(map[string]any); ok && item {
		delete(object, "internal_chat_message_metadata_passthrough")
	}
	return json.Marshal(value)
}

func codexRelayProperties(body []byte) ([32]byte, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(body, &object); err != nil {
		return [32]byte{}, err
	}
	for _, key := range []string{"input", "client_metadata", "stream_options", "previous_response_id", "type"} {
		delete(object, key)
	}
	raw, err := json.Marshal(object)
	if err != nil {
		return [32]byte{}, err
	}
	canonical, err := codexRelayCanonical(raw, false)
	return sha256.Sum256(canonical), err
}

func writeCodexRelayItem(h hash.Hash, item []byte) {
	var size [8]byte
	binary.LittleEndian.PutUint64(size[:], uint64(len(item)))
	_, _ = h.Write(size[:])
	_, _ = h.Write(item)
}
