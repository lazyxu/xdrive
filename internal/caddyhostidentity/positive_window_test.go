package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func privatePositiveTestRunner(order *[]string) privateHostSampleRunner {
	inspect, live := fixture()
	return func(_ context.Context, kind privateHostSampleKind) ([]byte, error) {
		if kind == privateHostDockerGeneration {
			*order = append(*order, "inspect")
			return []byte(inspect), nil
		}
		*order = append(*order, "config")
		return []byte(live), nil
	}
}

func TestPositiveHostIngressEvidenceBracketsBothTLSReadyProbes(t *testing.T) {
	var order []string
	roots := x509.NewCertPool()
	ctx := context.Background()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	result, err := privateObserveEnabledIngressWith(ctx,
		privateHostEnabledTargets{domain: "photos.example.test", lanIPv4: "192.168.2.4", lanRoots: roots},
		privatePositiveTestRunner(&order),
		func(_ context.Context, fqdn string) (localTLSReadyEvidence, error) {
			order = append(order, "domain-tls")
			if fqdn != "photos.example.test" {
				t.Fatal("wrong FQDN")
			}
			return localTLSReadyEvidence{digest: strings.Repeat("c", 64)}, nil
		},
		func(_ context.Context, ip string, ca *x509.CertPool) (localTLSReadyEvidence, error) {
			order = append(order, "lan-tls")
			if ip != "192.168.2.4" || ca != roots {
				t.Fatal("wrong LAN IP/trust root")
			}
			return localTLSReadyEvidence{digest: strings.Repeat("d", 64)}, nil
		}, now)
	if err != nil || !validDigest(result.runtime.instanceSHA) ||
		!validDigest(result.runtime.generationSHA) ||
		result.domainDigest != strings.Repeat("c", 64) || result.lanDigest != strings.Repeat("d", 64) {
		t.Fatalf("valid local positive evidence rejected: %v", err)
	}
	if got := strings.Join(order, ","); got != "inspect,config,domain-tls,lan-tls,inspect,config" {
		t.Fatalf("positive proofs escaped stable Host window: %s", got)
	}
	encoded, err := json.Marshal(result)
	if err != nil || string(encoded) != "{}" {
		t.Fatal("raw Host identity/addresses escaped public JSON")
	}
}

func TestPositiveHostIngressMissingIsNeverNegativeEvidence(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	for _, test := range []struct {
		name                string
		targets             privateHostEnabledTargets
		wantDomain, wantLAN bool
	}{
		{"domain only", privateHostEnabledTargets{domain: "photos.example.test"}, true, false},
		{"LAN only", privateHostEnabledTargets{lanIPv4: "192.168.2.4", lanRoots: x509.NewCertPool()}, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var order []string
			got, err := privateObserveEnabledIngressWith(ctx, test.targets, privatePositiveTestRunner(&order),
				func(context.Context, string) (localTLSReadyEvidence, error) {
					return localTLSReadyEvidence{strings.Repeat("c", 64)}, nil
				},
				func(context.Context, string, *x509.CertPool) (localTLSReadyEvidence, error) {
					return localTLSReadyEvidence{strings.Repeat("d", 64)}, nil
				}, now)
			if err != nil || (got.domainDigest != "") != test.wantDomain || (got.lanDigest != "") != test.wantLAN {
				t.Fatalf("absent positive proof was upgraded to negative: %v", err)
			}
		})
	}
}

func TestPositiveHostIngressFailClosedOnUntrustedInputAndFailedTLS(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	var order []string
	goodDomain := func(context.Context, string) (localTLSReadyEvidence, error) {
		return localTLSReadyEvidence{digest: strings.Repeat("c", 64)}, nil
	}
	goodLAN := func(context.Context, string, *x509.CertPool) (localTLSReadyEvidence, error) {
		return localTLSReadyEvidence{digest: strings.Repeat("d", 64)}, nil
	}
	for _, bad := range []privateHostEnabledTargets{
		{}, {domain: "https://photos.example.test"}, {lanIPv4: "8.8.8.8", lanRoots: x509.NewCertPool()},
		{lanIPv4: "192.168.2.4"}, {domain: "photos.example.test", lanRoots: x509.NewCertPool()},
	} {
		if _, err := privateObserveEnabledIngressWith(ctx, bad, privatePositiveTestRunner(&order), goodDomain, goodLAN, now); err == nil {
			t.Fatal("untrusted or both-off Host targets admitted")
		}
	}
	if len(order) != 0 {
		t.Fatal("read Docker before validating Host-only targets")
	}
	for _, test := range []struct {
		name   string
		domain privateDomainReadyProbe
	}{
		{"no proof", nil},
		{"bad SHA", func(context.Context, string) (localTLSReadyEvidence, error) {
			return localTLSReadyEvidence{digest: "success"}, nil
		}},
		{"TLS error", func(context.Context, string) (localTLSReadyEvidence, error) {
			return localTLSReadyEvidence{}, errors.New("certificate mismatch")
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			order = nil
			if _, err := privateObserveEnabledIngressWith(ctx, privateHostEnabledTargets{domain: "photos.example.test"},
				privatePositiveTestRunner(&order), test.domain, goodLAN, now); err == nil {
				t.Fatal("unsigned/untrusted TLS accepted")
			}
		})
	}
	order = nil
	if _, err := privateObserveEnabledIngressWith(ctx, privateHostEnabledTargets{domain: "photos.example.test", lanIPv4: "192.168.2.4", lanRoots: x509.NewCertPool()},
		privatePositiveTestRunner(&order), goodDomain,
		func(context.Context, string, *x509.CertPool) (localTLSReadyEvidence, error) {
			return localTLSReadyEvidence{}, errors.New("bad LAN SAN")
		}, now); err == nil {
		t.Fatal("partial two-entry success was accepted")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := privateObserveEnabledIngressWith(cancelled, privateHostEnabledTargets{domain: "photos.example.test"},
		privatePositiveTestRunner(&order), goodDomain, goodLAN, now); err == nil {
		t.Fatal("canceled positive observation admitted")
	}
}

func TestPositiveHostIngressDetectsCaddyReloadAcrossProbe(t *testing.T) {
	inspect, live := fixture()
	calls := 0
	runner := func(_ context.Context, kind privateHostSampleKind) ([]byte, error) {
		calls++
		if kind == privateHostDockerGeneration {
			return []byte(inspect), nil
		}
		if calls > 2 {
			return []byte(strings.Repeat("e", 64) + "  -\n"), nil
		}
		return []byte(live), nil
	}
	got, err := privateObserveEnabledIngressWith(context.Background(), privateHostEnabledTargets{domain: "photos.example.test"}, runner,
		func(context.Context, string) (localTLSReadyEvidence, error) {
			return localTLSReadyEvidence{digest: strings.Repeat("c", 64)}, nil
		}, nil,
		time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC))
	if err == nil || got != (privateHostPositiveOnly{}) {
		t.Fatal("Caddy reload accepted as stable positive proof")
	}
}
