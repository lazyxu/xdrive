package photointelligence

import (
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"
)

const (
	offlineRosterEpoch   = "0123456789abcdef0123456789abcdef"
	offlineRosterModel   = "22222222222222222222222222222222"
	offlineRosterServerA = "11111111111111111111111111111111"
	offlineRosterServerB = "33333333333333333333333333333333"
	offlineRosterIssued  = 1700000000
)

func offlineRosterFixture(t *testing.T) (OfflinePhotoModelExpectedRosterV1, string, ed25519.PublicKey) {
	t.Helper()
	r := OfflinePhotoModelExpectedRosterV1{
		Version:           1,
		DeploymentEpoch:   offlineRosterEpoch,
		Revision:          23,
		IssuedAt:          offlineRosterIssued,
		ExpiresAt:         offlineRosterIssued + 120,
		ModelBootID:       offlineRosterModel,
		ExpectedServerIDs: []string{offlineRosterServerA, offlineRosterServerB},
	}
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	private := ed25519.NewKeyFromSeed(seed)
	canonical, err := offlinePhotoModelExpectedRosterCanonical(r)
	if err != nil {
		t.Fatal(err)
	}
	sig := hex.EncodeToString(ed25519.Sign(private, canonical))
	return r, sig, private.Public().(ed25519.PublicKey)
}

func TestOfflinePhotoModelRosterCanonicalDeterministic(t *testing.T) {
	r, signature, pub := offlineRosterFixture(t)
	if len(signature) != 128 {
		t.Fatalf("wrong Ed25519 test signature length: %d", len(signature))
	}
	const expectedSignature = "bc91943094c26a665136f53ffb406cb3b2852642e45c5c2d8b93ff9afc24bf905b97480852d240ca17802607c16088bcf400ce1e70dba08813a610904b2cfd09"
	if signature != expectedSignature {
		t.Fatalf("offline expected-roster v1 signature vector drifted: %q", signature)
	}
	canonical, err := offlinePhotoModelExpectedRosterCanonical(r)
	if err != nil {
		t.Fatal(err)
	}
	want := "xdrive.photo.expected-roster.v1\n1\n" + offlineRosterEpoch + "\n23\n1700000000\n1700000120\n" + offlineRosterModel + "\n2\n" + offlineRosterServerA + "\n" + offlineRosterServerB + "\n"
	if string(canonical) != want {
		t.Fatalf("noncanonical roster transcript %q", canonical)
	}
	for _, server := range r.ExpectedServerIDs {
		if err := VerifyOfflinePhotoModelExpectedRosterV1(r, signature, pub, offlineRosterEpoch, offlineRosterModel, server, 23, offlineRosterIssued+1); err != nil {
			t.Fatalf("expected server rejected: %v", err)
		}
	}
}

func TestOfflinePhotoModelRosterRejectsMalformedManifests(t *testing.T) {
	base, _, _ := offlineRosterFixture(t)
	cases := map[string]func(*OfflinePhotoModelExpectedRosterV1){
		"bad version":       func(r *OfflinePhotoModelExpectedRosterV1) { r.Version = 2 },
		"zero revision":     func(r *OfflinePhotoModelExpectedRosterV1) { r.Revision = 0 },
		"revision overflow": func(r *OfflinePhotoModelExpectedRosterV1) { r.Revision = 1 << 60 },
		"bad epoch":         func(r *OfflinePhotoModelExpectedRosterV1) { r.DeploymentEpoch = strings.Repeat("Z", 32) },
		"bad boot":          func(r *OfflinePhotoModelExpectedRosterV1) { r.ModelBootID = "" },
		"negative issued":   func(r *OfflinePhotoModelExpectedRosterV1) { r.IssuedAt = -1 },
		"zero ttl":          func(r *OfflinePhotoModelExpectedRosterV1) { r.ExpiresAt = r.IssuedAt },
		"too long":          func(r *OfflinePhotoModelExpectedRosterV1) { r.ExpiresAt = r.IssuedAt + 301 },
		"no members":        func(r *OfflinePhotoModelExpectedRosterV1) { r.ExpectedServerIDs = nil },
		"duplicate members": func(r *OfflinePhotoModelExpectedRosterV1) {
			r.ExpectedServerIDs = []string{offlineRosterServerA, offlineRosterServerA}
		},
		"unordered members": func(r *OfflinePhotoModelExpectedRosterV1) {
			r.ExpectedServerIDs = []string{offlineRosterServerB, offlineRosterServerA}
		},
		"member uppercase": func(r *OfflinePhotoModelExpectedRosterV1) {
			r.ExpectedServerIDs = []string{strings.ToUpper(strings.Repeat("a", 32))}
		},
		"too many members": func(r *OfflinePhotoModelExpectedRosterV1) {
			for i := 0; i < 33; i++ {
				r.ExpectedServerIDs = append(r.ExpectedServerIDs, strings.Repeat("a", 31)+string(rune('a'+i%26)))
			}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := base
			r.ExpectedServerIDs = append([]string(nil), base.ExpectedServerIDs...)
			mutate(&r)
			if _, err := offlinePhotoModelExpectedRosterCanonical(r); err == nil {
				t.Fatal("invalid member manifest accepted")
			}
		})
	}
}

func TestOfflinePhotoModelRosterRequiresTrustedPinnedFactsAndSignature(t *testing.T) {
	r, sig, pub := offlineRosterFixture(t)
	check := func(r OfflinePhotoModelExpectedRosterV1, sig string, pub ed25519.PublicKey, epoch, boot, server string, rev, now int64) error {
		return VerifyOfflinePhotoModelExpectedRosterV1(r, sig, pub, epoch, boot, server, rev, now)
	}
	tests := map[string]func() error{
		"missing key": func() error {
			return check(r, sig, nil, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"wrong key": func() error {
			return check(r, sig, make([]byte, ed25519.PublicKeySize), offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"empty signature": func() error {
			return check(r, "", pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"uppercase signature": func() error {
			return check(r, strings.ToUpper(sig), pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"mismatched epoch": func() error {
			return check(r, sig, pub, strings.Repeat("f", 32), offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"mismatched boot": func() error {
			return check(r, sig, pub, offlineRosterEpoch, strings.Repeat("f", 32), offlineRosterServerA, 23, offlineRosterIssued)
		},
		"mismatched revision": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 24, offlineRosterIssued)
		},
		"unknown server": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, strings.Repeat("f", 32), 23, offlineRosterIssued)
		},
		"too early": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued-6)
		},
		"expired": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, r.ExpiresAt)
		},
		"missing trusted server": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, "", 23, offlineRosterIssued)
		},
		"bad expected revision": func() error {
			return check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 0, offlineRosterIssued)
		},
		"signature tampering": func() error {
			s := []byte(sig)
			if s[0] == '0' {
				s[0] = '1'
			} else {
				s[0] = '0'
			}
			return check(r, string(s), pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued)
		},
		"manifest tampering": func() error {
			m := r
			m.Revision++
			return check(m, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 24, offlineRosterIssued)
		},
	}
	for name, reject := range tests {
		t.Run(name, func(t *testing.T) {
			if err := reject(); err == nil {
				t.Fatal("untrusted roster accepted")
			}
		})
	}
	if err := check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, offlineRosterIssued-5); err != nil {
		t.Fatalf("allowed clock skew rejected: %v", err)
	}
	if err := check(r, sig, pub, offlineRosterEpoch, offlineRosterModel, offlineRosterServerA, 23, r.ExpiresAt-1); err != nil {
		t.Fatalf("last valid second rejected: %v", err)
	}
}
