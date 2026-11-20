package credentialconcurrency

import (
	"encoding/json"
	"math"
	"testing"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name    string
		input   int64
		want    int64
		wantErr bool
	}{
		{name: "zero unlimited", input: 0, want: 0},
		{name: "positive", input: 5, want: 5},
		{name: "max", input: Max, want: Max},
		{name: "negative", input: -1, wantErr: true},
		{name: "above max", input: Max + 1, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Normalize(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("Normalize(%d) error = %v, wantErr = %v", tc.input, err, tc.wantErr)
			}
			if !tc.wantErr && got != tc.want {
				t.Fatalf("Normalize(%d) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}

func TestParseString(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int64
		wantErr bool
	}{
		{name: "empty", raw: "", want: 0},
		{name: "whitespace", raw: "   ", want: 0},
		{name: "zero", raw: "0", want: 0},
		{name: "positive", raw: " 12 ", want: 12},
		{name: "negative", raw: "-3", wantErr: true},
		{name: "non-int", raw: "1.5", wantErr: true},
		{name: "text", raw: "abc", wantErr: true},
		{name: "above max", raw: "1000001", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseString(tc.raw)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ParseString(%q) error = %v, wantErr = %v", tc.raw, err, tc.wantErr)
			}
			if !tc.wantErr && got != tc.want {
				t.Fatalf("ParseString(%q) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}

func TestParseValue(t *testing.T) {
	tests := []struct {
		name    string
		value   any
		want    int64
		wantErr bool
	}{
		{name: "int", value: 4, want: 4},
		{name: "int zero", value: 0, want: 0},
		{name: "int negative", value: -1, wantErr: true},
		{name: "uint64", value: uint64(8), want: 8},
		{name: "uint64 overflow", value: uint64(Max + 1), wantErr: true},
		{name: "float int", value: float64(3), want: 3},
		{name: "float negative", value: float64(-2), wantErr: true},
		{name: "float fraction", value: 1.5, wantErr: true},
		{name: "float nan", value: math.NaN(), wantErr: true},
		{name: "json number", value: json.Number("10"), want: 10},
		{name: "json float", value: json.Number("1.5"), wantErr: true},
		{name: "string", value: "7", want: 7},
		{name: "bool", value: true, wantErr: true},
		{name: "nil", value: nil, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseValue(tc.value)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ParseValue(%#v) error = %v, wantErr = %v", tc.value, err, tc.wantErr)
			}
			if !tc.wantErr && got != tc.want {
				t.Fatalf("ParseValue(%#v) = %d, want %d", tc.value, got, tc.want)
			}
		})
	}
}
