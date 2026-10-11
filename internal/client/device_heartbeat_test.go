package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendDeviceHeartbeatUsesExactAuthenticatedNarrowEndpoint(t *testing.T) {
	count := 0
	failNext := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/devices/self/heartbeat" ||
			r.URL.RawQuery != "" || r.ContentLength != 0 ||
			r.Header.Get("Authorization") != "Bearer owner-token" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-id" ||
			r.Header.Get("X-XDrive-Device-Token") != "device-secret" ||
			r.Header.Get("Content-Type") != "" {
			t.Errorf("unsafe heartbeat transport: %s %s", r.Method, r.URL)
		}
		if failNext {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"device credential invalid or revoked"}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	c := New(server.URL, "owner-token")
	if err := c.SendDeviceHeartbeat(context.Background(), "device-id", "device-secret"); err != nil {
		t.Fatal(err)
	}
	failNext = true
	err := c.SendDeviceHeartbeat(context.Background(), "device-id", "device-secret")
	if err == nil || !strings.Contains(err.Error(), "device credential invalid or revoked") {
		t.Fatalf("revoked credential failure must be propagated: %v", err)
	}
	if count != 2 {
		t.Fatalf("unexpected heartbeat requests: %d", count)
	}
}
