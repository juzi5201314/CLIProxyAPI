package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/credentialconcurrency"
)

// ConcurrencyBusyError reports that all otherwise eligible credentials were skipped due to local concurrency limits.
type ConcurrencyBusyError struct {
	cause *Error
}

func newLocalConcurrencyBusyError(message string) *ConcurrencyBusyError {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "credential concurrency limit exceeded"
	}
	return &ConcurrencyBusyError{
		cause: &Error{
			Code:       "credential_concurrency_exceeded",
			Message:    message,
			Retryable:  true,
			HTTPStatus: http.StatusTooManyRequests,
		},
	}
}

func (e *ConcurrencyBusyError) Error() string {
	if e == nil || e.cause == nil {
		return ""
	}
	return e.cause.Error()
}

// Unwrap exposes the underlying *Error for errors.As inspection.
func (e *ConcurrencyBusyError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

// StatusCode returns HTTP 429 Too Many Requests.
func (e *ConcurrencyBusyError) StatusCode() int {
	if e == nil || e.cause == nil {
		return 0
	}
	return e.cause.StatusCode()
}

func isConcurrencyBusyError(err error) bool {
	if err == nil {
		return false
	}
	var busyErr *ConcurrencyBusyError
	return errors.As(err, &busyErr)
}

// ValidateAuthMaxConcurrency validates every explicit max-concurrency source on an auth entry.
func ValidateAuthMaxConcurrency(auth *Auth) error {
	if auth == nil {
		return nil
	}
	if rawLimit, ok := auth.Attributes[AttributeMaxConcurrency]; ok {
		if _, errParse := credentialconcurrency.ParseString(rawLimit); errParse != nil {
			return fmt.Errorf("invalid attributes max_concurrency: %w", errParse)
		}
	}
	if rawGroupLimit, ok := auth.Attributes[AttributeProviderMaxConcurrency]; ok {
		if _, errParse := credentialconcurrency.ParseString(rawGroupLimit); errParse != nil {
			return fmt.Errorf("invalid attributes provider_max_concurrency: %w", errParse)
		}
	}
	if auth.Metadata != nil {
		for _, key := range []string{AttributeMaxConcurrency, "max-concurrency"} {
			if rawLimit, ok := auth.Metadata[key]; ok && rawLimit != nil {
				if _, errParse := credentialconcurrency.ParseValue(rawLimit); errParse != nil {
					return fmt.Errorf("invalid metadata max_concurrency: %w", errParse)
				}
			}
		}
	}
	return nil
}

// ApplyAuthMaxConcurrencyMetadata validates the auth and applies a source metadata max_concurrency attribute.
func ApplyAuthMaxConcurrencyMetadata(auth *Auth, metadata map[string]any) error {
	if errValidate := ValidateAuthMaxConcurrency(auth); errValidate != nil {
		return errValidate
	}
	if auth == nil || metadata == nil {
		return nil
	}
	var rawLimit any
	var ok bool
	for _, key := range []string{AttributeMaxConcurrency, "max-concurrency"} {
		if val, exists := metadata[key]; exists {
			rawLimit = val
			ok = true
			break
		}
	}
	if !ok {
		return nil
	}
	if rawLimit == nil {
		if auth.Attributes != nil {
			delete(auth.Attributes, AttributeMaxConcurrency)
		}
		return nil
	}
	limit, errParse := credentialconcurrency.ParseValue(rawLimit)
	if errParse != nil {
		return fmt.Errorf("invalid metadata max_concurrency: %w", errParse)
	}
	if limit <= 0 {
		if auth.Attributes != nil {
			delete(auth.Attributes, AttributeMaxConcurrency)
		}
		return nil
	}
	if auth.Attributes == nil {
		auth.Attributes = make(map[string]string)
	}
	auth.Attributes[AttributeMaxConcurrency] = strconv.FormatInt(limit, 10)
	return nil
}

func authMaxConcurrency(auth *Auth) int64 {
	if auth == nil {
		return 0
	}
	if auth.Attributes != nil {
		if rawLimit, ok := auth.Attributes[AttributeMaxConcurrency]; ok && strings.TrimSpace(rawLimit) != "" {
			limit, errParse := credentialconcurrency.ParseString(rawLimit)
			if errParse != nil || limit <= 0 {
				return 0
			}
			return limit
		}
	}
	if auth.Metadata != nil {
		for _, key := range []string{AttributeMaxConcurrency, "max-concurrency"} {
			if rawLimit, ok := auth.Metadata[key]; ok && rawLimit != nil {
				limit, errParse := credentialconcurrency.ParseValue(rawLimit)
				if errParse != nil || limit <= 0 {
					return 0
				}
				return limit
			}
		}
	}
	return 0
}

func authProviderConcurrencyLimit(auth *Auth) (groupKey string, limit int64) {
	if auth == nil || auth.Attributes == nil {
		return "", 0
	}
	groupKey = strings.TrimSpace(auth.Attributes[AttributeProviderConcurrencyKey])
	if groupKey == "" {
		return "", 0
	}
	rawLimit := strings.TrimSpace(auth.Attributes[AttributeProviderMaxConcurrency])
	if rawLimit == "" {
		return "", 0
	}
	parsed, errParse := credentialconcurrency.ParseString(rawLimit)
	if errParse != nil || parsed <= 0 {
		return "", 0
	}
	return groupKey, parsed
}
