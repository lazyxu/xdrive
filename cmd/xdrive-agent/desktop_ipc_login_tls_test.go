package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"syscall"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopIPCLoginTransportErrorsAreActionableAndRedacted(t *testing.T) {
	cert := &x509.Certificate{}
	testCases := []struct {
		name string
		err  error
		code string
		http int
	}{
		{"untrusted-ca", x509.UnknownAuthorityError{Cert: cert}, "server_tls_trust", http.StatusBadGateway},
		{"ip-san-mismatch", x509.HostnameError{Certificate: cert, Host: "192.168.2.4"}, "server_tls_name", http.StatusBadGateway},
		{"expired", x509.CertificateInvalidError{Cert: cert, Reason: x509.Expired}, "server_tls_date", http.StatusBadGateway},
		{"tls-protocol", tls.RecordHeaderError{Msg: "bad TLS record"}, "server_tls_protocol", http.StatusBadGateway},
		{"timeout", context.DeadlineExceeded, "server_timeout", http.StatusGatewayTimeout},
		{"tcp-refused", &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED}, "server_refused", http.StatusBadGateway},
		{"dns", &net.DNSError{Err: "no such host", Name: "private.example"}, "server_network", http.StatusBadGateway},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			wrapped := fmt.Errorf("wrapped: %w", &url.Error{
				Op:  "Post",
				URL: "https://192.168.2.4:8443/api/v1/auth/login?secret=redacted",
				Err: tc.err,
			})
			recorder := httptest.NewRecorder()
			writeDesktopIPCLoginError(recorder, wrapped)
			if recorder.Code != tc.http {
				t.Fatalf("status=%d, want %d", recorder.Code, tc.http)
			}
			var payload map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["error"] != tc.code || payload["message"] == "" {
				t.Fatalf("unexpected response: %#v", payload)
			}
			for _, secret := range []string{"secret=redacted", "192.168.2.4", "wrapped:", "private.example", "bad TLS record"} {
				if strings.Contains(payload["message"], secret) {
					t.Fatalf("transport diagnostic leaked upstream details %q", secret)
				}
			}
		})
	}
}

func TestDesktopIPCLoginPreservesGenuineServerAuthErrors(t *testing.T) {
	for _, tc := range []struct {
		code string
		http int
	}{
		{"invalid_credentials", http.StatusUnauthorized},
		{"account_disabled", http.StatusForbidden},
	} {
		t.Run(tc.code, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			writeDesktopIPCLoginError(recorder, &client.APIError{Status: tc.http, Msg: tc.code})
			if recorder.Code != tc.http {
				t.Fatalf("status=%d, want %d", recorder.Code, tc.http)
			}
			var payload map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["error"] != tc.code {
				t.Fatalf("wrong authentication response: %#v", payload)
			}
		})
	}
}

func TestDesktopIPCLoginUnknownErrorsPreserveExistingFallback(t *testing.T) {
	_, _, _, ok := classifyDesktopLoginTransportError(nil)
	if ok {
		t.Fatal("nil error cannot be classified")
	}
	recorder := httptest.NewRecorder()
	writeDesktopIPCLoginError(recorder, errors.New("test failure"))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", recorder.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["error"] != "operation_failed" {
		t.Fatalf("unknown failure should preserve established IPC fallback: %#v", payload)
	}
}

func TestDesktopIPCLoginHandlerUsesTransportClassifier(t *testing.T) {
	// Code-level contract: authenticate errors must pass through the bounded
	// login-only classifier, not the broad legacy operation_failed handler.
	if _, _, _, ok := classifyDesktopLoginTransportError(
		&url.Error{Op: "Post", URL: "https://host", Err: errors.New("network failure")},
	); !ok {
		t.Fatal("unexpected Go HTTP transport failures must have a sanitized fallback")
	}
}
