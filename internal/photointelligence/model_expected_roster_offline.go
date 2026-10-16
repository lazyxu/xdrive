package photointelligence

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

const (
	offlinePhotoModelExpectedRosterDomain     = "xdrive.photo.expected-roster.v1"
	offlinePhotoModelExpectedRosterMaxMembers = 32
	offlinePhotoModelExpectedRosterMaxTTL     = 300
	offlinePhotoModelExpectedRosterClockSkew  = 5
)

var errOfflinePhotoModelExpectedRosterUnverified = errors.New("offline photo model expected roster unverified")

// OfflinePhotoModelExpectedRosterV1 is a TEST-ONLY, non-deployed candidate
// for an immutable operator-signed expectation. The Server has NO trusted
// signer key, deployment epoch, model-boot provenance or complete fleet roster
// today. A valid signature is NOT proof of an observed live Server/member,
// a held PostgreSQL lease, a model-side enforced permit or safe Host stop.
type OfflinePhotoModelExpectedRosterV1 struct {
	Version           int
	DeploymentEpoch   string
	Revision          int64
	IssuedAt          int64
	ExpiresAt         int64
	ModelBootID       string
	ExpectedServerIDs []string
}

// offlinePhotoModelExpectedRosterCanonical has one strict ASCII wire layout;
// sorted distinct members prevent alternate serializations of the same set.
func offlinePhotoModelExpectedRosterCanonical(r OfflinePhotoModelExpectedRosterV1) ([]byte, error) {
	if r.Version != 1 ||
		!ValidAnalyzerRuntimeInstanceID(r.DeploymentEpoch) ||
		!ValidAnalyzerRuntimeInstanceID(r.ModelBootID) ||
		r.Revision <= 0 || r.Revision >= 1<<60 ||
		r.IssuedAt < 0 || r.ExpiresAt <= r.IssuedAt ||
		r.ExpiresAt-r.IssuedAt > offlinePhotoModelExpectedRosterMaxTTL ||
		len(r.ExpectedServerIDs) < 1 ||
		len(r.ExpectedServerIDs) > offlinePhotoModelExpectedRosterMaxMembers {
		return nil, errOfflinePhotoModelExpectedRosterUnverified
	}
	parts := []string{
		offlinePhotoModelExpectedRosterDomain,
		"1",
		r.DeploymentEpoch,
		strconv.FormatInt(r.Revision, 10),
		strconv.FormatInt(r.IssuedAt, 10),
		strconv.FormatInt(r.ExpiresAt, 10),
		r.ModelBootID,
		strconv.Itoa(len(r.ExpectedServerIDs)),
	}
	previous := ""
	for _, member := range r.ExpectedServerIDs {
		if !ValidAnalyzerRuntimeInstanceID(member) ||
			(previous != "" && member <= previous) {
			return nil, errOfflinePhotoModelExpectedRosterUnverified
		}
		previous = member
		parts = append(parts, member)
	}
	return []byte(strings.Join(parts, "\n") + "\n"), nil
}

// VerifyOfflinePhotoModelExpectedRosterV1 only verifies a signed OFFLINE
// fixture against independently trusted arguments supplied by tests. No
// production key loader, environment flag, database/Host action or API uses
// this function. The expected model boot ID is NOT trustworthy when taken
// merely from the existing analyzer Info self-report.
func VerifyOfflinePhotoModelExpectedRosterV1(
	r OfflinePhotoModelExpectedRosterV1,
	signatureHex string,
	pinnedPublicKey ed25519.PublicKey,
	expectedEpoch, expectedModelBoot, expectedServerID string,
	expectedRevision, now int64,
) error {
	if len(pinnedPublicKey) != ed25519.PublicKeySize ||
		len(signatureHex) != ed25519.SignatureSize*2 ||
		!ValidAnalyzerRuntimeInstanceID(expectedEpoch) ||
		!ValidAnalyzerRuntimeInstanceID(expectedModelBoot) ||
		!ValidAnalyzerRuntimeInstanceID(expectedServerID) ||
		expectedRevision <= 0 || expectedRevision >= 1<<60 || now < 0 {
		return errOfflinePhotoModelExpectedRosterUnverified
	}
	canonical, err := offlinePhotoModelExpectedRosterCanonical(r)
	if err != nil || r.DeploymentEpoch != expectedEpoch ||
		r.ModelBootID != expectedModelBoot || r.Revision != expectedRevision ||
		now < r.IssuedAt-offlinePhotoModelExpectedRosterClockSkew ||
		now >= r.ExpiresAt {
		return errOfflinePhotoModelExpectedRosterUnverified
	}
	// Lowercase-only canonical hex; Go's generic DecodeString would also
	// accept ambiguous uppercase hex spellings.
	for _, c := range signatureHex {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return errOfflinePhotoModelExpectedRosterUnverified
		}
	}
	signature, err := hex.DecodeString(signatureHex)
	if err != nil || !ed25519.Verify(pinnedPublicKey, canonical, signature) {
		return errOfflinePhotoModelExpectedRosterUnverified
	}
	for _, member := range r.ExpectedServerIDs {
		if member == expectedServerID {
			return nil
		}
	}
	return errOfflinePhotoModelExpectedRosterUnverified
}
