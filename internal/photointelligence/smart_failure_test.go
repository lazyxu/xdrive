package photointelligence

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
)

func TestSmartFailureCodeRedactsPrivateErrors(t *testing.T) {
	const secret = "PRIVATE_SMART_TOKEN_NEVER_LEAK"
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, ""},
		{"cancelled", fmt.Errorf("%s: %w", secret, context.Canceled), "interrupted"},
		{"deadline", fmt.Errorf("%s: %w", secret, context.DeadlineExceeded), "model_timeout"},
		{"unix socket", &net.OpError{Op: "dial", Net: "unix", Err: errors.New(secret)}, "model_unreachable"},
		{"auth", errors.New("smart analyzer returned HTTP 403: " + secret), "model_auth_rejected"},
		{"missing endpoint", errors.New("smart analyzer returned HTTP 404: " + secret), "model_endpoint_missing"},
		{"busy", errors.New("smart analyzer returned HTTP 429: " + secret), "model_busy"},
		{"server", errors.New("smart analyzer returned HTTP 503: " + secret), "model_server_error"},
		{"decode", errors.New("decode smart analyzer response: " + secret), "invalid_model_response"},
		{"preview", errors.New("smart analysis preview URL is invalid: " + secret), "preview_unavailable"},
		{"unknown", errors.New("token=" + secret), "analysis_failed"},
		{"stored", errors.New("model_timeout"), "model_timeout"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code := SmartFailureCode(tc.err)
			if code != tc.want || strings.Contains(code, secret) {
				t.Fatalf("failure code=%q, want %q", code, tc.want)
			}
		})
	}
}

func TestSmartFailureCodeFromLegacyDatabaseIsAllowlisted(t *testing.T) {
	const secret = "TOKEN_STORED_BEFORE_FIX"
	for _, tc := range []struct {
		raw  string
		want string
	}{
		{"smart analyzer returned HTTP 401: " + secret, "model_auth_rejected"},
		{"smart analyzer request failed: dial /private/" + secret, "model_unreachable"},
		{"smart analyzer returned HTTP malformed: " + secret, "analysis_failed"},
		{"signed-ticket=" + secret, "analysis_failed"},
		{"model_server_error", "model_server_error"},
		{"", "analysis_failed"},
	} {
		actual := SmartFailureCodeFromStored(tc.raw)
		if actual != tc.want || strings.Contains(actual, secret) {
			t.Fatalf("unsafe stored reason=%q, want %q", actual, tc.want)
		}
	}
}
