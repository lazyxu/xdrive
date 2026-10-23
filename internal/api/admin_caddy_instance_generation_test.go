package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyInstanceGenerationFailsClosed(t *testing.T) {
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	statusFile := filepath.Join(dir, caddyHostStatusName)
	heartbeat := filepath.Join(dir, "heartbeat")
	if err := os.WriteFile(heartbeat, []byte("live"), 0600); err != nil {
		t.Fatal(err)
	}
	baseline := caddyHostStatus{
		State:                   "healthy",
		HTTPSConfigured:         true,
		TLSCheckSupported:       true,
		TLSState:                "verified",
		TLSVerifiedDomainSHA256: strings.Repeat("a", 64),
		RuntimeTLSAlignment:     "matched-local",
		LiveConfigSHA256:        strings.Repeat("b", 64),
		InstanceGenerationState: "same-instance-local",
		AliDNSModuleState:       "present-local",
	}
	cases := []struct {
		name     string
		mutate   func(*caddyHostStatus)
		accepted bool
		want     string
	}{
		{"same fixed generation", func(*caddyHostStatus) {}, true, "same-instance-local"},
		{"optional module absent on healthy host", func(s *caddyHostStatus) {
			s.AliDNSModuleState = "absent-local"
		}, true, "same-instance-local"},
		{"optional module unknown is neutral", func(s *caddyHostStatus) {
			s.AliDNSModuleState = "unverified"
		}, true, "same-instance-local"},
		{"old Host Manager missing module result", func(s *caddyHostStatus) {
			s.AliDNSModuleState = ""
		}, true, "same-instance-local"},
		{"forged module apply result", func(s *caddyHostStatus) {
			s.AliDNSModuleState = "applied"
		}, false, "unverified"},
		{"old Host Manager omits field", func(s *caddyHostStatus) {
			s.InstanceGenerationState = ""
		}, true, "unverified"},
		{"unverified with no positive evidence", func(s *caddyHostStatus) {
			s.InstanceGenerationState = "unverified"
			s.TLSState = "unavailable"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
			s.LiveConfigSHA256 = ""
		}, true, "unverified"},
		{"fake apply receipt", func(s *caddyHostStatus) {
			s.InstanceGenerationState = "applied"
		}, false, "unverified"},
		{"positive but bad TLS", func(s *caddyHostStatus) {
			s.TLSState = "failed"
		}, false, "unverified"},
		{"positive but no verified SNI fingerprint", func(s *caddyHostStatus) {
			s.TLSVerifiedDomainSHA256 = ""
		}, false, "unverified"},
		{"positive from stopped container", func(s *caddyHostStatus) {
			s.State = "stopped"
			s.TLSState = "unavailable"
		}, false, "unverified"},
		{"unverified while carrying old positive TLS", func(s *caddyHostStatus) {
			s.InstanceGenerationState = "unverified"
		}, false, "unverified"},
		{"unverified while carrying active config hash", func(s *caddyHostStatus) {
			s.InstanceGenerationState = "unverified"
			s.TLSState = "unavailable"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
		}, false, "unverified"},
		{"different startup domain still same generation", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "mismatch-local"
		}, true, "same-instance-local"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			host := baseline
			tc.mutate(&host)
			raw, err := json.Marshal(host)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statusFile, raw, 0600); err != nil {
				t.Fatal(err)
			}
			got, observed := server.readCaddyHostStatus()
			if observed != tc.accepted {
				t.Fatalf("accepted = %v, expected %v", observed, tc.accepted)
			}
			if observed && got.AliDNSModuleState == "present-local" &&
				caddyObservedAliDNSModuleState(got, observed) != "present-local" {
				t.Fatal("valid module result missing")
			}
			if state := caddyObservedInstanceGeneration(got, observed); state != tc.want {
				t.Fatalf("generation state = %q, want %q", state, tc.want)
			}
		})
	}
	raw, err := json.Marshal(baseline)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statusFile, raw, 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(statusFile, old, old); err != nil {
		t.Fatal(err)
	}
	if status, observed := server.readCaddyHostStatus(); observed ||
		caddyObservedInstanceGeneration(status, observed) != "unverified" {
		t.Fatal("old Caddy status must never prove a current container generation")
	}
}

