package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCaddyHostObservedTLSHostnameDigestFailsClosed(t *testing.T) {
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	heartbeat := filepath.Join(dir, "heartbeat")
	status := filepath.Join(dir, caddyHostStatusName)
	if err := os.WriteFile(heartbeat, []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	sha := sha256.Sum256([]byte("photos.example.com"))
	valid := hex.EncodeToString(sha[:])
	write := func(state caddyHostStatus) {
		t.Helper()
		raw, err := json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(status, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	base := caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true,
		TLSState: "verified", TLSVerifiedDomainSHA256: valid,
	}
	write(base)
	if got, ok := server.readCaddyHostStatus(); !ok || got.TLSVerifiedDomainSHA256 != valid {
		t.Fatalf("valid local-only observed hash lost: %+v, ok=%t", got, ok)
	}
	old := base
	old.TLSVerifiedDomainSHA256 = ""
	write(old)
	if got, ok := server.readCaddyHostStatus(); !ok || got.TLSVerifiedDomainSHA256 != "" {
		t.Fatalf("old host should remain observable but without positive hostname proof: %+v, %t", got, ok)
	}
	cases := map[string]func(*caddyHostStatus){
		"invalid hex":                 func(s *caddyHostStatus) { s.TLSVerifiedDomainSHA256 = strings.Repeat("z", 64) },
		"uppercase hex":               func(s *caddyHostStatus) { s.TLSVerifiedDomainSHA256 = strings.ToUpper(valid) },
		"truncated digest":            func(s *caddyHostStatus) { s.TLSVerifiedDomainSHA256 = valid[:60] },
		"unverified TLS with digest":  func(s *caddyHostStatus) { s.TLSState = "failed" },
		"unavailable TLS with digest": func(s *caddyHostStatus) { s.TLSState = "unavailable" },
		"old host without TLS support with digest": func(s *caddyHostStatus) {
			s.TLSCheckSupported = false
			s.TLSState = ""
		},
		"host unhealthy with digest": func(s *caddyHostStatus) { s.State = "unhealthy" },
		"HTTPS disabled with digest": func(s *caddyHostStatus) {
			s.HTTPSConfigured = false
			s.TLSState = "disabled"
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			value := base
			mutate(&value)
			write(value)
			if got, ok := server.readCaddyHostStatus(); ok {
				t.Fatalf("inconsistent host TLS SNI evidence should not be trusted: %+v", got)
			}
		})
	}
}
