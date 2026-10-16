package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyRuntimeTLSAlignmentReadOnlyFailClosed(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	statusPath := filepath.Join(dir, caddyHostStatusName)
	heartbeatPath := filepath.Join(dir, "heartbeat")
	if err := os.WriteFile(heartbeatPath, []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	normal := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState: "verified", TLSVerifiedDomainSHA256: strings.Repeat("a", 64),
	}
	cases := []struct {
		name   string
		change func(*caddyHostStatus)
		valid  bool
		want   string
	}{
		{"old host", func(*caddyHostStatus) {}, true, "unverified"},
		{"positive match", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "matched-local" }, true, "matched-local"},
		{"positive mismatch", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "mismatch-local" }, true, "mismatch-local"},
		{"explicit unknown", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "unverified" }, true, "unverified"},
		{"forged applied", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "applied" }, false, "unverified"},
		{"invalid uppercase", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "MATCHED-LOCAL" }, false, "unverified"},
		{"positive without TLS digest", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "matched-local"; s.TLSVerifiedDomainSHA256 = "" }, false, "unverified"},
		{"positive with failed TLS", func(s *caddyHostStatus) { s.RuntimeTLSAlignment = "matched-local"; s.TLSState = "failed" }, false, "unverified"},
		{"positive with stopped container", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "matched-local"
			s.State = "stopped"
			s.TLSState = "unavailable"
		}, false, "unverified"},
		{"positive without configured HTTPS", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "matched-local"
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
		}, false, "unverified"},
		{"positive without TLS capability", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "matched-local"
			s.TLSCheckSupported = false
			s.TLSState = ""
		}, false, "unverified"},
		{"unverified with disabled TLS", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "unverified"
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
			s.TLSVerifiedDomainSHA256 = ""
		}, true, "unverified"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := normal
			tc.change(&status)
			raw, err := json.Marshal(status)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statusPath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			got, observed := s.readCaddyHostStatus()
			if observed != tc.valid {
				t.Fatalf("unexpected host status validity: observed=%v expected=%v", observed, tc.valid)
			}
			if alignment := caddyObservedRuntimeTLSAlignment(got, observed); alignment != tc.want {
				t.Fatalf("alignment = %q, want %q", alignment, tc.want)
			}
		})
	}
	// Freshness remains part of the evidence contract.
	valid := normal
	valid.RuntimeTLSAlignment = "matched-local"
	raw, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statusPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(heartbeatPath, old, old); err != nil {
		t.Fatal(err)
	}
	if status, observed := s.readCaddyHostStatus(); observed ||
		caddyObservedRuntimeTLSAlignment(status, observed) != "unverified" {
		t.Fatalf("stale heartbeat gave false runtime-domain evidence")
	}
}

// Only a fixed healthy HTTPS Caddy with verified local TLS may attach a
// sanitized digest from the in-container admin API. Missing/old evidence stays
// neutral; no digest ever appears in the administrator DTO.
func TestCaddyLiveConfigObservationRequiresTrustedCurrentTLS(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	statusPath := filepath.Join(dir, caddyHostStatusName)
	heartbeatPath := filepath.Join(dir, "heartbeat")
	if err := os.WriteFile(heartbeatPath, []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	normal := caddyHostStatus{
		State:                   "healthy",
		HTTPSConfigured:         true,
		TLSCheckSupported:       true,
		TLSState:                "verified",
		TLSVerifiedDomainSHA256: strings.Repeat("a", 64),
		LiveConfigSHA256:        strings.Repeat("b", 64),
	}
	cases := []struct {
		name   string
		change func(*caddyHostStatus)
		valid  bool
		want   string
	}{
		{"positive fixed live config", func(*caddyHostStatus) {}, true, "observed-local"},
		{"missing old host", func(s *caddyHostStatus) {
			s.LiveConfigSHA256 = ""
		}, true, "unverified"},
		{"bad fingerprint", func(s *caddyHostStatus) {
			s.LiveConfigSHA256 = "bogus"
		}, false, "unverified"},
		{"empty response fingerprint", func(s *caddyHostStatus) {
			s.LiveConfigSHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		}, false, "unverified"},
		{"no TLS chain validation", func(s *caddyHostStatus) {
			s.TLSState = "failed"
		}, false, "unverified"},
		{"no authenticated SNI fingerprint", func(s *caddyHostStatus) {
			s.TLSVerifiedDomainSHA256 = ""
		}, false, "unverified"},
		{"stopped fixed container", func(s *caddyHostStatus) {
			s.State = "stopped"
			s.TLSState = "unavailable"
		}, false, "unverified"},
		{"HTTP only", func(s *caddyHostStatus) {
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
			s.TLSVerifiedDomainSHA256 = ""
		}, false, "unverified"},
		{"startup env drift is independent", func(s *caddyHostStatus) {
			s.RuntimeTLSAlignment = "mismatch-local"
		}, true, "observed-local"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := normal
			tc.change(&status)
			raw, err := json.Marshal(status)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(statusPath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			got, observed := s.readCaddyHostStatus()
			if observed != tc.valid {
				t.Fatalf("observed=%v, expected %v", observed, tc.valid)
			}
			if state := caddyObservedLiveConfigState(got, observed); state != tc.want {
				t.Fatalf("active config state=%q, expected %q", state, tc.want)
			}
		})
	}
	// A valid payload with stale heartbeat can never turn into a positive.
	raw, err := json.Marshal(normal)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statusPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(heartbeatPath, old, old); err != nil {
		t.Fatal(err)
	}
	status, observed := s.readCaddyHostStatus()
	if observed || caddyObservedLiveConfigState(status, observed) != "unverified" {
		t.Fatal("stale Caddy heartbeat permitted active-config proof")
	}
}
