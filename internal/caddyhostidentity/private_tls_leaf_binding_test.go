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
	"testing"
	"time"
)

func leafBindingFixture(t *testing.T) (*x509.CertPool, string, func(context.Context, string) (localTLSReadyEvidence, error),
	func(context.Context, privateHostEnabledTargets, string) (localRetiredOriginCandidate, error)) {
	t.Helper()
	server, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			t.Errorf("invalid authority: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch host {
		case "retired.example.test", "192.168.2.5":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("404 page not found\n"))
		case "photos.example.test", "192.168.2.4":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Errorf("unknown Host %q", r.Host)
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	addr := server.Listener.Addr().String()
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	positive := func(ctx context.Context, name string) (localTLSReadyEvidence, error) {
		return probeBoundLocalTLSReady(ctx, name, roots, addr, port)
	}
	negative := func(ctx context.Context, current privateHostEnabledTargets, retired string) (localRetiredOriginCandidate, error) {
		identity := current.domain
		if privateRetiredUsesLAN(current, retired) {
			identity = current.lanIPv4
		}
		return privateProbeBoundUnmatchedHost(ctx, identity, retired, roots, addr, port)
	}
	return roots, addr, positive, negative
}

// Real independently verified TLS handshakes must prove that the same current
// certificate leaf handled both Ready and a retired HTTP Host candidate.
func TestPrivateTLSLeafContinuityAcceptsSameVerifiedPeer(t *testing.T) {
	roots, _, positive, negative := leafBindingFixture(t)
	current := privateHostEnabledTargets{domain: "photos.example.test", lanIPv4: "192.168.2.4", lanRoots: roots}
	old := privateRetiredTargets{domain: "retired.example.test", lanIPv4: "192.168.2.5", lanRoots: roots}
	routes := strings.Replace(retiredTestRoutes, "current.example.test",
		"photos.example.test", 1)
	routes = strings.Replace(routes, `"host":["photos.example.test"]`, `"host":["photos.example.test","192.168.2.4"]`, 1)
	var order []string
	result, err := privateObserveTLSLeafContinuityWith(context.Background(), current, old,
		candidateTestRunner(&order, false, routes),
		positive,
		func(ctx context.Context, ip string, _ *x509.CertPool) (localTLSReadyEvidence, error) {
			return positive(ctx, ip)
		},
		negative,
		func(context.Context) ([]byte, error) { return []byte(routes), nil }, time.Now().UTC())
	if err != nil || !validDigest(result.retiredDomain) || !validDigest(result.retiredLAN) ||
		!validDigest(result.domainReady) || !validDigest(result.lanReady) || !validDigest(result.routeDigest) {
		t.Fatalf("same trusted leaf should be accepted: %v", err)
	}
	if strings.Join(order, ",") != "inspect,config,inspect,config" {
		t.Fatalf("unexpected original Docker sampling sequence: %v", order)
	}
	for _, proof := range []any{result, localTLSReadyEvidence{digest: result.domainReady},
		localRetiredOriginCandidate{digest: result.retiredDomain}} {
		raw, marshalErr := json.Marshal(proof)
		if marshalErr != nil || !bytes.Equal(raw, []byte("{}")) {
			t.Fatal("private TLS leaf or ingress identity serialized")
		}
	}
}

func TestPrivateTLSLeafContinuityRejectsDifferentTLSProxyLeaf(t *testing.T) {
	_, _, positive, _ := leafBindingFixture(t)
	second, secondRoots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("404 page not found\n"))
	}))
	_, secondPort, err := net.SplitHostPort(second.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	current := privateHostEnabledTargets{domain: "photos.example.test"}
	retired := privateRetiredTargets{domain: "retired.example.test"}
	routes := strings.Replace(retiredTestRoutes, "current.example.test", current.domain, 1)
	negativeDifferentLeaf := func(ctx context.Context, _ privateHostEnabledTargets, old string) (localRetiredOriginCandidate, error) {
		return privateProbeBoundUnmatchedHost(ctx, current.domain, old, secondRoots,
			second.Listener.Addr().String(), secondPort)
	}
	for _, tc := range []struct {
		name     string
		positive privateDomainReadyProbe
		negative privateHostRetiredTLSProbe
	}{
		{"different valid TLS terminating listener", positive, negativeDifferentLeaf},
		{"positive lacking peer leaf", func(context.Context, string) (localTLSReadyEvidence, error) {
			return localTLSReadyEvidence{digest: strings.Repeat("a", 64)}, nil
		}, negativeDifferentLeaf},
		{"retired response lacking peer leaf", positive, func(context.Context, privateHostEnabledTargets, string) (localRetiredOriginCandidate, error) {
			return localRetiredOriginCandidate{digest: strings.Repeat("b", 64)}, nil
		}},
		{"retired probe failure", positive, func(context.Context, privateHostEnabledTargets, string) (localRetiredOriginCandidate, error) {
			return localRetiredOriginCandidate{}, errors.New("untrusted")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var order []string
			got, callErr := privateObserveTLSLeafContinuityWith(context.Background(), current, retired,
				candidateTestRunner(&order, false, routes), tc.positive, nil, tc.negative,
				func(context.Context) ([]byte, error) { return []byte(routes), nil }, time.Now().UTC())
			if callErr == nil || got != (privateIngressTransportCandidates{}) {
				t.Fatal("a different TLS leaf was accepted as the original Host's current listener")
			}
		})
	}
}

func TestPrivateTLSLeafContinuityRejectsCancellationOrBadReader(t *testing.T) {
	current := privateHostEnabledTargets{domain: "photos.example.test"}
	retired := privateRetiredTargets{domain: "retired.example.test"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := privateObserveTLSLeafContinuityWith(ctx, current, retired, nil, nil, nil, nil, nil, time.Now().UTC())
	if err == nil || got != (privateIngressTransportCandidates{}) {
		t.Fatal("cancelled or empty fixed Host observer was allowed")
	}
	got, err = privateObserveTLSLeafContinuityWith(context.Background(), current, retired, nil, nil, nil, nil, nil, time.Now().UTC())
	if err == nil || got != (privateIngressTransportCandidates{}) {
		t.Fatal("missing proof reader was allowed")
	}
}
