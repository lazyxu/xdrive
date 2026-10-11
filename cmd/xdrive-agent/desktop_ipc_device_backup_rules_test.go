package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type localRulesManagerFake struct {
	*fakeDesktopIPCController
	sourceID  uint64
	revision  uint64
	rules     string
	readCount int
}

func (f *localRulesManagerFake) CloudLocalBoundBackupRules(_ context.Context, sourceID uint64) (client.LocalBoundIgnoreRules, error) {
	f.sourceID, f.readCount = sourceID, f.readCount+1
	return client.LocalBoundIgnoreRules{SourceID: sourceID, Revision: 7, IgnoreRules: "*.tmp"}, nil
}

func (f *localRulesManagerFake) CloudSetLocalBoundBackupRules(_ context.Context, sourceID, revision uint64, rules string) (client.LocalBoundIgnoreRules, error) {
	f.sourceID, f.revision, f.rules = sourceID, revision, rules
	return client.LocalBoundIgnoreRules{SourceID: sourceID, Revision: revision + 1, IgnoreRules: rules}, nil
}

func TestDesktopIPCLocalRulesReadWriteAuthAndStrictPayload(t *testing.T) {
	f := &localRulesManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	good := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-rules?source_id=42", "")
	if good.Code != http.StatusOK || f.sourceID != 42 || f.readCount != 1 ||
		good.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(good.Body.String(), "\"ignore_rules\":\"*.tmp\"") {
		t.Fatalf("private local rule read failed or cacheable: code=%d %s", good.Code, good.Body.String())
	}
	for _, secret := range []string{"root_id", "device_token", "root_fingerprint", "local_path", "checkpoint"} {
		if strings.Contains(good.Body.String(), secret) {
			t.Fatalf("private rule read leaked %s", secret)
		}
	}
	for _, uri := range []string{"/v1/device-backups/local-rules", "/v1/device-backups/local-rules?source_id=0"} {
		if result := desktopIPCRequest(t, h, http.MethodGet, uri, ""); result.Code != http.StatusBadRequest {
			t.Fatalf("invalid rules read accepted: %s status=%d", uri, result.Code)
		}
	}
	input := "{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"*.cache\"}"
	wrote := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-rules", input)
	if wrote.Code != http.StatusOK || f.sourceID != 42 || f.revision != 7 || f.rules != "*.cache" {
		t.Fatalf("private rules write failed: %d %s", wrote.Code, wrote.Body.String())
	}
	for _, invalid := range []string{
		"{\"source_id\":0,\"revision\":7,\"ignore_rules\":\"*.tmp\"}",
		"{\"source_id\":42,\"revision\":0,\"ignore_rules\":\"*.tmp\"}",
		"{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"../escape\"}",
		"{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"x\",\"device_id\":\"forged\"}",
		"{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"x\",\"root_id\":\"forged\"}",
		"{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"" + strings.Repeat("x", 65537) + "\"}",
	} {
		if bad := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-rules", invalid); bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid rules accepted (%s...): %d", invalid[:min(60, len(invalid))], bad.Code)
		}
	}
	anon := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-rules?source_id=42", nil)
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated rules read accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalRulesCannotBorrowGenericSource(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	for _, tc := range []struct {
		method, path, body string
	}{
		{http.MethodGet, "/v1/device-backups/local-rules?source_id=42", ""},
		{http.MethodPatch, "/v1/device-backups/local-rules", "{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"*.tmp\"}"},
	} {
		got := desktopIPCRequest(t, h, tc.method, tc.path, tc.body)
		if got.Code != http.StatusNotImplemented {
			t.Fatalf("generic Source fallback allowed %s: %d", tc.method, got.Code)
		}
	}
}
