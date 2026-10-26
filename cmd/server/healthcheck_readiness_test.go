package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunHealthcheckReadinessDetail(t *testing.T) {
	tests := []struct {
		name string
		path string
		code int
		body string
		want string
	}{
		{
			name: "healthy", path: "/api/v1/readyz", code: http.StatusOK,
			body: `{"ok":true,"database":"ok","storage":"ok"}`,
		},
		{
			name: "db unavailable even when postgres process is healthy",
			path: "/api/v1/readyz", code: http.StatusServiceUnavailable,
			body: `{"ok":false,"database":"unavailable","storage":"ok"}`,
			want: "health endpoint returned HTTP 503 (database=unavailable, storage=ok)",
		},
		{
			name: "storage unavailable while database authenticates",
			path: "/api/v1/readyz", code: http.StatusServiceUnavailable,
			body: `{"ok":false,"database":"ok","storage":"unavailable"}`,
			want: "health endpoint returned HTTP 503 (database=ok, storage=unavailable)",
		},
		{
			name: "both unavailable", path: "/api/v1/readyz",
			code: http.StatusServiceUnavailable,
			body: `{"database":"unavailable","storage":"unavailable"}`,
			want: "health endpoint returned HTTP 503 (database=unavailable, storage=unavailable)",
		},
		{
			name: "malformed readiness JSON", path: "/api/v1/readyz",
			code: http.StatusServiceUnavailable, body: "not json secret-token",
			want: "health endpoint returned HTTP 503",
		},
		{
			name: "untrusted readiness value cannot be echoed", path: "/api/v1/readyz",
			code: http.StatusServiceUnavailable,
			body: `{"database":"password=secret-token","storage":"ok"}`,
			want: "health endpoint returned HTTP 503",
		},
		{
			name: "non-readyz endpoint not inspected", path: "/other",
			code: http.StatusServiceUnavailable,
			body: `{"database":"unavailable","storage":"ok"}`,
			want: "health endpoint returned HTTP 503",
		},
		{
			name: "other HTTP errors do not include arbitrary response", path: "/api/v1/readyz",
			code: http.StatusInternalServerError, body: "Authorization: Bearer secret-token",
			want: "health endpoint returned HTTP 500",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			err := runHealthcheck([]string{server.URL + tc.path})
			if tc.want == "" {
				if err != nil {
					t.Fatalf("healthy readiness returned unexpected error: %v", err)
				}
				return
			}
			if err == nil || err.Error() != tc.want {
				t.Fatalf("unexpected healthcheck result: got %v; want %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "secret-token") {
				t.Fatal("healthcheck leaked an untrusted upstream body")
			}
		})
	}
}
