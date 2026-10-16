package photointelligence

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

const (
	offlinePhotoModelMemberPreparedDomain = "xdrive.photo.member-prepared.v1"
	offlinePhotoModelMemberPreparedMode   = "prepared-v1"
	offlinePhotoModelMemberPreparedMaxTTL = 30
)

var errOfflinePhotoModelMemberPreparedUnverified = errors.New("offline photo model member preparation unverified")

// Nine fixed execution routes, not Info or Host Apply ACK. The separate Desktop
// source registry verifies these still correspond to the actual Go/Python paths.
var offlinePhotoModelExpectedExecutionRoutes = [...]string{
	"GET /v1/creative-cutout-canary",
	"GET /v1/face-detector-canary",
	"GET /v1/semantic-image-canary",
	"GET /v1/smart-model-canary",
	"POST /v1/analyze",
	"POST /v1/creative-generate",
	"POST /v1/semantic-image",
	"POST /v1/semantic-text",
	"POST /v1/smart-analyze",
}

func offlinePhotoModelExpectedRouteDigest() string {
	sum := sha256.Sum256([]byte(strings.Join(offlinePhotoModelExpectedExecutionRoutes[:], "\n") + "\n"))
	return hex.EncodeToString(sum[:])
}

// OfflinePhotoModelMemberPreparedV1 is a signed, test-only capability CLAIM.
// It is not a runtime attestation, actual permit, or proof of an in-flight
// PostgreSQL lease; the offline test signer is not deployed to any Server.
type OfflinePhotoModelMemberPreparedV1 struct {
	Version         int
	DeploymentEpoch string
	ModelBootID     string
	ServerID        string
	Revision        int64
	RosterSHA256    string
	IssuedAt        int64
	ExpiresAt       int64
	Nonce           string
	Mode            string
	RoutesSHA256    string
}

type OfflinePhotoModelSignedMemberPreparedV1 struct {
	Claim        OfflinePhotoModelMemberPreparedV1
	SignatureHex string
}

func offlinePhotoModelMemberPreparedCanonical(c OfflinePhotoModelMemberPreparedV1) ([]byte, error) {
	if c.Version != 1 || !ValidAnalyzerRuntimeInstanceID(c.DeploymentEpoch) ||
		!ValidAnalyzerRuntimeInstanceID(c.ModelBootID) ||
		!ValidAnalyzerRuntimeInstanceID(c.ServerID) ||
		c.Revision <= 0 || c.Revision >= 1<<60 ||
		!offlinePhotoModelLowerHex(c.RosterSHA256, 64) ||
		c.IssuedAt < 0 || c.ExpiresAt <= c.IssuedAt ||
		c.ExpiresAt-c.IssuedAt > offlinePhotoModelMemberPreparedMaxTTL ||
		!ValidAnalyzerRuntimeInstanceID(c.Nonce) ||
		c.Mode != offlinePhotoModelMemberPreparedMode ||
		c.RoutesSHA256 != offlinePhotoModelExpectedRouteDigest() {
		return nil, errOfflinePhotoModelMemberPreparedUnverified
	}
	return []byte(strings.Join([]string{
		offlinePhotoModelMemberPreparedDomain,
		"1", c.DeploymentEpoch, c.ModelBootID, c.ServerID,
		strconv.FormatInt(c.Revision, 10), c.RosterSHA256,
		strconv.FormatInt(c.IssuedAt, 10), strconv.FormatInt(c.ExpiresAt, 10),
		c.Nonce, c.Mode, c.RoutesSHA256,
	}, "\n") + "\n"), nil
}

func offlinePhotoModelLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for i := 0; i < len(value); i++ {
		if c := value[i]; !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// VerifyOfflinePhotoModelAllMembersPreparedV1 accepts ONLY fixture-pinned
// operator and per-Server Ed25519 public keys. It requires ONE signed claim
// per expected Server, identical roster digest, model boot, epoch, revision,
// and full nine-route capability claim. It NEVER authorizes runtime rollout,
// model admission, a Host stop/restart/freeze, or a positive UI status.
// Missing older peers or an inconsistent report must fail closed.
func VerifyOfflinePhotoModelAllMembersPreparedV1(
	roster OfflinePhotoModelExpectedRosterV1,
	rosterSignature string,
	pinnedOperator ed25519.PublicKey,
	trustedEpoch, trustedModelBoot string,
	trustedRevision, now int64,
	pinnedMembers map[string]ed25519.PublicKey,
	reports map[string]OfflinePhotoModelSignedMemberPreparedV1,
) error {
	canonicalRoster, err := offlinePhotoModelExpectedRosterCanonical(roster)
	if err != nil || len(pinnedOperator) != ed25519.PublicKeySize ||
		len(pinnedMembers) != len(roster.ExpectedServerIDs) ||
		len(reports) != len(roster.ExpectedServerIDs) {
		return errOfflinePhotoModelMemberPreparedUnverified
	}
	rosterHash := sha256.Sum256(canonicalRoster)
	rosterDigest := hex.EncodeToString(rosterHash[:])
	seenKeys := make(map[string]struct{}, len(roster.ExpectedServerIDs))
	for _, serverID := range roster.ExpectedServerIDs {
		if err := VerifyOfflinePhotoModelExpectedRosterV1(
			roster, rosterSignature, pinnedOperator, trustedEpoch,
			trustedModelBoot, serverID, trustedRevision, now,
		); err != nil {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
		key, hasKey := pinnedMembers[serverID]
		report, hasReport := reports[serverID]
		if !hasKey || !hasReport || len(key) != ed25519.PublicKeySize ||
			bytes.Equal(key, pinnedOperator) {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
		keyID := string(key)
		if _, duplicate := seenKeys[keyID]; duplicate {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
		seenKeys[keyID] = struct{}{}
		c := report.Claim
		if c.ServerID != serverID || c.DeploymentEpoch != trustedEpoch ||
			c.ModelBootID != trustedModelBoot || c.Revision != trustedRevision ||
			c.RosterSHA256 != rosterDigest ||
			c.IssuedAt < roster.IssuedAt || c.ExpiresAt > roster.ExpiresAt ||
			now < c.IssuedAt-offlinePhotoModelExpectedRosterClockSkew || now >= c.ExpiresAt ||
			!offlinePhotoModelLowerHex(report.SignatureHex, ed25519.SignatureSize*2) {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
		canonicalReport, err := offlinePhotoModelMemberPreparedCanonical(c)
		if err != nil {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
		signature, err := hex.DecodeString(report.SignatureHex)
		if err != nil || !ed25519.Verify(key, canonicalReport, signature) {
			return errOfflinePhotoModelMemberPreparedUnverified
		}
	}
	return nil
}
