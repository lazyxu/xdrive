package api

import (
	"crypto/sha256"
	"fmt"
	"testing"
)

func TestCaddyIngressChangeRiskRemainsReadOnlyAndFailClosed(t *testing.T) {
	sum := sha256.Sum256([]byte("old.example.com"))
	verified := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState: "verified", TLSVerifiedDomainSHA256: fmt.Sprintf("%x", sum),
	}
	matched := adminCaddyHTTPSDesired{Revision: 2, Enabled: true, Domain: "old.example.com"}
	changed := adminCaddyHTTPSDesired{Revision: 2, Enabled: true, Domain: "new.example.com"}
	disabled := adminCaddyHTTPSDesired{Revision: 3, Enabled: false}
	cases := []struct {
		name     string
		desired  adminCaddyHTTPSDesired
		host     caddyHostStatus
		observed bool
		want     string
	}{
		{"verified local TLS removed", disabled, verified, true, "local-https-removal"},
		{"verified local TLS changes SNI", changed, verified, true, "local-domain-switch"},
		{"matched SNI is not a safety guarantee", matched, verified, true, "unverified"},
		{"unset desired", adminCaddyHTTPSDesired{}, verified, true, "unverified"},
		{"missing host heartbeat", disabled, verified, false, "unverified"},
		{"old host no TLS verification", disabled, caddyHostStatus{State: "healthy", HTTPSConfigured: true}, true, "unverified"},
		{"failed TLS handshake", disabled, caddyHostStatus{State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true, TLSState: "failed"}, true, "unverified"},
		{"missing SNI digest", changed, caddyHostStatus{State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true, TLSState: "verified"}, true, "unverified"},
		{"invalid SNI digest", changed, caddyHostStatus{State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true, TLSState: "verified", TLSVerifiedDomainSHA256: "bad"}, true, "unverified"},
		{"missing valid desired hostname", adminCaddyHTTPSDesired{Revision: 2, Enabled: true, Domain: "bad/domain"}, verified, true, "unverified"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := caddyIngressChangeRisk(tt.desired, tt.host, tt.observed); got != tt.want {
				t.Fatalf("risk got %q, want %q", got, tt.want)
			}
		})
	}
}
