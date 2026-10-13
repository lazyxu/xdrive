package localpush

import (
	"context"
	"errors"
)

// LocalIdentityNativeRecheckRequest is an Agent-private, one-file expected
// state. Its digests are comparison inputs, NOT Server authorization tokens.
// A caller must first authenticate its owning Agent session and Source/Root
// revision against the Server; this library cannot attest that authority.
type LocalIdentityNativeRecheckRequest struct {
	SourceID               uint64
	SourceRevision         uint64
	PreviousSnapshotSHA256 string
	CurrentSnapshotSHA256  string
	Candidate              LocalEvidenceContentCandidate
	ExpectedSHA256         string
	ExpectedSize           int64
}

// LocalIdentityNativeObservation remains private to the native process.
// Every field is excluded from JSON, including the reconstructed relative
// path and local Root/device identifiers. Never log or cache this observation
// or use it as a reusable authorization token; another file/Root/generation
// change can invalidate it immediately after this function returns.
type LocalIdentityNativeObservation struct {
	SourceID               uint64 `json:"-"`
	SourceRevision         uint64 `json:"-"`
	DeviceID               string `json:"-"`
	RootID                 string `json:"-"`
	PreviousSnapshotSHA256 string `json:"-"`
	CurrentSnapshotSHA256  string `json:"-"`
	CurrentRelativePath    string `json:"-"`
	SHA256                 string `json:"-"`
	Size                   int64  `json:"-"`
}

const maxLocalIdentityNativeRecheckBytes = int64(64 << 20)

func sameLocalIdentityRoot(a, b RootGrant) bool {
	return a.Server == b.Server && a.Account == b.Account &&
		a.SourceID == b.SourceID && a.DeviceID == b.DeviceID &&
		a.RootID == b.RootID && a.Path == b.Path &&
		a.Fingerprint == b.Fingerprint && a.StrongIdentity == b.StrongIdentity
}

// RecheckLocalIdentityNativeCandidate is a bounded, owning-Agent-only
// read of an actual original file immediately before a FUTURE, separately
// authenticated content/identity transaction. It requires the locally
// persisted Root grant, both exact sealed inventory generations, a unique
// strong single-link native identity and a live file-handle SHA256/size
// matching the expected canonical bytes. Root grant and generations are
// checked AGAIN after the byte read. No Source/Node/CAS/Run is written.
//
// The result is a point-in-time NATIVE observation, not a physical remote
// CAS lease, cryptographic hardware attestation, durable upload or SQL
// writer witness. It is deliberately not attached to HTTP, Go Client,
// Electron/Agent IPC or a running Source executor in this phase.
func RecheckLocalIdentityNativeCandidate(
	ctx context.Context, configDir string, grant RootGrant,
	request LocalIdentityNativeRecheckRequest,
) (LocalIdentityNativeObservation, error) {
	var empty LocalIdentityNativeObservation
	if ctx == nil || request.SourceID == 0 || request.SourceID != grant.SourceID ||
		request.SourceRevision == 0 || request.ExpectedSize < 0 ||
		request.ExpectedSize > maxLocalIdentityNativeRecheckBytes ||
		!validEvidenceDigest(request.PreviousSnapshotSHA256) ||
		!validEvidenceDigest(request.CurrentSnapshotSHA256) ||
		request.PreviousSnapshotSHA256 == request.CurrentSnapshotSHA256 ||
		!validEvidenceDigest(request.ExpectedSHA256) ||
		!validLocalEvidenceContentCandidates([]LocalEvidenceContentCandidate{request.Candidate}) {
		return empty, errors.New("invalid bounded private native identity recheck")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	// A caller-created RootGrant, even with a matching fingerprint, is not
	// enough. The native installation must still have the exact approved
	// grant persisted in this account/server's local registry.
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return empty, errors.New("owning Root grant unavailable or changed")
	}
	before, err := LoadLocalReconcileEvidence(ctx, configDir, grant, request.SourceRevision)
	if err != nil {
		return empty, err
	}
	if before.SourceID != request.SourceID ||
		before.PreviousSHA256 != request.PreviousSnapshotSHA256 ||
		before.CurrentSHA256 != request.CurrentSnapshotSHA256 ||
		before.Authoritative || before.MissingInferenceSafe {
		return empty, errors.New("private inventory generation does not match expected identity")
	}

	batch, err := HashCurrentLocalEvidenceBatch(ctx, configDir, grant,
		request.SourceRevision, []LocalEvidenceContentCandidate{request.Candidate})
	if err != nil {
		return empty, err
	}
	if len(batch.Digests) != 1 || batch.CloudContentVerified ||
		batch.Authoritative || batch.MissingInferenceSafe ||
		batch.Digests[0].SHA256 != request.ExpectedSHA256 ||
		batch.Digests[0].Size != request.ExpectedSize ||
		batch.HashedBytes != request.ExpectedSize {
		return empty, errors.New("live native content does not match expected canonical bytes")
	}
	key, err := LocalInventoryPathKey(grant, "file", batch.Digests[0].CurrentRelativePath)
	if err != nil || key != request.Candidate.CurrentPathKey {
		return empty, errors.New("current native relative path changed")
	}
	// Recheck the persisted grant and both sealed journals after reading
	// bytes. This is deliberately a *freshness check*, not a file lease.
	stored, err = LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return empty, errors.New("owning Root grant changed during native recheck")
	}
	after, err := LoadLocalReconcileEvidence(ctx, configDir, grant, request.SourceRevision)
	if err != nil {
		return empty, err
	}
	if before.IntegritySHA256 != after.IntegritySHA256 ||
		before.PreviousSHA256 != after.PreviousSHA256 ||
		before.CurrentSHA256 != after.CurrentSHA256 ||
		before.PreviousSnapshot != after.PreviousSnapshot ||
		before.CurrentSnapshot != after.CurrentSnapshot {
		return empty, errors.New("private inventory generation changed during native recheck")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalIdentityNativeObservation{
		SourceID: request.SourceID, SourceRevision: request.SourceRevision,
		DeviceID: grant.DeviceID, RootID: grant.RootID,
		PreviousSnapshotSHA256: before.PreviousSHA256,
		CurrentSnapshotSHA256:  after.CurrentSHA256,
		CurrentRelativePath:    batch.Digests[0].CurrentRelativePath,
		SHA256:                 batch.Digests[0].SHA256, Size: batch.Digests[0].Size,
	}, nil
}
