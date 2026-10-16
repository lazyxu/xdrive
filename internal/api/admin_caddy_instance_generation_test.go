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
	}
	cases := []struct {
		name     string
		mutate   func(*caddyHostStatus)
		accepted bool
		want     string
	}{
		{"same fixed generation", func(*caddyHostStatus) {}, true, "same-instance-local"},
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
