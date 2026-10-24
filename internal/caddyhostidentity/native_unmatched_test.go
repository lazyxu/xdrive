package caddyhostidentity

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeRetiredHostKeepsCurrentTLSSANAndUsesOldHTTPHost(t *testing.T) {
	var hit atomic.Int32
	srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit.Add(1)
		if r.URL.Path != "/api/v1/readyz" || r.Method != http.MethodGet || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Referer") != "" {
			t.Error("unsafe request")
		}
		host, _, _ := net.SplitHostPort(r.Host)
		if host != "retired.example.test" && host != "192.168.2.5" {
			t.Errorf("wrong HTTP Host %q", r.Host)
		}
		if host == "retired.example.test" && r.TLS.ServerName != "photos.example.test" {
			t.Errorf("wrong current SNI %q", r.TLS.ServerName)
		}
		if host == "192.168.2.5" && r.TLS.ServerName != "" {
			t.Errorf("private IP should have no SNI %q", r.TLS.ServerName)
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(404)
		_, _ = w.Write([]byte("404 page not found\n"))
	}))
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
	for _, tc := range []struct{ current, retired string }{
		{"photos.example.test", "retired.example.test"},
		{"192.168.2.4", "192.168.2.5"},
	} {
		proof, err := privateProbeBoundUnmatchedHost(context.Background(), tc.current, tc.retired, roots, srv.Listener.Addr().String(), port)
		if err != nil || len(proof.digest) != 64 {
			t.Fatalf("verified current TLS route-negative candidate failed %s: %v", tc.current, err)
		}
		b, err := json.Marshal(proof)
		if err != nil || !bytes.Equal(b, []byte("{}")) {
			t.Fatal("private proof serialized")
		}
	}
	if hit.Load() != 2 {
		t.Fatal("expected distinct valid host probes")
	}
}

func TestNativeRetiredHostNeverPromotesAmbiguousResponse(t *testing.T) {
	cases := []struct {
		name                       string
		status                     int
		ct, body, redirect, cookie string
	}{
		{"upstream ready", 200, "application/json", `{"ok":true}`, "", ""},
		{"old 421 not Caddy proof", 421, "text/plain", "421 Misdirected Request\n", "", ""},
		{"redirect", 302, "text/plain", "", "https://evil.example.test/", ""},
		{"forged HTML 404", 404, "text/html", "<html></html>", "", ""},
		{"backend JSON 404", 404, "text/plain", `{"status":"missing"}`, "", ""},
		{"cookie 404", 404, "text/plain", "404", "", "sid=exposed"},
		{"too large 404", 404, "text/plain", strings.Repeat("x", retiredOriginResponseLimit+1), "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.ct)
				if tc.redirect != "" {
					w.Header().Set("Location", tc.redirect)
				}
				if tc.cookie != "" {
					w.Header().Set("Set-Cookie", tc.cookie)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
			proof, err := privateProbeBoundUnmatchedHost(context.Background(), "photos.example.test", "retired.example.test", roots, srv.Listener.Addr().String(), port)
			if err == nil || proof.digest != "" {
				t.Fatal("ambiguous route response accepted")
			}
		})
	}
}

func TestNativeRetiredHostRejectsWrongActiveTLSAndCancelled(t *testing.T) {
	srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }))
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
	for _, tc := range []struct {
		current, retired string
		roots            *x509.CertPool
	}{
		{"other.example.test", "retired.example.test", roots},
		{"photos.example.test", "retired.example.test", x509.NewCertPool()},
		{"192.168.2.4", "192.168.2.5", nil},
		{"photos.example.test", "photos.example.test", roots},
		{"http://photos.example.test", "retired.example.test", roots},
	} {
		proof, err := privateProbeBoundUnmatchedHost(context.Background(), tc.current, tc.retired, tc.roots, srv.Listener.Addr().String(), port)
		if err == nil || proof.digest != "" {
			t.Fatal("untrusted old/new Host identity admitted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := privateProbeBoundUnmatchedHost(ctx, "photos.example.test", "retired.example.test", roots, srv.Listener.Addr().String(), port); err == nil {
		t.Fatal("cancelled probe executed")
	}
}

func TestNativeRetiredHost404CannotOverridePinnedLiveRoute(t *testing.T) {
	srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			t.Error(err)
			return
		}
		switch host {
		case "photos.example.test":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "retired.example.test":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("404 page not found\n"))
		default:
			t.Errorf("unexpected Host %q", host)
		}
	}))
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	current := privateHostEnabledTargets{domain: "photos.example.test"}
	retired := privateRetiredTargets{domain: "retired.example.test"}
	original := strings.Replace(retiredTestRoutes, "current.example.test", "photos.example.test", 1)
	for _, tt := range []struct {
		name, routes string
		success      bool
	}{
		{"strict live host routes", original, true},
		{"backend forged plain 404 with still-routed old Host", strings.Replace(original, `"host":["photos.example.test"]`, `"host":["photos.example.test","retired.example.test"]`, 1), false},
		{"backend forged plain 404 with HTTPS catchall", strings.Replace(original, `"match":[{"host":["photos.example.test"]}],`, "", 1), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var order []string
			proof, err := privateObserveIngressCandidatesWith(context.Background(), current, retired,
				candidateTestRunner(&order, false, tt.routes),
				func(ctx context.Context, identity string) (localTLSReadyEvidence, error) {
					return probeBoundLocalTLSReady(ctx, identity, roots, srv.Listener.Addr().String(), port)
				}, nil,
				func(ctx context.Context, old string) (localRetiredOriginCandidate, error) {
					return privateProbeBoundUnmatchedHost(ctx, current.domain, old, roots, srv.Listener.Addr().String(), port)
				}, nil,
				func(context.Context) ([]byte, error) { return []byte(tt.routes), nil }, time.Now().UTC())
			if tt.success {
				if err != nil || !validDigest(proof.routeDigest) || !validDigest(proof.retiredDomain) {
					t.Fatalf("correct live Caddy-style route rejected: %v", err)
				}
			} else if err == nil || proof != (privateIngressTransportCandidates{}) {
				t.Fatal("backend-supplied 404 without Caddy route absence became trusted")
			}
		})
	}
}
