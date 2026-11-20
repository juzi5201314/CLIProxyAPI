// Package credentialconcurrency defines shared credential max-concurrency validation and parsing.
package credentialconcurrency

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	// Max bounds configured concurrency limits to a practical positive integer range.
	Max int64 = 1_000_000
)

// Normalize validates and normalizes an explicit max-concurrency value.
// Zero means unlimited (0, nil). Negative values or values exceeding Max fail validation.
func Normalize(limit int64) (int64, error) {
	if limit < 0 {
		return 0, fmt.Errorf("max-concurrency must be non-negative")
	}
	if limit > Max {
		return 0, fmt.Errorf("max-concurrency must not exceed %d", Max)
	}
	return limit, nil
}

// ParseString parses a scheduler attribute. An empty string or "0" means unlimited (0).
func ParseString(raw string) (int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	limit, errParse := strconv.ParseInt(raw, 10, 64)
	if errParse != nil {
		return 0, fmt.Errorf("max-concurrency must be an integer: %w", errParse)
	}
	return Normalize(limit)
}

// ParseValue parses a JSON-compatible auth-file metadata value.
func ParseValue(value any) (int64, error) {
	switch typed := value.(type) {
	case int:
		return Normalize(int64(typed))
	case int8:
		return Normalize(int64(typed))
	case int16:
		return Normalize(int64(typed))
	case int32:
		return Normalize(int64(typed))
	case int64:
		return Normalize(typed)
	case uint:
		if uint64(typed) > uint64(Max) {
			return 0, fmt.Errorf("max-concurrency must not exceed %d", Max)
		}
		return int64(typed), nil
	case uint8:
		return int64(typed), nil
	case uint16:
		return int64(typed), nil
	case uint32:
		if uint64(typed) > uint64(Max) {
			return 0, fmt.Errorf("max-concurrency must not exceed %d", Max)
		}
		return int64(typed), nil
	case uint64:
		if typed > uint64(Max) {
			return 0, fmt.Errorf("max-concurrency must not exceed %d", Max)
		}
		return int64(typed), nil
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Trunc(typed) != typed {
			return 0, fmt.Errorf("max-concurrency must be an integer")
		}
		if typed < 0 {
			return 0, fmt.Errorf("max-concurrency must be non-negative")
		}
		if typed > float64(Max) {
			return 0, fmt.Errorf("max-concurrency must not exceed %d", Max)
		}
		return int64(typed), nil
	case float32:
		return ParseValue(float64(typed))
	case json.Number:
		limit, errParse := typed.Int64()
		if errParse != nil {
			return 0, fmt.Errorf("max-concurrency must be an integer: %w", errParse)
		}
		return Normalize(limit)
	case string:
		return ParseString(typed)
	default:
		return 0, fmt.Errorf("max-concurrency must be an integer")
	}
}
