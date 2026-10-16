package localpush

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

const localFirstDirectoryAdvisoryChallengeTTL = 2 * time.Minute

var errLocalFirstDirectoryAdvisoryProof = errors.New("local first-directory advisory proof unavailable")

// LocalFirstDirectoryAdvisoryChallenge is a PRIVATE, non-routed request to
// authenticate one specific read-only observation. Its fields deliberately
// cannot be serialized as a REST/Agent IPC payload. It is NOT a Server-issued,
// durably tracked, one-use execution ticket yet.
type LocalFirstDirectoryAdvisoryChallenge struct {
	OwnerID         uint64    `json:"-"`
	SourceID        uint64    `json:"-"`
	SourceRevision  uint64    `json:"-"`
	TargetNodeID    uint64    `json:"-"`
	DeviceID        string    `json:"-"`
	RootID          string    `json:"-"`
	RootFingerprint string    `json:"-"`
	Nonce           [32]byte  `json:"-"`
	IssuedAt        time.Time `json:"-"`
	ExpiresAt       time.Time `json:"-"`
}

// LocalFirstDirectoryAdvisorySeal authenticates one native-observation value
// against an exact private challenge and owning-device credential. Even if its
// MAC checks out, NativeObserved remains advisory: no native inode/SQL lifetime
// proof, durable nonce consumption or production backup authority exists.
type LocalFirstDirectoryAdvisorySeal struct {
	Observation LocalFirstDirectoryNativeObservation `json:"-"`
	Tag         [sha256.Size]byte                    `json:"-"`
}

func validLocalFirstDirectoryAdvisoryChallenge(challenge LocalFirstDirectoryAdvisoryChallenge, now time.Time) bool {
	if challenge.OwnerID == 0 || challenge.SourceID == 0 || challenge.SourceRevision == 0 ||
		challenge.TargetNodeID == 0 || !validEvidenceDigest(challenge.RootFingerprint) ||
		challenge.Nonce == ([32]byte{}) || challenge.IssuedAt.IsZero() ||
		challenge.ExpiresAt.IsZero() || now.IsZero() ||
		!challenge.ExpiresAt.After(challenge.IssuedAt) ||
		challenge.ExpiresAt.Sub(challenge.IssuedAt) > localFirstDirectoryAdvisoryChallengeTTL ||
		now.Before(challenge.IssuedAt) || !now.Before(challenge.ExpiresAt) {
		return false
	}
	device, err := uuid.Parse(challenge.DeviceID)
	if err != nil || device.String() != challenge.DeviceID {
		return false
	}
	root, err := uuid.Parse(challenge.RootID)
	return err == nil && root.String() == challenge.RootID
}

// NewLocalFirstDirectoryAdvisoryChallenge mints a random, short-lived PRIVATE
// value. The caller must independently read authoritative Owner/Device/Source/
// Root/revision/target in the Server before providing these inputs. Issuance
// itself is NOT recorded in PostgreSQL and cannot grant permission to commit.
func NewLocalFirstDirectoryAdvisoryChallenge(
	ownerID, sourceID, sourceRevision, targetNodeID uint64,
	deviceID, rootID, fingerprint string, now time.Time,
) (LocalFirstDirectoryAdvisoryChallenge, error) {
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return LocalFirstDirectoryAdvisoryChallenge{}, errLocalFirstDirectoryAdvisoryProof
	}
	challenge := LocalFirstDirectoryAdvisoryChallenge{
		OwnerID: ownerID, SourceID: sourceID, SourceRevision: sourceRevision,
		TargetNodeID: targetNodeID, DeviceID: deviceID, RootID: rootID,
		RootFingerprint: fingerprint, Nonce: nonce,
		IssuedAt: now.UTC(), ExpiresAt: now.UTC().Add(localFirstDirectoryAdvisoryChallengeTTL),
	}
	if !validLocalFirstDirectoryAdvisoryChallenge(challenge, now) {
		return LocalFirstDirectoryAdvisoryChallenge{}, errLocalFirstDirectoryAdvisoryProof
	}
	return challenge, nil
}

func validLocalFirstDirectoryAdvisoryObservation(
	observed LocalFirstDirectoryNativeObservation,
	challenge LocalFirstDirectoryAdvisoryChallenge,
) bool {
	if !observed.NativeObserved || observed.BackupComplete || observed.CommitSupported ||
		observed.Authoritative || observed.MissingInferenceSafe ||
		observed.SourceID != challenge.SourceID ||
		observed.SourceRevision != challenge.SourceRevision ||
		observed.DeviceID != challenge.DeviceID || observed.RootID != challenge.RootID ||
		!validLocalFirstDirectoryName(observed.RelativeDirectory) ||
		!validEvidenceDigest(observed.CurrentPathKey) ||
		!validEvidenceDigest(observed.NativeIdentityKey) ||
		!validEvidenceDigest(observed.PreviousSnapshotSHA256) ||
		!validEvidenceDigest(observed.CurrentSnapshotSHA256) ||
		observed.PreviousSnapshotSHA256 == observed.CurrentSnapshotSHA256 {
		return false
	}
	key, err := LocalInventoryPathKey(
		RootGrant{SourceID: challenge.SourceID, RootID: challenge.RootID},
		"directory", observed.RelativeDirectory,
	)
	return err == nil && key == observed.CurrentPathKey
}

