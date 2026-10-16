package photointelligence

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

const (
	offlinePhotoTrustRotationDomain = "xdrive.photo.trust-rotation.v1"
	offlinePhotoTrustRotationMaxTTL = 300
)

var errOfflinePhotoTrustRotationUnverified = errors.New("offline photo trust rotation unverified")

// OfflinePhotoTrustRotationV1 is a NON-DEPLOYED operator trust transition
// candidate. Two valid signatures are not a running fleet migration, key
// distribution, model boot attestation, irreversible anti-rollback or stop grant.
// A deployed source must supply the independently approved new-key fingerprint
// and a durable monotonically increasing sequence before any use.
type OfflinePhotoTrustRotationV1 struct {
	Version           int
	CurrentEpoch      string
	NextEpoch         string
	RosterSHA256      string
	CurrentRootSHA256 string
	NextRootSHA256    string
	Revision          int64
	Sequence          uint64
	IssuedAt          int64
	ExpiresAt         int64
	RevokedServerIDs  []string
}

func offlinePhotoTrustRotationCanonical(r OfflinePhotoTrustRotationV1) ([]byte, error) {
	if r.Version != 1 || !ValidAnalyzerRuntimeInstanceID(r.CurrentEpoch) ||
		!ValidAnalyzerRuntimeInstanceID(r.NextEpoch) || r.CurrentEpoch == r.NextEpoch ||
		!offlinePhotoModelLowerHex(r.RosterSHA256, 64) ||
		!offlinePhotoModelLowerHex(r.CurrentRootSHA256, 64) ||
		!offlinePhotoModelLowerHex(r.NextRootSHA256, 64) ||
		r.CurrentRootSHA256 == r.NextRootSHA256 ||
		r.Revision <= 0 || r.Revision >= 1<<60 || r.Sequence == 0 ||
		r.IssuedAt < 0 || r.ExpiresAt <= r.IssuedAt ||
		r.ExpiresAt-r.IssuedAt > offlinePhotoTrustRotationMaxTTL ||
		len(r.RevokedServerIDs) > offlinePhotoModelExpectedRosterMaxMembers {
		return nil, errOfflinePhotoTrustRotationUnverified
	}
	parts := []string{
		offlinePhotoTrustRotationDomain, "1", r.CurrentEpoch, r.NextEpoch,
		r.RosterSHA256, r.CurrentRootSHA256, r.NextRootSHA256,
		strconv.FormatInt(r.Revision, 10), strconv.FormatUint(r.Sequence, 10),
		strconv.FormatInt(r.IssuedAt, 10), strconv.FormatInt(r.ExpiresAt, 10),
		strconv.Itoa(len(r.RevokedServerIDs)),
	}
	var prev string
	for _, id := range r.RevokedServerIDs {
		if !ValidAnalyzerRuntimeInstanceID(id) || (prev != "" && id <= prev) {
			return nil, errOfflinePhotoTrustRotationUnverified
		}
		prev = id
		parts = append(parts, id)
	}
	return []byte(strings.Join(parts, "\n") + "\n"), nil
}

// VerifyOfflinePhotoTrustRotationV1 uses only explicit trusted TEST inputs:
// an independently pinned current operator root, a human-reviewed new-root
// fingerprint, a previous signed roster, and an externally held high-water
// sequence. It validates a two-key transcript but NEVER installs/rotates keys.
func VerifyOfflinePhotoTrustRotationV1(
	candidate OfflinePhotoTrustRotationV1,
	currentSigHex, nextSigHex string,
	pinnedCurrentKey, proposedNextKey ed25519.PublicKey,
	reviewedNextKeySHA256 string,
	previousRoster OfflinePhotoModelExpectedRosterV1,
	previousRosterSignature string,
	trustedCurrentEpoch, trustedModelBoot string,
	trustedRevision int64, trustedSequenceFloor uint64,
	now int64,
) error {
	if len(pinnedCurrentKey) != ed25519.PublicKeySize ||
		len(proposedNextKey) != ed25519.PublicKeySize ||
		now < 0 || candidate.Sequence <= trustedSequenceFloor ||
		!offlinePhotoModelLowerHex(reviewedNextKeySHA256, 64) ||
		!offlinePhotoModelLowerHex(currentSigHex, 128) ||
		!offlinePhotoModelLowerHex(nextSigHex, 128) {
		return errOfflinePhotoTrustRotationUnverified
	}
	oldFingerprint := sha256.Sum256(pinnedCurrentKey)
	newFingerprint := sha256.Sum256(proposedNextKey)
	oldDigest, newDigest := hex.EncodeToString(oldFingerprint[:]), hex.EncodeToString(newFingerprint[:])
	if oldDigest == newDigest || candidate.CurrentRootSHA256 != oldDigest ||
		candidate.NextRootSHA256 != newDigest || newDigest != reviewedNextKeySHA256 ||
		candidate.CurrentEpoch != trustedCurrentEpoch ||
		candidate.Revision != trustedRevision {
		return errOfflinePhotoTrustRotationUnverified
	}
	if len(previousRoster.ExpectedServerIDs) == 0 ||
		VerifyOfflinePhotoModelExpectedRosterV1(
			previousRoster, previousRosterSignature, pinnedCurrentKey,
			trustedCurrentEpoch, trustedModelBoot,
			previousRoster.ExpectedServerIDs[0], trustedRevision, now,
		) != nil {
		return errOfflinePhotoTrustRotationUnverified
	}
	rosterBytes, err := offlinePhotoModelExpectedRosterCanonical(previousRoster)
	if err != nil {
		return errOfflinePhotoTrustRotationUnverified
	}
	sum := sha256.Sum256(rosterBytes)
	if candidate.RosterSHA256 != hex.EncodeToString(sum[:]) ||
		candidate.IssuedAt < previousRoster.IssuedAt ||
		candidate.ExpiresAt > previousRoster.ExpiresAt ||
		now < candidate.IssuedAt-offlinePhotoModelExpectedRosterClockSkew ||
		now >= candidate.ExpiresAt ||
		len(candidate.RevokedServerIDs) >= len(previousRoster.ExpectedServerIDs) {
		return errOfflinePhotoTrustRotationUnverified
	}
	for _, revoked := range candidate.RevokedServerIDs {
		found := false
		for _, member := range previousRoster.ExpectedServerIDs {
			if member == revoked {
				found = true
				break
			}
		}
		if !found {
			return errOfflinePhotoTrustRotationUnverified
		}
	}
	message, err := offlinePhotoTrustRotationCanonical(candidate)
	if err != nil {
		return errOfflinePhotoTrustRotationUnverified
	}
	oldSig, err := hex.DecodeString(currentSigHex)
	if err != nil || !ed25519.Verify(pinnedCurrentKey, message, oldSig) {
		return errOfflinePhotoTrustRotationUnverified
	}
	newSig, err := hex.DecodeString(nextSigHex)
	if err != nil || !ed25519.Verify(proposedNextKey, message, newSig) {
		return errOfflinePhotoTrustRotationUnverified
	}
	return nil
}
