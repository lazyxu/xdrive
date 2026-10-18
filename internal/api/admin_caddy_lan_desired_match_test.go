package api

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestCaddyDesiredLANLocalMatchAndContinuityNeverGrantHostApply(t *testing.T) {
	const deployedIP = "192.168.2.4"
	sum := sha256.Sum256([]byte(deployedIP))
	verified := caddyHostStatus{
		State: "healthy", LANHTTPSConfigured: true, LANTLSState: "verified",
		LANVerifiedIPSHA256: hex.EncodeToString(sum[:]),
	}
	enabled := adminCaddyHTTPSDesired{Revision: 5, LANEnabled: true, LANIP: deployedIP}
	changed := adminCaddyHTTPSDesired{Revision: 5, LANEnabled: true, LANIP: "192.168.2.5"}
	disabled := adminCaddyHTTPSDesired{Revision: 5, Enabled: true, Domain: "photos.example.com"}
	tests := []struct {
		name       string
		desired    adminCaddyHTTPSDesired
		host       caddyHostStatus
		observed   bool
		deployedIP string
		wantMatch  string
		wantRisk   string
	}{
		{"match is local observation only", enabled, verified, true, deployedIP, "matched-local", "unverified"},
		{"different desired private IP", changed, verified, true, deployedIP, "mismatch-local", "local-lan-switch"},
		{"saved LAN disable but live IP is verified", disabled, verified, true, deployedIP, "mismatch-local", "local-lan-removal"},
		{"unmanaged initial default", adminCaddyHTTPSDesired{LANEnabled: true, LANIP: deployedIP}, verified, true, deployedIP, "unverified", "unverified"},
		{"stale heartbeat", enabled, verified, false, deployedIP, "unverified", "unverified"},
		{"no Server bound LAN identity", enabled, verified, true, "", "unverified", "unverified"},
		{"wrong Server LAN identity", enabled, verified, true, "192.168.2.5", "unverified", "unverified"},
		{"old host without LAN probe", enabled, caddyHostStatus{State: "healthy"}, true, deployedIP, "unverified", "unverified"},
		{"failed local IP TLS", enabled, caddyHostStatus{State: "healthy", LANHTTPSConfigured: true, LANTLSState: "failed"}, true, deployedIP, "unverified", "unverified"},
		{"stopped fixed Caddy", enabled, caddyHostStatus{State: "stopped", LANHTTPSConfigured: true, LANTLSState: "verified", LANVerifiedIPSHA256: verified.LANVerifiedIPSHA256}, true, deployedIP, "unverified", "unverified"},
		{"malformed host proof", enabled, caddyHostStatus{State: "healthy", LANHTTPSConfigured: true, LANTLSState: "verified", LANVerifiedIPSHA256: "bad"}, true, deployedIP, "unverified", "unverified"},
		{"invalid desired LAN IP", adminCaddyHTTPSDesired{Revision: 5, LANEnabled: true, LANIP: "8.8.8.8"}, verified, true, deployedIP, "unverified", "unverified"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := caddyDesiredLANLocalMatch(tc.desired, tc.host, tc.observed, tc.deployedIP); got != tc.wantMatch {
				t.Fatalf("LAN local match = %q, want %q", got, tc.wantMatch)
			}
			if got := caddyIngressChangeRiskDual(tc.desired, tc.host, tc.observed, tc.deployedIP); got != tc.wantRisk {
				t.Fatalf("LAN continuity risk = %q, want %q", got, tc.wantRisk)
			}
		})
	}
}

func TestCaddyLANContinuityKeepsVerifiedDomainRemovalWarning(t *testing.T) {
	domainSum := sha256.Sum256([]byte("old.example.com"))
	ipSum := sha256.Sum256([]byte("192.168.2.4"))
	host := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState: "verified", TLSVerifiedDomainSHA256: hex.EncodeToString(domainSum[:]),
		LANHTTPSConfigured: true, LANTLSState: "verified", LANVerifiedIPSHA256: hex.EncodeToString(ipSum[:]),
	}
	desired := adminCaddyHTTPSDesired{Revision: 7, LANEnabled: true, LANIP: "192.168.2.4"}
	if got := caddyIngressChangeRiskDual(desired, host, true, "192.168.2.4"); got != "local-https-removal" {
		t.Fatalf("removing a proven domain while retaining LAN must not hide removal risk: %q", got)
	}
}