// The length-prefixed, domain-separated MAC includes *every* security scope,
// the exact challenge lifetime, native identity and both sealed generations.
// This is NOT a signature over physical filesystem truth: a stolen device
// credential can still forge a MAC, and no Server nonce ledger exists yet.
func localFirstDirectoryAdvisoryMAC(
	challenge LocalFirstDirectoryAdvisoryChallenge,
	observed LocalFirstDirectoryNativeObservation,
	deviceToken string,
) [sha256.Size]byte {
	mac := hmac.New(sha256.New, []byte(deviceToken))
	_, _ = mac.Write([]byte("xdrive/local-first-directory/advisory-hmac-v1\x00"))
	var u [8]byte
	writeNumber := func(v uint64) {
		binary.BigEndian.PutUint64(u[:], v)
		_, _ = mac.Write(u[:])
	}
	writeString := func(v string) {
		var size [4]byte
		binary.BigEndian.PutUint32(size[:], uint32(len(v)))
		_, _ = mac.Write(size[:])
		_, _ = mac.Write([]byte(v))
	}
	writeNumber(challenge.OwnerID)
	writeNumber(challenge.SourceID)
	writeNumber(challenge.SourceRevision)
	writeNumber(challenge.TargetNodeID)
	writeString(challenge.DeviceID)
	writeString(challenge.RootID)
	writeString(challenge.RootFingerprint)
	_, _ = mac.Write(challenge.Nonce[:])
	writeNumber(uint64(challenge.IssuedAt.UnixNano()))
	writeNumber(uint64(challenge.ExpiresAt.UnixNano()))
	writeString(observed.RelativeDirectory)
	writeString(observed.CurrentPathKey)
	writeString(observed.NativeIdentityKey)
	writeString(observed.PreviousSnapshotSHA256)
	writeString(observed.CurrentSnapshotSHA256)
	var tag [sha256.Size]byte
	copy(tag[:], mac.Sum(nil))
	return tag
}

// SealLocalFirstDirectoryAdvisoryObservation should only be called on the
// owning Agent with its OS-private device credential, AFTER native CURRENT and
// Server scope rechecks. The token, nonce, native key and seal never enter
// Renderer/Web/IPC/logs. Success is NOT permission to write a cloud Node.
func SealLocalFirstDirectoryAdvisoryObservation(
	ctx context.Context,
	observed LocalFirstDirectoryNativeObservation,
	challenge LocalFirstDirectoryAdvisoryChallenge,
	deviceToken string, now time.Time,
) (LocalFirstDirectoryAdvisorySeal, error) {
	if ctx == nil {
		return LocalFirstDirectoryAdvisorySeal{}, errLocalFirstDirectoryAdvisoryProof
	}
	if err := ctx.Err(); err != nil {
		return LocalFirstDirectoryAdvisorySeal{}, err
	}
	if len(deviceToken) < 16 || len(deviceToken) > 512 ||
		strings.TrimSpace(deviceToken) != deviceToken ||
		!validLocalFirstDirectoryAdvisoryChallenge(challenge, now) ||
		!validLocalFirstDirectoryAdvisoryObservation(observed, challenge) {
		return LocalFirstDirectoryAdvisorySeal{}, errLocalFirstDirectoryAdvisoryProof
	}
	tag := localFirstDirectoryAdvisoryMAC(challenge, observed, deviceToken)
	if err := ctx.Err(); err != nil {
		return LocalFirstDirectoryAdvisorySeal{}, err
	}
	return LocalFirstDirectoryAdvisorySeal{Observation: observed, Tag: tag}, nil
}

// VerifyLocalFirstDirectoryAdvisoryObservation checks integrity and scope ONLY.
// Before any future production admission, a separate Server transaction must
// check real token/Root/Source ownership, consume a durable one-use challenge,
// hold a current native-to-SQL lifetime fence, and enforce revocation/CAS.
func VerifyLocalFirstDirectoryAdvisoryObservation(
	ctx context.Context,
	sealed LocalFirstDirectoryAdvisorySeal,
	challenge LocalFirstDirectoryAdvisoryChallenge,
	deviceToken string, now time.Time,
) bool {
	if ctx == nil || ctx.Err() != nil || len(deviceToken) < 16 ||
		len(deviceToken) > 512 || strings.TrimSpace(deviceToken) != deviceToken ||
		!validLocalFirstDirectoryAdvisoryChallenge(challenge, now) ||
		!validLocalFirstDirectoryAdvisoryObservation(sealed.Observation, challenge) {
		return false
	}
	want := localFirstDirectoryAdvisoryMAC(challenge, sealed.Observation, deviceToken)
	return hmac.Equal(want[:], sealed.Tag[:]) && ctx.Err() == nil
}
