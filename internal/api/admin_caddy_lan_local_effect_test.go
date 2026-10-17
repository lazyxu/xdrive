package api

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestCaddyLANLocalEffectStateRequiresExactRuntimeIPAndHealthyGeneration(t *testing.T) {
	ip := "192.168.2.4"
	hash := sha256.Sum256([]byte(ip))
	valid := caddyHostStatus{
		State: "healthy", LANHTTPSConfigured: true,
		LANTLSState: "verified", LANVerifiedIPSHA256: hex.EncodeToString(hash[:]),
	}
	if got := caddyLANLocalEffectState(valid, true, ip); got != "verified" {
		t.Fatalf("genuine matching local SAN proof ignored: %q", got)
	}
	for _, tc := range []struct {
		name string
		host caddyHostStatus
		observed bool
		ip string
		want string
	}{
		{"stale-unobserved", valid, false, ip, "unknown"},
		{"mismatched-IP", valid, true, "192.168.2.5", "unavailable"},
		{"public-IP", valid, true, "8.8.8.8", "unknown"},
		{"not-healthy", caddyHostStatus{State: "stopped", LANHTTPSConfigured: true, LANTLSState: "verified", LANVerifiedIPSHA256: valid.LANVerifiedIPSHA256}, true, ip, "unavailable"},
		{"unsupported-old-host", caddyHostStatus{State: "healthy"}, true, ip, "unavailable"},
		{"explicit-failed", caddyHostStatus{State: "healthy", LANHTTPSConfigured: true, LANTLSState: "failed"}, true, ip, "failed"},
		{"no-host-identity", caddyHostStatus{State: "healthy", LANTLSState: "disabled"}, true, "", "disabled"},
	} {
		if got := caddyLANLocalEffectState(tc.host, tc.observed, tc.ip); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
