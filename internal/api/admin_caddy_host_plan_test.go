package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestCaddyHostPlanCanonicalNonSecretAndFailClosed(t *testing.T) {
	valid := caddyPreflightSnapshot{
		Desired: adminCaddyHTTPSDesired{
			Revision: 7, Source: "saved", LANEnabled: true, LANIP: "192.168.2.4",
		},
	}
	const golden = "{\"credential_revision\":0,\"desired_revision\":7,\"domain\":\"\",\"domain_enabled\":false,\"lan_enabled\":true,\"lan_ip\":\"192.168.2.4\",\"protocol\":\"xdrive.caddy.https.host-plan.v1\"}\n"
	body, err := buildCaddyHTTPSHostPlan(valid)
	if err != nil || string(body) != golden {
		t.Fatalf("canonical host plan mismatch: %q, %v", body, err)
	}
	if !json.Valid(body) {
		t.Fatal("canonical host plan must be JSON")
	}
	dual := valid
	dual.Desired.Enabled = true
	dual.Desired.Domain = "drive.example.com"
	dual.CredentialExists = true
	dual.Credential = meta.AdminServiceSecret{
		Revision: 8, Enabled: true, KeyVersion: 1,
		Ciphertext: []byte("encrypted-in-database-never-to-operator"),
	}
	body, err = buildCaddyHTTPSHostPlan(dual)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte(`"credential_revision":8`)) ||
		bytes.Contains(body, []byte("encrypted-in-database-never-to-operator")) ||
		bytes.Contains(body, []byte("access_key_secret")) ||
		bytes.Contains(body, []byte("apply_supported")) {
		t.Fatalf("host dry-run plan leaked secrets or fake apply capability: %q", body)
	}
	cases := []struct {
		name string
		mut  func(*caddyPreflightSnapshot)
	}{
		{"revision zero", func(s *caddyPreflightSnapshot) { s.Desired.Revision = 0 }},
		{"default not saved", func(s *caddyPreflightSnapshot) { s.Desired.Source = "default" }},
		{"both off", func(s *caddyPreflightSnapshot) { s.Desired.LANEnabled = false }},
		{"public masquerades as LAN", func(s *caddyPreflightSnapshot) { s.Desired.LANIP = "8.8.8.8" }},
		{"octal LAN", func(s *caddyPreflightSnapshot) { s.Desired.LANIP = "192.168.02.4" }},
		{"unsafe domain", func(s *caddyPreflightSnapshot) {
			s.Desired.Enabled = true
			s.Desired.Domain = "https://bad.example.com"
		}},
		{"missing AliDNS", func(s *caddyPreflightSnapshot) { s.Desired.Enabled = true; s.Desired.Domain = "drive.example.com" }},
		{"stale huge revision", func(s *caddyPreflightSnapshot) { s.Desired.Revision = 1 << 60 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := valid
			tc.mut(&s)
			body, err := buildCaddyHTTPSHostPlan(s)
			if !errors.Is(err, errCaddyHostPlanIncomplete) || body != nil {
				t.Fatalf("unsafe candidate returned bytes %q: %v", body, err)
			}
		})
	}
	dual.Credential.Enabled = false
	if body, err := buildCaddyHTTPSHostPlan(dual); body != nil || !errors.Is(err, errCaddyHostPlanIncomplete) {
		t.Fatal("disabled AliDNS cannot authorize domain plan")
	}
}

func TestCaddyPreflightSnapshotChangeAlsoIncludesLANValues(t *testing.T) {
	base := caddyPreflightSnapshot{Desired: adminCaddyHTTPSDesired{
		Revision: 4, Source: "saved", LANEnabled: true, LANIP: "192.168.2.4",
	}}
	if !sameCaddyPreflightSnapshot(base, base) {
		t.Fatal("same read snapshot should compare equal")
	}
	changed := base
	changed.Desired.LANIP = "192.168.2.5"
	if sameCaddyPreflightSnapshot(base, changed) {
		t.Fatal("different private IP with same revision cannot validate host plan")
	}
	changed = base
	changed.Desired.LANEnabled = false
	if sameCaddyPreflightSnapshot(base, changed) {
		t.Fatal("private IP enable state drift escaped revision snapshot check")
	}
}
