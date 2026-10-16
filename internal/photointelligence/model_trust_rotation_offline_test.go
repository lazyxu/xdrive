package photointelligence

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

type offlineTrustRotationFixture struct {
	roster              OfflinePhotoModelExpectedRosterV1
	rosterSignature     string
	claim               OfflinePhotoTrustRotationV1
	oldKey, newKey      ed25519.PrivateKey
	oldSig, newSig      string
	reviewedFingerprint string
}

func newOfflineTrustRotationFixture(t *testing.T) offlineTrustRotationFixture {
	t.Helper()
	previous := offlineMemberPreparedTestFixture(t)
	oldKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x10}, ed25519.SeedSize))
	newKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x55}, ed25519.SeedSize))
	oldHash := sha256.Sum256(oldKey.Public().(ed25519.PublicKey))
	newHash := sha256.Sum256(newKey.Public().(ed25519.PublicKey))
	canonical, err := offlinePhotoModelExpectedRosterCanonical(previous.roster)
	if err != nil {
		t.Fatal(err)
	}
	rosterHash := sha256.Sum256(canonical)
	claim := OfflinePhotoTrustRotationV1{
		Version:           1,
		CurrentEpoch:      offlineRolloutTestEpoch,
		NextEpoch:         strings.Repeat("a", 32),
		RosterSHA256:      hex.EncodeToString(rosterHash[:]),
		CurrentRootSHA256: hex.EncodeToString(oldHash[:]),
		NextRootSHA256:    hex.EncodeToString(newHash[:]),
		Revision:          73, Sequence: 9,
		IssuedAt:         offlineRolloutTestNow - 1,
		ExpiresAt:        offlineRolloutTestNow + 30,
		RevokedServerIDs: []string{offlineRolloutTestS2},
	}
	f := offlineTrustRotationFixture{roster: previous.roster, rosterSignature: previous.rosterSignature,
		claim: claim, oldKey: oldKey, newKey: newKey, reviewedFingerprint: hex.EncodeToString(newHash[:])}
	f.sign(t)
	return f
}
func (f *offlineTrustRotationFixture) sign(t *testing.T) {
	t.Helper()
	msg, err := offlinePhotoTrustRotationCanonical(f.claim)
	if err != nil {
		t.Fatalf("cannot sign candidate: %v", err)
	}
	f.oldSig = hex.EncodeToString(ed25519.Sign(f.oldKey, msg))
	f.newSig = hex.EncodeToString(ed25519.Sign(f.newKey, msg))
}
func (f offlineTrustRotationFixture) verify(now int64, floor uint64) error {
	return VerifyOfflinePhotoTrustRotationV1(f.claim, f.oldSig, f.newSig,
		f.oldKey.Public().(ed25519.PublicKey), f.newKey.Public().(ed25519.PublicKey),
		f.reviewedFingerprint, f.roster, f.rosterSignature,
		offlineRolloutTestEpoch, offlineRolloutTestBoot, 73, floor, now)
}

