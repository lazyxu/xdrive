package caddyhostidentity

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestHostAuthoritySnapshotRejectsForgeryAndPendingEdits(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	good := privateHostAuthorityJSON{Protocol: "xdrive.caddy.host-env.v1", Domain: "current.example.test",
		DomainEnabled: true, LANIP: "192.168.2.4", LANEnabled: true, AliDNSConfigured: true,
		SHA256: strings.Repeat("a", 64), ObservedAt: now.Format(time.RFC3339Nano)}
	encode := func(s privateHostAuthorityJSON) []byte {
		raw, e := json.Marshal(s)
		if e != nil {
			t.Fatal(e)
		}
		return raw
	}
	out, err := privateDecodeAuthoritativeHostSnapshot(encode(good), now)
	if err != nil || out.domain != good.Domain || out.lanIPv4 != good.LANIP || out.envSHA != good.SHA256 {
		t.Fatal("valid Host snapshot rejected", err)
	}
	raw, e := json.Marshal(out)
	if e != nil || string(raw) != "{}" {
		t.Fatal("Host target leaked via JSON")
	}
	for _, tc := range []struct {
		name string
		edit func(*privateHostAuthorityJSON)
	}{
		{"pending", func(s *privateHostAuthorityJSON) { s.PendingRedeploy = true }},
		{"missing domain enable", func(s *privateHostAuthorityJSON) { s.DomainEnabled = false }},
		{"missing lan enable", func(s *privateHostAuthorityJSON) { s.LANEnabled = false }},
		{"bad domain", func(s *privateHostAuthorityJSON) { s.Domain = "https://example.test" }},
		{"bad private IP", func(s *privateHostAuthorityJSON) { s.LANIP = "8.8.8.8" }},
		{"missing AliDNS", func(s *privateHostAuthorityJSON) { s.AliDNSConfigured = false }},
		{"bad digest", func(s *privateHostAuthorityJSON) { s.SHA256 = "not-hash" }},
		{"bad protocol", func(s *privateHostAuthorityJSON) { s.Protocol = "malicious" }},
		{"stale", func(s *privateHostAuthorityJSON) { s.ObservedAt = now.Add(-2 * time.Minute).Format(time.RFC3339Nano) }},
		{"future", func(s *privateHostAuthorityJSON) { s.ObservedAt = now.Add(6 * time.Second).Format(time.RFC3339Nano) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := good
			tc.edit(&copy)
			if _, err := privateDecodeAuthoritativeHostSnapshot(encode(copy), now); err == nil {
				t.Fatal("untrusted Host snapshot admitted")
			}
		})
	}
	for _, data := range []string{
		`{"protocol":"xdrive.caddy.host-env.v1","protocol":"other"}`,
		string(encode(good)) + `{}`,
		strings.Replace(string(encode(good)), `"domain":`, `"unknown":"injected","domain":`, 1),
	} {
		if _, err := privateDecodeAuthoritativeHostSnapshot([]byte(data), now); err == nil {
			t.Fatal("ambiguous Host snapshot accepted")
		}
	}
}
