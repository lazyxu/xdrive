package caddyhostidentity

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetiredOriginCandidateRequiresRealTrustedTLS421(t *testing.T) {
	var seen atomic.Int32
	server, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/readyz" ||
			r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" ||
			r.Host == "" || r.Header.Get("Accept") != "text/plain" {
			t.Error("retired probe sent unsafe request")
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusMisdirectedRequest)
		_, _ = w.Write([]byte("421 Misdirected Request\n"))
	}))
	addr := server.Listener.Addr().String()
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	for _, identity := range []string{"photos.example.test", "192.168.2.4"} {
		got, err := probeBoundRetiredOriginCandidate(context.Background(), identity, roots, addr, port)
		if err != nil || !validDigest(got.digest) || strings.Contains(got.digest, identity) {
			t.Fatalf("strict 421 probe rejected or leaked identity: %v", err)
		}
		raw, err := json.Marshal(got)
		if err != nil || !bytes.Equal(raw, []byte("{}")) {
			t.Fatal("private retired-origin details were serialized")
		}
	}
	if seen.Load() != 2 {
		t.Fatalf("expected two genuine TLS requests, got %d", seen.Load())
	}
}

func TestRetiredOriginCandidateNeverTreatsAmbiguityAsNegative(t *testing.T) {
	for _, tt := range []struct {
		name                       string
		status                     int
		ct, body, location, cookie string
	}{
		{"enabled ready", 200, "application/json", `{"ok":true}`, "", ""},
		{"authentication gate", 401, "text/plain", "401", "", ""},
		{"authorization failure", 403, "text/plain", "403", "", ""},
		{"generic not found", 404, "text/plain", "404", "", ""},
		{"redirect", 302, "text/plain", "302", "https://evil.example.test/", ""},
		{"backend unavailable", 503, "text/plain", "503", "", ""},
		{"private JSON 421", 421, "application/json", `{"ok":false}`, "", ""},
		{"SPA 421", 421, "text/html", "<html></html>", "", ""},
		{"forged JSON 421", 421, "text/plain", `{"ok":false}`, "", ""},
		{"redirect metadata 421", 421, "text/plain", "", "https://evil.example.test/", ""},
		{"cookie on 421", 421, "text/plain", "", "", "session=secret"},
		{"oversized 421", 421, "text/plain", strings.Repeat("a", retiredOriginResponseLimit+1), "", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tt.ct)
				if tt.location != "" {
					w.Header().Set("Location", tt.location)
				}
				if tt.cookie != "" {
					w.Header().Set("Set-Cookie", tt.cookie)
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			got, err := probeBoundRetiredOriginCandidate(context.Background(), "photos.example.test", roots, srv.Listener.Addr().String(), port)
			if err == nil || got.digest != "" {
				t.Fatalf("unsafe probe became negative candidate: %v", err)
			}
		})
	}
}