func TestOfflinePhotoTrustRotationTwoKeyApprovalAndDeterministicTranscript(t *testing.T) {
	f := newOfflineTrustRotationFixture(t)
	if err := f.verify(offlineRolloutTestNow, 8); err != nil {
		t.Fatalf("dual signed trust transition unexpectedly rejected: %v", err)
	}
	if err := f.verify(offlineRolloutTestNow+29, 8); err != nil {
		t.Fatalf("last valid second rejected: %v", err)
	}
	msg, err := offlinePhotoTrustRotationCanonical(f.claim)
	if err != nil || !bytes.HasPrefix(msg, []byte("xdrive.photo.trust-rotation.v1\n1\n")) || !bytes.HasSuffix(msg, []byte("\n")) {
		t.Fatalf("unexpected transcript: %v", err)
	}
	if len(msg) > 1024 {
		t.Fatal("trust transition candidate grew unexpectedly")
	}
	// Prevent accidental cross-domain or key-order changes in the codec.
	const golden = "daed99f754ed48562b538e71d2b5814ec2649e80f4c1fc240937ea5d8ac34d0aa81c0519273caae25749ec2d00040ba6335da35f6f433ab48b65b870906f6100"
	if f.oldSig != golden {
		t.Fatalf("old operator deterministic Ed25519 signature drifted: %s", f.oldSig)
	}
	const nextGolden = "09161c44b7de717e16a35aaf2fe94355d861ee1cda3dd66d05f27ffd59306bb57a217da8e9cd2b850c4c3d2c1698df337b8cd194069b9187d40b47dffcb40a03"
	if f.newSig != nextGolden {
		t.Fatalf("new operator deterministic Ed25519 signature drifted: %s", f.newSig)
	}
}
func TestOfflinePhotoTrustRotationRejectsUntrustedApprovals(t *testing.T) {
	cases := map[string]func(*offlineTrustRotationFixture){
		"no current signature":        func(f *offlineTrustRotationFixture) { f.oldSig = "" },
		"forged current signature":    func(f *offlineTrustRotationFixture) { f.oldSig = strings.Repeat("0", 128) },
		"forged next signature":       func(f *offlineTrustRotationFixture) { f.newSig = strings.Repeat("0", 128) },
		"uppercase signature":         func(f *offlineTrustRotationFixture) { f.oldSig = strings.ToUpper(f.oldSig) },
		"unapproved next fingerprint": func(f *offlineTrustRotationFixture) { f.reviewedFingerprint = strings.Repeat("f", 64) },
		"operator self rotation":      func(f *offlineTrustRotationFixture) { f.newKey = f.oldKey },
		"sequence replay":             func(f *offlineTrustRotationFixture) { f.claim.Sequence = 8 },
		"unbound roster":              func(f *offlineTrustRotationFixture) { f.claim.RosterSHA256 = strings.Repeat("a", 64) },
		"stale epoch":                 func(f *offlineTrustRotationFixture) { f.claim.CurrentEpoch = strings.Repeat("f", 32) },
		"same epoch":                  func(f *offlineTrustRotationFixture) { f.claim.NextEpoch = f.claim.CurrentEpoch },
		"invalid next epoch":          func(f *offlineTrustRotationFixture) { f.claim.NextEpoch = strings.Repeat("Z", 32) },
		"revision drift":              func(f *offlineTrustRotationFixture) { f.claim.Revision++ },
		"counter zero":                func(f *offlineTrustRotationFixture) { f.claim.Sequence = 0 },
		"revocation missing member":   func(f *offlineTrustRotationFixture) { f.claim.RevokedServerIDs = []string{strings.Repeat("f", 32)} },
		"revocation duplicates": func(f *offlineTrustRotationFixture) {
			f.claim.RevokedServerIDs = []string{offlineRolloutTestS2, offlineRolloutTestS2}
		},
		"revocation all members": func(f *offlineTrustRotationFixture) {
			f.claim.RevokedServerIDs = []string{offlineRolloutTestS1, offlineRolloutTestS2}
		},
		"revocation wrong order": func(f *offlineTrustRotationFixture) {
			f.claim.RevokedServerIDs = []string{offlineRolloutTestS2, offlineRolloutTestS1}
		},
		"claim future":     func(f *offlineTrustRotationFixture) { f.claim.IssuedAt = offlineRolloutTestNow + 6 },
		"claim expired":    func(f *offlineTrustRotationFixture) { f.claim.ExpiresAt = offlineRolloutTestNow },
		"too long ttl":     func(f *offlineTrustRotationFixture) { f.claim.ExpiresAt = f.claim.IssuedAt + 301 },
		"roster tampering": func(f *offlineTrustRotationFixture) { f.rosterSignature = strings.Repeat("0", 128) },
	}
	for name, edit := range cases {
		t.Run(name, func(t *testing.T) {
			f := newOfflineTrustRotationFixture(t)
			edit(&f)
			if err := f.verify(offlineRolloutTestNow, 8); err == nil {
				t.Fatal("untrusted rotation accepted")
			}
		})
	}
}
func TestOfflinePhotoTrustRotationRequiresIndependentSequenceAndExpiry(t *testing.T) {
	f := newOfflineTrustRotationFixture(t)
	if err := f.verify(offlineRolloutTestNow, 9); err == nil {
		t.Fatal("same sequence replay accepted")
	}
	if err := f.verify(offlineRolloutTestNow+30, 8); err == nil {
		t.Fatal("expired transition accepted")
	}
	if err := f.verify(offlineRolloutTestNow-7, 8); err == nil {
		t.Fatal("future transition accepted")
	}
	if err := f.verify(f.roster.ExpiresAt, 8); err == nil {
		t.Fatal("old roster expired")
	}
	// Revocation of the sole remaining member cannot claim future readiness.
	f = newOfflineTrustRotationFixture(t)
	f.claim.RevokedServerIDs = []string{offlineRolloutTestS1, offlineRolloutTestS2}
	f.sign(t)
	if err := f.verify(offlineRolloutTestNow, 8); err == nil {
		t.Fatal("all members revoked")
	}
}