func TestCaddyLocalGenerationWitnessRequiresCoherentPositiveWindow(t *testing.T) {
	dir := t.TempDir()
	heartbeat := filepath.Join(dir, "heartbeat")
	statusFile := filepath.Join(dir, caddyHostStatusName)
	if err := os.WriteFile(heartbeat, []byte("live"), 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir}
	positive := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState: "verified", TLSVerifiedDomainSHA256: strings.Repeat("a", 64),
		RuntimeTLSAlignment: "matched-local", LiveConfigSHA256: strings.Repeat("b", 64),
		InstanceGenerationState:   "same-instance-local",
		HostLocalGenerationSHA256: strings.Repeat("c", 64),
		HostLocalLiveConfigSHA256: strings.Repeat("b", 64),
	}
	tests := []struct {
		name   string
		change func(*caddyHostStatus)
		want   bool
	}{
		{"domain positive", func(*caddyHostStatus) {}, true},
		{"both entries verified", func(s *caddyHostStatus) {
			s.LANHTTPSConfigured = true
			s.LANTLSState = "verified"
			s.LANVerifiedIPSHA256 = strings.Repeat("d", 64)
		}, true},
		{"both on but LAN failed", func(s *caddyHostStatus) {
			s.LANHTTPSConfigured = true
			s.LANTLSState = "failed"
		}, false},
		{"generation missing", func(s *caddyHostStatus) {
			s.HostLocalGenerationSHA256 = ""
		}, false},
		{"live digest missing", func(s *caddyHostStatus) {
			s.HostLocalLiveConfigSHA256 = ""
		}, false},
		{"malformed generation digest", func(s *caddyHostStatus) {
			s.HostLocalGenerationSHA256 = strings.Repeat("G", 64)
		}, false},
		{"empty Caddy config", func(s *caddyHostStatus) {
			s.HostLocalLiveConfigSHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
			s.LiveConfigSHA256 = s.HostLocalLiveConfigSHA256
		}, false},
		{"in-place configuration mismatch", func(s *caddyHostStatus) {
			s.HostLocalLiveConfigSHA256 = strings.Repeat("e", 64)
		}, false},
		{"not the configured Caddy startup domain", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "mismatch-local"
		}, false},
		{"unverified process generation", func(s *caddyHostStatus) {
			s.InstanceGenerationState = "unverified"
			s.TLSState = "unavailable"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
			s.LiveConfigSHA256 = ""
		}, false},
		{"unhealthy gateway", func(s *caddyHostStatus) {
			s.State = "unhealthy"
			s.TLSState = "unavailable"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
			s.LiveConfigSHA256 = ""
			s.InstanceGenerationState = "unverified"
		}, false},
		{"LAN-only positive", func(s *caddyHostStatus) {
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
			s.LiveConfigSHA256 = ""
			s.InstanceGenerationState = "unverified"
			s.LANHTTPSConfigured = true
			s.LANTLSState = "verified"
			s.LANVerifiedIPSHA256 = strings.Repeat("d", 64)
		}, true},
		{"LAN-only without CA/IP SAN", func(s *caddyHostStatus) {
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
			s.TLSVerifiedDomainSHA256 = ""
			s.RuntimeTLSAlignment = "unverified"
			s.LiveConfigSHA256 = ""
			s.InstanceGenerationState = "unverified"
			s.LANHTTPSConfigured = true
			s.LANTLSState = "unavailable"
		}, false},
		{"old Host with no witness stays readable but unproved", func(s *caddyHostStatus) {
			s.HostLocalGenerationSHA256 = ""
			s.HostLocalLiveConfigSHA256 = ""
		}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status := positive
			tc.change(&status)
			raw, err := json.Marshal(status)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statusFile, raw, 0600); err != nil {
				t.Fatal(err)
			}
			result, accepted := server.readCaddyHostStatus()
			if accepted != tc.want {
				t.Fatalf("accepted = %v, want %v for %+v", accepted, tc.want, status)
			}
			if accepted && tc.name == "domain positive" {
				if result.HostLocalGenerationSHA256 != strings.Repeat("c", 64) ||
					result.HostLocalLiveConfigSHA256 != strings.Repeat("b", 64) {
					t.Fatal("valid Host-private runtime digest pair was lost")
				}
				// Only a public service-status projection, never raw Host
				// digests or an Applied Receipt, may reach the administrator.
				service := caddyStatusFromAdmin(t, server)
				public, _ := json.Marshal(service)
				if strings.Contains(string(public), strings.Repeat("c", 64)) ||
					strings.Contains(string(public), "host_local_generation") {
					t.Fatal("Host-local runtime witness leaked into public service status")
				}
			}
		})
	}
}
