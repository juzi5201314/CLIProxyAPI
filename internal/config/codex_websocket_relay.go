package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// CodexWebsocketRelayConfig bounds idle connections shared by API-key relays.
// Empty values use defaults; explicit zero disables retention, not forwarding.
type CodexWebsocketRelayConfig struct {
	IdleTTL   string `yaml:"idle-ttl,omitempty" json:"idle-ttl,omitempty"`
	MaxMemory string `yaml:"max-memory,omitempty" json:"max-memory,omitempty"`
}

// CodexWebsocketRelayPolicy is the validated, runtime cache budget.
// MaxMemory counts retained idle resources, not active requests or process RSS.
type CodexWebsocketRelayPolicy struct {
	IdleTTL   time.Duration
	MaxMemory int64
}

// Policy parses the retention settings without changing the configuration.
func (c CodexWebsocketRelayConfig) Policy() (CodexWebsocketRelayPolicy, error) {
	p := CodexWebsocketRelayPolicy{IdleTTL: 5 * time.Minute, MaxMemory: 128 << 20}
	if raw := strings.TrimSpace(c.IdleTTL); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d < 0 {
			return p, fmt.Errorf("upstream.codex.websocket-relay.idle-ttl must be a non-negative duration")
		}
		p.IdleTTL = d
	}
	if raw := strings.ToLower(strings.TrimSpace(c.MaxMemory)); raw != "" {
		n := 0
		for n < len(raw) && raw[n] >= '0' && raw[n] <= '9' {
			n++
		}
		value, err := strconv.ParseInt(raw[:n], 10, 64)
		if err != nil {
			return p, fmt.Errorf("upstream.codex.websocket-relay.max-memory must be an integer byte size: %w", err)
		}
		var multiplier int64
		switch strings.TrimSpace(raw[n:]) {
		case "", "b":
			multiplier = 1
		case "k", "kib":
			multiplier = 1 << 10
		case "m", "mib":
			multiplier = 1 << 20
		case "g", "gib":
			multiplier = 1 << 30
		case "kb":
			multiplier = 1000
		case "mb":
			multiplier = 1000000
		case "gb":
			multiplier = 1000000000
		default:
			return p, fmt.Errorf("upstream.codex.websocket-relay.max-memory has an unsupported unit")
		}
		if value > math.MaxInt64/multiplier {
			return p, fmt.Errorf("upstream.codex.websocket-relay.max-memory overflows int64")
		}
		p.MaxMemory = value * multiplier
	}
	return p, nil
}
