package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func testDigest(char string) string { return strings.Repeat(char, 64) }

func testClaim(now time.Time) Manifest {
	return Manifest{
		Domain: "photos.example.com", DomainProbeSHA: testDigest("a"),
		DomainState: enabledLocal,
		ExpiresAt:   now.Add(20 * time.Second).UTC().Format(time.RFC3339Nano),
		HostID:      testDigest("b"), InstanceID: testDigest("c"),
		LANIP: "192.168.2.4", LANProbeSHA: testDigest("d"),
		LANState: enabledLocal, LiveConfigSHA: testDigest("e"),
		ObservedAt: now.Add(-10 * time.Second).UTC().Format(time.RFC3339Nano),
		Schema:     1, Scope: Scope, ServerID: testDigest("f"),
		StartGeneration: testDigest("1"),
	}
}

func testKeys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, string) {
	t.Helper()
	seed := bytes.Repeat([]byte{0x23}, ed25519.SeedSize)
	private := ed25519.NewKeyFromSeed(seed)
	public := private.Public().(ed25519.PublicKey)
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil || len(der) != 44 {
		t.Fatal("could not construct Ed25519 SPKI DER trust pin")
	}
	sum := sha256.Sum256(der)
	return public, private, hex.EncodeToString(sum[:])
}

func signClaim(t *testing.T, m Manifest, private ed25519.PrivateKey) ([]byte, []byte) {
	t.Helper()
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	return raw, ed25519.Sign(private, append([]byte(signatureDomain), raw...))
}

func TestReadOnlySignatureNeverGrantsHostAuthority(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	claim := testClaim(now)
	raw, sig := signClaim(t, claim, priv)
	verified, err := VerifyReadOnly(raw, sig, pub, pin, claim.HostID, claim.ServerID, now)
	if err != nil {
		t.Fatal("independently signed read-only claim refused")
	}
	if verified.CandidateComplete() || verified.CanAdopt() || verified.ApplySupported() {
		t.Fatal("signature was incorrectly promoted into adoption or Host Apply authority")
	}
	encoded, err := json.Marshal(verified)
	if err != nil {
		t.Fatal(err)
	}
	for _, sensitive := range []string{claim.Domain, claim.LANIP, claim.HostID,
		claim.ServerID, claim.LiveConfigSHA, claim.DomainProbeSHA} {
		if bytes.Contains(encoded, []byte(sensitive)) {
			t.Fatal("public encoding of private identity witness would leak")
		}
	}
	for _, printable := range []string{
		fmt.Sprintf("%+v", verified),
		fmt.Sprintf("%#v", verified),
	} {
		for _, sensitive := range []string{claim.Domain, claim.LANIP, claim.HostID,
			claim.ServerID, claim.LiveConfigSHA, claim.DomainProbeSHA} {
			if strings.Contains(printable, sensitive) {
				t.Fatal("Go diagnostic formatting exposed private Host identity data")
			}
		}
	}
}

func TestReadOnlyAcceptsCanonicalDNSDigitsAndInternalHyphens(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	for _, domain := range []string{"photos-2026.example.com", "x-7.example.com"} {
		claim := testClaim(now)
		claim.Domain = domain
		raw, signature := signClaim(t, claim, priv)
		if _, err := VerifyReadOnly(raw, signature, pub, pin,
			claim.HostID, claim.ServerID, now); err != nil {
			t.Fatal("valid lowercase DNS label with numbers/hyphens rejected")
		}
	}
}

func TestReadOnlySingleIngressRetainsSignedNegativeClaimWithoutAuthority(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	for _, disabled := range []string{"domain", "lan"} {
		claim := testClaim(now)
		if disabled == "domain" {
			claim.Domain, claim.DomainState = "", disabledLocal
		} else {
			claim.LANIP, claim.LANState = "", disabledLocal
		}
		raw, signature := signClaim(t, claim, priv)
		evidence, err := VerifyReadOnly(raw, signature, pub, pin,
			claim.HostID, claim.ServerID, now)
		if err != nil {
			t.Fatalf("%s disabled observation format rejected", disabled)
		}
		if evidence.CandidateComplete() || evidence.CanAdopt() || evidence.ApplySupported() {
			t.Fatal("format-only signed negative ingress claim authorized Host action")
		}
		claim.DomainProbeSHA = ""
		if disabled == "lan" {
			claim.DomainProbeSHA, claim.LANProbeSHA = testDigest("a"), ""
		}
		raw, signature = signClaim(t, claim, priv)
		if _, err := VerifyReadOnly(raw, signature, pub, pin,
			claim.HostID, claim.ServerID, now); err == nil {
			t.Fatal("missing signed probe fingerprint allowed")
		}
	}
}

