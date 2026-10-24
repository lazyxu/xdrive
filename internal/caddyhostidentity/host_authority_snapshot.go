package caddyhostidentity

import (
	"bytes"
	"encoding/json"
	"io"
	"time"
)

const privateHostSnapshotMaxBytes = 2048

// privateHostAuthoritySnapshot is obtained ONLY from the fixed Host Control
// snapshot under its installer lock. It is not a browser DTO or a capability
// to change Caddy. It retains only the two host targets and the non-secret
// fingerprint; all fields are deliberately unexported to prevent serialization.
type privateHostAuthoritySnapshot struct {
	domain    string
	lanIPv4   string
	envSHA    string
	fileEpoch string // Host .env inode/ctime/mtime; never serialized
}

type privateHostAuthorityJSON struct {
	Protocol         string `json:"protocol"`
	Domain           string `json:"domain"`
	DomainEnabled    bool   `json:"domain_enabled"`
	LANIP            string `json:"lan_ip"`
	LANEnabled       bool   `json:"lan_enabled"`
	AliDNSConfigured bool   `json:"alidns_configured"`
	SHA256           string `json:"sha256"`
	PendingRedeploy  bool   `json:"pending_redeploy"`
	ObservedAt       string `json:"observed_at"`
}

// Decode the existing Host's sanitized snapshot protocol without accepting
// duplicate keys, implicit defaults, unrecognized fields, pending Save state,
// unknown timestamps or a forged target/config mismatch. A valid decoded
// value is still NOT an independent observation until the trusted fixed
// Host-only producer and continuity fence have been established.
func privateDecodeAuthoritativeHostSnapshot(raw []byte, now time.Time) (privateHostAuthoritySnapshot, error) {
	fail := func() (privateHostAuthoritySnapshot, error) { return privateHostAuthoritySnapshot{}, errUntrusted }
	if now.IsZero() || len(raw) < 2 || len(raw) > privateHostSnapshotMaxBytes ||
		!privateHasUnambiguousCaddyJSON(raw) {
		return fail()
	}
	var s privateHostAuthorityJSON
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var next any
	if dec.Decode(&s) != nil || dec.Decode(&next) != io.EOF ||
		s.Protocol != "xdrive.caddy.host-env.v1" ||
		!validDigest(s.SHA256) || s.PendingRedeploy ||
		s.DomainEnabled != (s.Domain != "") || s.LANEnabled != (s.LANIP != "") ||
		(!s.DomainEnabled && !s.LANEnabled) ||
		(s.DomainEnabled && (!validDomain(s.Domain) || !s.AliDNSConfigured)) ||
		(s.LANEnabled && !validLANIP(s.LANIP)) {
		return fail()
	}
	observed, err := time.Parse(time.RFC3339Nano, s.ObservedAt)
	if err != nil || observed.After(now.Add(5*time.Second)) ||
		now.Sub(observed) > 30*time.Second {
		return fail()
	}
	return privateHostAuthoritySnapshot{domain: s.Domain, lanIPv4: s.LANIP, envSHA: s.SHA256}, nil
}
