package auth

import (
	"errors"
	"net/http"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/clienterror"
)

func TestValidateAndApplyAuthMaxConcurrency(t *testing.T) {
	tests := []struct {
		name      string
		auth      *Auth
		metadata  map[string]any
		wantErr   bool
		wantAttr  string
		wantLimit int64
	}{
		{
			name:     "unset",
			auth:     &Auth{ID: "a1"},
			metadata: map[string]any{},
		},
		{
			name:      "metadata int",
			auth:      &Auth{ID: "a2"},
			metadata:  map[string]any{"max_concurrency": 3},
			wantAttr:  "3",
			wantLimit: 3,
		},
		{
			name:      "metadata legacy alias after normalization",
			auth:      &Auth{ID: "a3"},
			metadata:  map[string]any{"max-concurrency": 5},
			wantAttr:  "5",
			wantLimit: 5,
		},
		{
			name:     "metadata zero removes attribute",
			auth:     &Auth{ID: "a4", Attributes: map[string]string{AttributeMaxConcurrency: "2"}},
			metadata: map[string]any{"max_concurrency": 0},
			wantAttr: "",
		},
		{
			name:     "metadata null removes attribute",
			auth:     &Auth{ID: "a5", Attributes: map[string]string{AttributeMaxConcurrency: "2"}},
			metadata: map[string]any{"max_concurrency": nil},
			wantAttr: "",
		},
		{
			name:     "negative metadata rejected",
			auth:     &Auth{ID: "a6"},
			metadata: map[string]any{"max_concurrency": -1},
			wantErr:  true,
		},
		{
			name:    "invalid attribute rejected",
			auth:    &Auth{ID: "a7", Attributes: map[string]string{AttributeMaxConcurrency: "bad"}},
			wantErr: true,
		},
		{
			name:    "invalid provider limit attribute rejected",
			auth:    &Auth{ID: "a8", Attributes: map[string]string{AttributeProviderMaxConcurrency: "-2"}},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.metadata != nil {
				NormalizeCredentialMetadata(tc.metadata)
			}
			err := ApplyAuthMaxConcurrencyMetadata(tc.auth, tc.metadata)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ApplyAuthMaxConcurrencyMetadata() error = %v, wantErr = %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if got := tc.auth.Attributes[AttributeMaxConcurrency]; got != tc.wantAttr {
				t.Fatalf("attr max_concurrency = %q, want %q", got, tc.wantAttr)
			}
			if gotLimit := authMaxConcurrency(tc.auth); gotLimit != tc.wantLimit {
				t.Fatalf("authMaxConcurrency() = %d, want %d", gotLimit, tc.wantLimit)
			}
		})
	}
}

func TestConcurrencyBusyErrorStatus429(t *testing.T) {
	err := newLocalConcurrencyBusyError("all busy")
	if status := clienterror.HTTPStatusFromError(err); status != http.StatusTooManyRequests {
		t.Fatalf("HTTPStatusFromError() = %d, want 429", status)
	}
	var coreErr *Error
	if !errors.As(err, &coreErr) || coreErr.Code != "credential_concurrency_exceeded" {
		t.Fatalf("expected *Error with credential_concurrency_exceeded, got %#v", coreErr)
	}
}
