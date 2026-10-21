package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPreparedHostProbeCanonicalSignerRoundTripsAsReadOnly(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, private, keyPin := testKeys(t)
	claim := testClaim(now)
	envelope := preparedHostProbeEnvelope{
		manifest: claim, domainProbeObserved: true, lanProbeObserved: true,
	}
	raw, signature, err := signPreparedHostProbe(envelope, private, now)
	if err != nil {
		t.Fatalf("a bounded fully prepared test envelope must sign: %v", err)
	}
	if !bytes.HasSuffix(raw, []byte{'\n'}) || len(raw) > maxManifestSize ||
		len(signature) != ed25519.SignatureSize {
		t.Fatal("signed private envelope is not canonical and bounded")
	}
	verified, err := VerifyReadOnly(raw, signature, pub, keyPin, claim.HostID, claim.ServerID, now)
	if err != nil {
		t.Fatalf("the existing independent verifier rejected the envelope: %v", err)
	}
	if verified.CandidateComplete() || verified.CanAdopt() || verified.ApplySupported() {
		t.Fatal("a valid Host-only signature was incorrectly promoted into authority")
	}
	if runtime.GOOS == "windows" {
		return // The private filesystem reader explicitly fails closed on Windows.
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{
		privateManifestFile: raw, privateSignatureFile: signature, privatePublicDERFile: der,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	read, err := ReadPrivateBundle(dir, keyPin, claim.HostID, claim.ServerID, now)
	if err != nil {
		t.Fatalf("the preceding stage's exact fixed-name private reader rejected signed bytes: %v", err)
	}
	if read.CandidateComplete() || read.CanAdopt() || read.ApplySupported() {
		t.Fatal("the read-only private bundle accidentally authorized adoption or Apply")
	}
}

func TestPreparedHostProbeSignerFailsClosedWithoutBothObservedSources(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	_, private, _ := testKeys(t)
	for _, tc := range []struct {
		name        string
		domain, lan bool
	}{
		{"neither", false, false},
		{"domain only", true, false},
		{"LAN only", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, sig, err := signPreparedHostProbe(preparedHostProbeEnvelope{
				manifest: testClaim(now), domainProbeObserved: tc.domain, lanProbeObserved: tc.lan,
			}, private, now)
			if err == nil || raw != nil || sig != nil {
				t.Fatal("incomplete positive/negative observation markers obtained a signature")
			}
		})
	}
}

func TestPreparedHostProbeSignerRejectsInvalidIdentityKeyTimeAndIngress(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	_, private, _ := testKeys(t)
	for _, tc := range []struct {
		name string
		edit func(*Manifest)
		key  ed25519.PrivateKey
		at   time.Time
	}{
		{"missing key", nil, nil, now},
		{"bad key length", nil, ed25519.PrivateKey{1}, now},
		{"zero time", nil, private, time.Time{}},
		{"bad domain", func(m *Manifest) { m.Domain = "https://example.com/" }, private, now},
		{"both disabled", func(m *Manifest) {
			m.DomainState = disabledLocal
			m.Domain = ""
			m.LANState = disabledLocal
			m.LANIP = ""
		}, private, now},
		{"expired", nil, private, now.Add(time.Minute)},
		{"missing host identity", func(m *Manifest) { m.HostID = strings.Repeat("0", 64) }, private, now},
		{"missing local proof digest", func(m *Manifest) { m.LANProbeSHA = "" }, private, now},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := testClaim(now)
			if tc.edit != nil {
				tc.edit(&m)
			}
			raw, sig, err := signPreparedHostProbe(preparedHostProbeEnvelope{
				manifest: m, domainProbeObserved: true, lanProbeObserved: true,
			}, tc.key, tc.at)
			if err == nil || raw != nil || sig != nil {
				t.Fatal("untrusted or stale prepared Host evidence was signed")
			}
		})
	}
}

func TestPreparedHostProbeSignerDoesNotUpgradeClaimedNegativeProof(t *testing.T) {
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, private, pin := testKeys(t)
	claim := testClaim(now)
	claim.LANIP = ""
	claim.LANState = disabledLocal
	raw, sig, err := signPreparedHostProbe(preparedHostProbeEnvelope{
		manifest: claim, domainProbeObserved: true, lanProbeObserved: true,
	}, private, now)
	if err != nil {
		t.Fatal(err)
	}
	out, err := VerifyReadOnly(raw, sig, pub, pin, claim.HostID, claim.ServerID, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.CanAdopt() || out.ApplySupported() || out.CandidateComplete() {
		t.Fatal("even a correctly signed negative observation CLAIM is not a real negative ingress proof")
	}
}
