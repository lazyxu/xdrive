package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestCaddyAdoptionEvidenceNeverDerivesRunningIdentityFromSavedTarget(t *testing.T) {
	const domain = "drive.example.com"
	const lan = "192.168.10.12"
	domainSHA := sha256.Sum256([]byte(domain))
	lanSHA := sha256.Sum256([]byte(lan))
	snapshot := caddyPreflightSnapshot{
		Desired: adminCaddyHTTPSDesired{
			Revision: 4, Source: "saved", Enabled: true, Domain: domain,
			LANEnabled: true, LANIP: lan,
		},
	}
	host := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true,
		TLSCheckSupported: true, TLSState: "verified",
		TLSVerifiedDomainSHA256: hex.EncodeToString(domainSHA[:]),
		RuntimeTLSAlignment:     "matched-local",
		LiveConfigSHA256:        strings.Repeat("b", 64),
		InstanceGenerationState: "same-instance-local",
		LANHTTPSConfigured:      true, LANTLSState: "verified",
		LANVerifiedIPSHA256: hex.EncodeToString(lanSHA[:]),
	}
	cases := []struct {
		name            string
		snapshot        caddyPreflightSnapshot
		host            caddyHostStatus
		observed        bool
		pending         bool
		lanIP           string
		expectedBlocker string
	}{
		{"dual local matched is not independent identity", snapshot, host, true, false, lan, "independent-running-identity-unavailable"},
		{"host reservation blocks", snapshot, host, true, true, lan, "host-pending"},
		{"missing observer blocks", snapshot, host, false, false, lan, "trusted-host-not-healthy"},
		{"old manager generation missing", snapshot, func() caddyHostStatus { h := host; h.InstanceGenerationState = ""; return h }(), true, false, lan, "same-host-generation-unverified"},
		{"no live config", snapshot, func() caddyHostStatus { h := host; h.LiveConfigSHA256 = ""; return h }(), true, false, lan, "running-caddy-config-unverified"},
		{"domain digest mismatches", snapshot, func() caddyHostStatus { h := host; h.TLSVerifiedDomainSHA256 = strings.Repeat("c", 64); return h }(), true, false, lan, "domain-local-tls-unmatched"},
		{"LAN IP digest mismatches", snapshot, host, true, false, "192.168.10.13", "lan-local-tls-unmatched"},
		{"legacy revision zero", func() caddyPreflightSnapshot {
			s := snapshot
			s.Desired.Revision = 0
			s.Desired.Source = "default"
			return s
		}(), host, true, false, lan, "saved-revision-unavailable"},
		{"domain off is not negative proof", func() caddyPreflightSnapshot {
			s := snapshot
			s.Desired.Enabled = false
			s.Desired.Domain = ""
			return s
		}(), host, true, false, lan, "domain-disabled-not-attested"},
		{"LAN off is not negative proof", func() caddyPreflightSnapshot {
			s := snapshot
			s.Desired.LANEnabled = false
			s.Desired.LANIP = ""
			return s
		}(), host, true, false, lan, "lan-disabled-not-attested"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := buildCaddyAdoptionEvidence(tc.snapshot, tc.host, tc.observed, tc.pending, tc.lanIP)
			if ev.CanAdopt || ev.ApplySupported || ev.CandidateComplete ||
				!ev.SnapshotStable || ev.Protocol != caddyAdoptionEvidenceProtocol ||
				!slices.Contains(ev.Blockers, tc.expectedBlocker) ||
				!slices.Contains(ev.Blockers, "independent-running-identity-unavailable") {
				t.Fatalf("untrusted identity could authorize adoption: %+v", ev)
			}
			raw, err := json.Marshal(ev)
			if err != nil {
				t.Fatal(err)
			}
			for _, secret := range []string{
				domain, lan, tc.lanIP, hex.EncodeToString(domainSHA[:]),
				hex.EncodeToString(lanSHA[:]), strings.Repeat("b", 64),
				"ALIYUN_ACCESS_KEY_SECRET", "host-control", "docker.sock",
			} {
				if secret != "" && bytes.Contains(raw, []byte(secret)) {
					t.Fatalf("identity/secret leaked in candidate DTO: %q", raw)
				}
			}
		})
	}
}
