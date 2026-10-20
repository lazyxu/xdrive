package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCaddyInternalHTTPRouteStrictReadOnly(t *testing.T) {
	responseStatus := http.StatusOK
	responseBody := `{"ok":true,"database":"ok","storage":"ok"}`
	responseType := "application/json; charset=utf-8"
	requests := 0
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		status, kind, body := responseStatus, responseType, responseBody
		mu.Unlock()
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/readyz" ||
			r.Host != caddyInternalRouteAddress || r.Header.Get("Authorization") != "" ||
			r.Header.Get("Cookie") != "" {
			t.Errorf("unexpected internal HTTP request: %s %s %s", r.Method, r.URL.Path, r.Host)
		}
		w.Header().Set("Content-Type", kind)
		if status == http.StatusFound {
			w.Header().Set("Location", "https://example.invalid/secret")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != "caddy:80" {
			t.Fatalf("untrusted dial: %q/%q", network, address)
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	t.Setenv("HTTP_PROXY", "http://example.invalid:9919")
	t.Setenv("http_proxy", "http://example.invalid:9919")
	check := func(want bool) {
		t.Helper()
		got := caddyInternalRouteReady(context.Background(), dial)
		if got != want {
			t.Fatalf("Ready = %v, want %v", got, want)
		}
	}
	check(true)
	for _, tt := range []struct {
		status     int
		kind, body string
	}{
		{http.StatusFound, "application/json", `{"ok":true,"database":"ok","storage":"ok"}`},
		{http.StatusOK, "text/html", `<html>SPA fallback</html>`},
		{http.StatusOK, "application/json", `<html>SPA fallback</html>`},
		{http.StatusOK, "application/json", `{"ok":false,"database":"ok","storage":"ok"}`},
		{http.StatusOK, "application/json", `{"ok":true,"database":"failed","storage":"ok"}`},
		{http.StatusServiceUnavailable, "application/json", `{"ok":true,"database":"ok","storage":"ok"}`},
		{http.StatusOK, "application/json", strings.Repeat("X", caddyInternalRouteResponseLimit+1)},
	} {
		mu.Lock()
		responseStatus, responseType, responseBody = tt.status, tt.kind, tt.body
		mu.Unlock()
		check(false)
	}
	mu.Lock()
	defer mu.Unlock()
	if requests != 8 {
		t.Fatalf("unexpected total requests: %d", requests)
	}
}

func TestCaddyInternalHTTPRouteNeverPromotesHostProof(t *testing.T) {
	item := serviceDependency{ID: "caddy", Status: "unknown", ConfigurationState: "unknown", InstallationState: "unknown", HealthState: "unknown", ActivationState: "deployment-only"}
	annotateCaddyMissingHostWitness(&item, "snapshot-missing", true, true)
	if item.CaddyInternalHTTPState != "reachable" || item.Status != "unknown" ||
		item.ConfigurationState != "unknown" || item.InstallationState != "unknown" ||
		item.HealthState != "unknown" || item.ActivationState != "deployment-only" ||
		item.HTTPSConfigured != nil || item.LocalTLSState != "" {
		t.Fatalf("internal HTTP cannot fabricate Caddy/TLS/Host Apply: %+v", item)
	}
	annotateCaddyMissingHostWitness(&item, "snapshot-stale", true, false)
	if item.CaddyInternalHTTPState != "unavailable" || item.Detail != "snapshot-stale" {
		t.Fatalf("negative internal HTTP is not proof Caddy stopped: %+v", item)
	}
	annotateCaddyMissingHostWitness(&item, "snapshot-unreadable", false, false)
	if item.Detail != "snapshot-unreadable" {
		t.Fatal("missing witness reason discarded")
	}
	if caddyInternalRouteReady(context.Background(), nil) {
		t.Fatal("nil dialer accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if caddyInternalRouteReady(ctx, (&net.Dialer{Timeout: time.Millisecond}).DialContext) {
		t.Fatal("cancelled probe accepted")
	}
}