func TestReadOnlyRejectsForgedCrossScopeAndUnpinnedSources(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	claim := testClaim(now)
	raw, sig := signClaim(t, claim, priv)
	requireRejected := func(name string, raw, sig []byte, key ed25519.PublicKey,
		keyPin, hostPin, serverPin string) {
		t.Helper()
		if _, err := VerifyReadOnly(raw, sig, key, keyPin, hostPin, serverPin, now); err == nil {
			t.Fatalf("%s: untrusted claim accepted", name)
		}
	}
	requireRejected("untrusted key pin", raw, sig, pub, testDigest("9"), claim.HostID, claim.ServerID)
	requireRejected("wrong host binding", raw, sig, pub, pin, testDigest("a"), claim.ServerID)
	requireRejected("wrong server binding", raw, sig, pub, pin, claim.HostID, testDigest("b"))
	requireRejected("unconfigured key", raw, sig, pub, "", claim.HostID, claim.ServerID)
	requireRejected("unconfigured host pin", raw, sig, pub, pin, "", claim.ServerID)
	requireRejected("unconfigured server pin", raw, sig, pub, pin, claim.HostID, "")
	badSignature := append([]byte(nil), sig...)
	badSignature[0] ^= 1
	requireRejected("tampered signature", raw, badSignature, pub, pin, claim.HostID, claim.ServerID)
	requireRejected("signature length", raw, sig[:63], pub, pin, claim.HostID, claim.ServerID)
	requireRejected("cross-protocol signature", raw, ed25519.Sign(priv, raw), pub,
		pin, claim.HostID, claim.ServerID)
	requireRejected("tampered manifest", append(append([]byte(nil), raw...), ' '),
		sig, pub, pin, claim.HostID, claim.ServerID)
}

func TestReadOnlyRejectsUnreliableSignedHostFacts(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	claim := testClaim(now)
	cases := []struct {
		name string
		edit func(*Manifest)
	}{
		{"saved hint masquerading as hostname", func(m *Manifest) { m.Domain = "https://photos.example.com" }},
		{"uppercase hostname", func(m *Manifest) { m.Domain = "PHOTOS.EXAMPLE.COM" }},
		{"public LAN address", func(m *Manifest) { m.LANIP = "8.8.8.8" }},
		{"noncanonical LAN address", func(m *Manifest) { m.LANIP = "192.168.002.004" }},
		{"missing instance identity", func(m *Manifest) { m.InstanceID = "" }},
		{"empty generation fingerprint", func(m *Manifest) { m.StartGeneration = testDigest("0") }},
		{"missing live config", func(m *Manifest) { m.LiveConfigSHA = "" }},
		{"missing domain proof", func(m *Manifest) { m.DomainProbeSHA = "" }},
		{"unknown domain state", func(m *Manifest) { m.DomainState = "unknown" }},
		{"disabled domain retains running hostname", func(m *Manifest) {
			m.DomainState = disabledLocal
		}},
		{"disabled LAN retains running IP", func(m *Manifest) {
			m.LANState = disabledLocal
		}},
		{"both ingress disabled", func(m *Manifest) {
			m.DomainState, m.Domain = disabledLocal, ""
			m.LANState, m.LANIP = disabledLocal, ""
		}},
		{"revision or deploy scope", func(m *Manifest) { m.Scope = "xdrive.caddy.host-apply" }},
		{"schema mismatch", func(m *Manifest) { m.Schema = 2 }},
		{"stale observation", func(m *Manifest) {
			m.ObservedAt = now.Add(-time.Minute).Format(time.RFC3339Nano)
		}},
		{"expired", func(m *Manifest) {
			m.ExpiresAt = now.Add(-time.Second).Format(time.RFC3339Nano)
		}},
		{"future observation", func(m *Manifest) {
			m.ObservedAt = now.Add(6 * time.Second).Format(time.RFC3339Nano)
		}},
		{"unbounded lease", func(m *Manifest) {
			m.ExpiresAt = now.Add(time.Minute).Format(time.RFC3339Nano)
		}},
		{"non-UTC timestamp", func(m *Manifest) {
			m.ObservedAt = "2026-10-21T20:59:50+09:00"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := claim
			tc.edit(&m)
			raw, sig := signClaim(t, m, priv)
			if _, err := VerifyReadOnly(raw, sig, pub, pin, claim.HostID, claim.ServerID, now); err == nil {
				t.Fatal("unreliable but correctly signed running claim was admitted")
			}
		})
	}
}

func TestReadOnlyRejectsNonCanonicalSignedJSON(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	claim := testClaim(now)
	canonical, _ := signClaim(t, claim, priv)
	bad := [][]byte{
		append(append([]byte(nil), canonical...), '\n'),
		bytes.Replace(canonical, []byte(`"schema":1`), []byte(`"schema":1,"schema":1`), 1),
		bytes.Replace(canonical, []byte(`"scope":`), []byte(`"surprise":true,"scope":`), 1),
		bytes.Replace(canonical, []byte(`"schema":1`), []byte(`"schema":null`), 1),
		bytes.Replace(canonical, []byte(`"scope":`), []byte(` "scope":`), 1),
		bytes.Repeat([]byte("a"), maxManifestSize+1),
	}
	for i, raw := range bad {
		sig := ed25519.Sign(priv, append([]byte(signatureDomain), raw...))
		if _, err := VerifyReadOnly(raw, sig, pub, pin, claim.HostID, claim.ServerID, now); err == nil {
			t.Fatalf("noncanonical signed JSON case %d was accepted", i)
		}
	}
}
