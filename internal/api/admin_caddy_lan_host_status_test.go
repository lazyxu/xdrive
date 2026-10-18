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

func TestCaddyIPOnlyStatusRequiresLocalCAAndIPSANProof(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XD_LAN_HTTPS_IP", "192.168.2.4")
	s := &Server{HostControlDir: dir}
	hash := sha256.Sum256([]byte("192.168.2.4"))
	good := caddyHostStatus{
		State: "healthy", TLSCheckSupported: true, TLSState: "disabled",
		LANHTTPSConfigured: true, LANTLSState: "verified",
		LANVerifiedIPSHA256: hex.EncodeToString(hash[:]),
	}
	write := func(status caddyHostStatus) {
		t.Helper()
		payload, err := json.Marshal(status)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, caddyHostStatusName), payload, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("ok"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(good)
	// Host claims LAN HTTPS but Server lacks its bound deployment identity.
	// This case must remain unknown, never ordinary HTTP green.
	t.Setenv("XD_LAN_HTTPS_IP", "")
	if got := caddyStatusFromAdmin(t, s); got.Status == "ready" {
		t.Fatalf("undeclared private IP listener falsely ready: %+v", got)
	}
	t.Setenv("XD_LAN_HTTPS_IP", "192.168.2.4")
	if _, observed := s.readCaddyHostStatus(); !observed {
		t.Fatal("valid host IP-SAN status was rejected")
	}
	ready := caddyStatusFromAdmin(t, s)
	if ready.Status != "ready" || !strings.Contains(ready.Detail, "私网 IP HTTPS") ||
		!strings.Contains(ready.Detail, "终端 CA 信任") ||
		ready.HTTPSConfigured == nil || !*ready.HTTPSConfigured {
		t.Fatalf("IP-only local TLS was not recognized as independently verified: %+v", ready)
	}
	failed := good
	failed.LANTLSState = "failed"
	failed.LANVerifiedIPSHA256 = ""
	write(failed)
	if got := caddyStatusFromAdmin(t, s); got.Status != "unavailable" {
		t.Fatalf("failed local IP TLS was reported ready: %+v", got)
	}
	oldManager := caddyHostStatus{State: "healthy", TLSCheckSupported: true, TLSState: "disabled"}
	write(oldManager)
	if got := caddyStatusFromAdmin(t, s); got.Status == "ready" {
		t.Fatalf("old Host Manager cannot prove configured private IP TLS: %+v", got)
	}
	mismatch := good
	mismatch.LANVerifiedIPSHA256 = strings.Repeat("b", 64)
	write(mismatch)
	if got := caddyStatusFromAdmin(t, s); got.Status == "ready" {
		t.Fatalf("wrong IP TLS witness was accepted: %+v", got)
	}
	invalid := good
	invalid.LANVerifiedIPSHA256 = "bad"
	write(invalid)
	if _, observed := s.readCaddyHostStatus(); observed {
		t.Fatal("malformed IP TLS digest accepted as valid host status")
	}
}