func TestRetiredOriginCandidateRejectsBadCAIdentityAndCancellation(t *testing.T) {
	srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMisdirectedRequest)
	}))
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		identity string
		roots    *x509.CertPool
	}{
		{"other.example.test", roots}, {"192.168.2.5", roots},
		{"photos.example.test", x509.NewCertPool()},
		{"http://photos.example.test", roots},
	} {
		result, err := probeBoundRetiredOriginCandidate(context.Background(), item.identity, item.roots, srv.Listener.Addr().String(), port)
		if err == nil || result.digest != "" {
			t.Fatal("untrusted TLS or malformed target accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := probeBoundRetiredOriginCandidate(ctx, "photos.example.test", roots, srv.Listener.Addr().String(), port); err == nil {
		t.Fatal("cancelled retired origin probe accepted")
	}
	if _, err := probeRetiredDomainCandidate(context.Background(), "https://photos.example.test"); err == nil {
		t.Fatal("arbitrary URL admitted to production wrapper")
	}
	if _, err := probeRetiredLANCandidate(context.Background(), "192.168.2.4", nil); err == nil {
		t.Fatal("missing pinned local CA was accepted")
	}
}

func candidateTestRunner(order *[]string, changed bool, routes string) privateHostSampleRunner {
	inspect, _ := fixture()
	live := retiredTestHash(routes) + "  -\n"
	sample := 0
	return func(ctx context.Context, k privateHostSampleKind) ([]byte, error) {
		if k == privateHostDockerGeneration {
			sample++
			*order = append(*order, "inspect")
			if changed && sample == 2 {
				return []byte(strings.Replace(inspect, "|123|", "|124|", 1)), nil
			}
			return []byte(inspect), nil
		}
		*order = append(*order, "config")
		return []byte(live), nil
	}
}

func TestRetiredOriginCandidatesBracketRealChecksInsideOneGeneration(t *testing.T) {
	var order []string
	roots := x509.NewCertPool()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	routes := strings.Replace(retiredTestRoutes, `"host":["current.example.test"]`, `"host":["current.example.test","192.168.2.4"]`, 1)
	got, err := privateObserveIngressCandidatesWith(context.Background(),
		privateHostEnabledTargets{domain: "current.example.test", lanIPv4: "192.168.2.4", lanRoots: roots},
		privateRetiredTargets{domain: "former.example.test", lanIPv4: "192.168.2.5", lanRoots: roots},
		candidateTestRunner(&order, false, routes),
		func(ctx context.Context, s string) (localTLSReadyEvidence, error) {
			order = append(order, "domain-ready")
			if s != "current.example.test" {
				return localTLSReadyEvidence{}, errors.New("wrong name")
			}
			return localTLSReadyEvidence{digest: strings.Repeat("a", 64)}, nil
		},
		func(ctx context.Context, s string, p *x509.CertPool) (localTLSReadyEvidence, error) {
			order = append(order, "lan-ready")
			if s != "192.168.2.4" || p != roots {
				return localTLSReadyEvidence{}, errors.New("wrong LAN")
			}
			return localTLSReadyEvidence{digest: strings.Repeat("b", 64)}, nil
		},
		func(ctx context.Context, s string) (localRetiredOriginCandidate, error) {
			order = append(order, "retired-domain")
			if s != "former.example.test" {
				return localRetiredOriginCandidate{}, errors.New("wrong former domain")
			}
			return localRetiredOriginCandidate{digest: strings.Repeat("c", 64)}, nil
		},
		func(ctx context.Context, s string, p *x509.CertPool) (localRetiredOriginCandidate, error) {
			order = append(order, "retired-lan")
			if s != "192.168.2.5" || p != roots {
				return localRetiredOriginCandidate{}, errors.New("wrong former LAN")
			}
			return localRetiredOriginCandidate{digest: strings.Repeat("d", 64)}, nil
		},
		func(ctx context.Context) ([]byte, error) {
			order = append(order, "routes")
			return []byte(routes), nil
		}, now)
	if err != nil || !validDigest(got.runtime.generationSHA) || got.retiredDomain != strings.Repeat("c", 64) || got.retiredLAN != strings.Repeat("d", 64) {
		t.Fatalf("stable candidate set failed: %v", err)
	}
	if joined := strings.Join(order, ","); joined != "inspect,config,domain-ready,lan-ready,retired-domain,retired-lan,routes,inspect,config" {
		t.Fatalf("proofs did not share one Caddy generation: %s", joined)
	}
	raw, _ := json.Marshal(got)
	if string(raw) != "{}" {
		t.Fatal("private source, target or TLS evidence escaped JSON")
	}
}

func TestRetiredOriginCandidatesRejectBogusTargetsFailedProbesAndReload(t *testing.T) {
	roots := x509.NewCertPool()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	ready := func(context.Context, string) (localTLSReadyEvidence, error) {
		return localTLSReadyEvidence{digest: strings.Repeat("a", 64)}, nil
	}
	retired := func(context.Context, string) (localRetiredOriginCandidate, error) {
		return localRetiredOriginCandidate{digest: strings.Repeat("b", 64)}, nil
	}
	for _, bad := range []struct {
		current privateHostEnabledTargets
		old     privateRetiredTargets
	}{
		{privateHostEnabledTargets{}, privateRetiredTargets{domain: "former.example.test"}},
		{privateHostEnabledTargets{domain: "current.example.test"}, privateRetiredTargets{}},
		{privateHostEnabledTargets{domain: "current.example.test"}, privateRetiredTargets{domain: "current.example.test"}},
		{privateHostEnabledTargets{lanIPv4: "192.168.2.4", lanRoots: roots}, privateRetiredTargets{lanIPv4: "192.168.2.4", lanRoots: roots}},
		{privateHostEnabledTargets{domain: "https://current.example.test"}, privateRetiredTargets{domain: "former.example.test"}},
		{privateHostEnabledTargets{domain: "current.example.test"}, privateRetiredTargets{lanIPv4: "192.168.2.5"}},
	} {
		var order []string
		got, err := privateObserveIngressCandidatesWith(context.Background(), bad.current, bad.old, candidateTestRunner(&order, false, retiredTestRoutes), ready, nil, retired, nil, func(context.Context) ([]byte, error) { return []byte(retiredTestRoutes), nil }, now)
		if err == nil || got != (privateIngressTransportCandidates{}) || len(order) != 0 {
			t.Fatal("untrusted retired targets admitted before any Docker sample")
		}
	}
	var order []string
	got, err := privateObserveIngressCandidatesWith(context.Background(),
		privateHostEnabledTargets{domain: "current.example.test"}, privateRetiredTargets{domain: "former.example.test"},
		candidateTestRunner(&order, true, retiredTestRoutes), ready, nil, retired, nil, func(context.Context) ([]byte, error) { return []byte(retiredTestRoutes), nil }, now)
	if err == nil || got != (privateIngressTransportCandidates{}) {
		t.Fatal("changed Docker generation accepted")
	}
	order = nil
	got, err = privateObserveIngressCandidatesWith(context.Background(),
		privateHostEnabledTargets{domain: "current.example.test"}, privateRetiredTargets{domain: "former.example.test"},
		candidateTestRunner(&order, false, retiredTestRoutes), ready, nil,
		func(context.Context, string) (localRetiredOriginCandidate, error) {
			return localRetiredOriginCandidate{}, errors.New("tls failed")
		}, nil, func(context.Context) ([]byte, error) { return []byte(retiredTestRoutes), nil }, now)
	if err == nil || got != (privateIngressTransportCandidates{}) {
		t.Fatal("failed negative transport observation promoted")
	}
}
