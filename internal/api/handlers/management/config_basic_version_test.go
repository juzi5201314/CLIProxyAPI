package management

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLatestReleaseURLTargetsForkRepository(t *testing.T) {
	const want = "https://api.github.com/repos/juzi5201314/CLIProxyAPI/releases/latest"
	if latestReleaseURL != want {
		t.Fatalf("latestReleaseURL = %q, want %q", latestReleaseURL, want)
	}
}

func TestSetLatestReleaseRequestHeaders(t *testing.T) {
	tests := []struct {
		name              string
		githubToken       string
		wantAuthorization string
	}{
		{
			name:              "sets GitHub authorization",
			githubToken:       "release-token",
			wantAuthorization: "Bearer release-token",
		},
		{
			name: "omits authorization without token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GITHUB_TOKEN", tt.githubToken)
			if tt.githubToken == "" {
				t.Setenv("github_token", "")
			}
			t.Setenv("GITSTORE_GIT_TOKEN", "")
			t.Setenv("GITSTORE_GIT_URL", "")

			req := httptest.NewRequest(http.MethodGet, latestReleaseURL, nil)
			setLatestReleaseRequestHeaders(req)

			if got := req.Header.Get("Authorization"); got != tt.wantAuthorization {
				t.Fatalf("Authorization = %q, want %q", got, tt.wantAuthorization)
			}
			if got := req.Header.Get("Accept"); got != "application/vnd.github+json" {
				t.Fatalf("Accept = %q, want GitHub JSON media type", got)
			}
			if got := req.Header.Get("User-Agent"); got != latestReleaseUserAgent {
				t.Fatalf("User-Agent = %q, want %q", got, latestReleaseUserAgent)
			}
		})
	}
}
