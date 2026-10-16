package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func testCaddyLocalVerifiedDomainDigest(domain string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(domain)))
	return hex.EncodeToString(sum[:])
}

func TestCaddyDesiredDomainLocalMatchIsNotHostApplyProof(t *testing.T) {
	desired := adminCaddyHTTPSDesired{
		Revision: 7, Enabled: true, Domain: "photos.example.com",
	}
	host := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState:                "verified",
		TLSVerifiedDomainSHA256: testCaddyLocalVerifiedDomainDigest("photos.example.com"),
	}
	if got := caddyDesiredDomainLocalMatch(desired, host, true); got != "matched-local" {
		t.Fatalf("matching locally verified SNI rejected: %q", got)
	}
	host.TLSVerifiedDomainSHA256 = testCaddyLocalVerifiedDomainDigest("other.example.com")
	if got := caddyDesiredDomainLocalMatch(desired, host, true); got != "mismatch-local" {
		t.Fatalf("different locally verified domain was not detected: %q", got)
	}
}

func TestCaddyDesiredDomainComparisonFailsClosedOnAbsentOrOldProof(t *testing.T) {
	desired := adminCaddyHTTPSDesired{
		Revision: 7, Enabled: true, Domain: "photos.example.com",
	}
	verified := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState:                "verified",
		TLSVerifiedDomainSHA256: testCaddyLocalVerifiedDomainDigest("photos.example.com"),
	}
	tests := map[string]func(*adminCaddyHTTPSDesired, *caddyHostStatus, *bool){
		"unmanaged":           func(d *adminCaddyHTTPSDesired, _ *caddyHostStatus, _ *bool) { d.Revision = 0 },
		"disable":             func(d *adminCaddyHTTPSDesired, _ *caddyHostStatus, _ *bool) { d.Enabled = false },
		"empty domain":        func(d *adminCaddyHTTPSDesired, _ *caddyHostStatus, _ *bool) { d.Domain = "" },
		"invalid domain":      func(d *adminCaddyHTTPSDesired, _ *caddyHostStatus, _ *bool) { d.Domain = "https://example.com" },
		"stale host":          func(_ *adminCaddyHTTPSDesired, _ *caddyHostStatus, observed *bool) { *observed = false },
		"host unhealthy":      func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.State = "unhealthy" },
		"host stopped":        func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.State = "stopped" },
		"old host no digest":  func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.TLSVerifiedDomainSHA256 = "" },
		"wrong digest length": func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.TLSVerifiedDomainSHA256 = "abcd" },
		"uppercase digest": func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) {
			h.TLSVerifiedDomainSHA256 = strings.ToUpper(h.TLSVerifiedDomainSHA256)
		},
		"no TLS support": func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.TLSCheckSupported = false },
		"failed TLS":     func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.TLSState = "failed" },
		"no HTTPS":       func(_ *adminCaddyHTTPSDesired, h *caddyHostStatus, _ *bool) { h.HTTPSConfigured = false },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			d := desired
			h := verified
			observed := true
			change(&d, &h, &observed)
			if got := caddyDesiredDomainLocalMatch(d, h, observed); got != "unverified" {
				t.Fatalf("missing or untrusted SNI evidence claimed match: %q", got)
			}
		})
	}
}
