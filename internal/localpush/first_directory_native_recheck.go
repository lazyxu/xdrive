package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// LocalFirstDirectoryNativeRecheckRequest is an Agent-private read selector.
// The expected digests/name are comparisons, never permission to write a Node.
type LocalFirstDirectoryNativeRecheckRequest struct {
	SourceID                  uint64
	SourceRevision            uint64
	PreviousSnapshotSHA256    string
	CurrentSnapshotSHA256     string
	RelativeDirectory         string
	ExpectedNativeIdentityKey string
}

// LocalFirstDirectoryNativeObservation is intentionally private in JSON.
// This is ephemeral evidence, not a CAS/SQL lease or durable backup receipt.
type LocalFirstDirectoryNativeObservation struct {
	SourceID               uint64 `json:"-"`
	SourceRevision         uint64 `json:"-"`
	DeviceID               string `json:"-"`
	RootID                 string `json:"-"`
	RelativeDirectory      string `json:"-"`
	CurrentPathKey         string `json:"-"`
	NativeIdentityKey      string `json:"-"`
	PreviousSnapshotSHA256 string `json:"-"`
	CurrentSnapshotSHA256  string `json:"-"`
	NativeObserved         bool   `json:"-"`
	CommitSupported        bool   `json:"-"`
	BackupComplete         bool   `json:"-"`
	Authoritative          bool   `json:"-"`
	MissingInferenceSafe   bool   `json:"-"`
}

func validLocalFirstDirectoryName(name string) bool {
	if name == "" || len(name) > 255 || strings.TrimSpace(name) != name ||
		strings.ContainsAny(name, "/\\:\x00\r\n") || name == "." || name == ".." {
		return false
	}
	normalized, err := sourcepkg.NormalizeRelativePath(name)
	return err == nil && normalized == name
}

func readCurrentNativeFirstDirectory(grant RootGrant, name string) (*InventoryNativeIdentity, error) {
	path := filepath.Join(grant.Path, name)
	info, err := os.Lstat(path)
	if err != nil || info == nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrRootChanged
	}
	native, err := readInventoryNativeIdentity(grant.RootID, path, info)
	if err != nil || native == nil || !native.Strong || !native.RenameCandidate ||
		native.LinkCount == 0 || !validEvidenceDigest(native.Key) {
		return nil, ErrRootChanged
	}
	return native, nil
}

// RecheckLocalFirstDirectoryNative observes one direct-child directory ONLY.
// The owning Agent must independently authenticate current Source/Root/revision
// against the Server at any future call boundary. This helper verifies its
// locally registered Root, two sealed inventory generations and full CURRENT
// stream, and double-reads the real strong native directory identity. There is
// NO Server Router, IPC, Renderer, watcher or SourceRun caller. This observation
// cannot be used to authorize commitBoundLocalPushFirstDirectory: a native/SQL
// cross-process lifetime and provenance protocol is still missing.
func RecheckLocalFirstDirectoryNative(
	ctx context.Context, configDir string, grant RootGrant,
	request LocalFirstDirectoryNativeRecheckRequest,
) (LocalFirstDirectoryNativeObservation, error) {
	var empty LocalFirstDirectoryNativeObservation
	deny := func(err error) (LocalFirstDirectoryNativeObservation, error) {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return empty, err
		}
		return empty, errors.New("owning native first directory unavailable")
	}
	if ctx == nil || request.SourceID == 0 || request.SourceID != grant.SourceID ||
		request.SourceRevision == 0 || !grant.StrongIdentity ||
		!validLocalFirstDirectoryName(request.RelativeDirectory) ||
		!validEvidenceDigest(request.PreviousSnapshotSHA256) ||
		!validEvidenceDigest(request.CurrentSnapshotSHA256) ||
		request.CurrentSnapshotSHA256 == request.PreviousSnapshotSHA256 ||
		!validEvidenceDigest(request.ExpectedNativeIdentityKey) {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny(err)
	}
	generation, err := LoadLocalReconcileEvidence(ctx, configDir, grant, request.SourceRevision)
	if err != nil {
		return deny(err)
	}
	if generation.SourceID != request.SourceID ||
		generation.PreviousSHA256 != request.PreviousSnapshotSHA256 ||
		generation.CurrentSHA256 != request.CurrentSnapshotSHA256 ||
		generation.Authoritative || generation.MissingInferenceSafe {
		return deny(nil)
	}
	pathKey, err := LocalInventoryPathKey(grant, "directory", request.RelativeDirectory)
	if err != nil {
		return deny(err)
	}
	var matches int
	snapshot, err := StreamVerifiedInventoryJournal(ctx, configDir, grant, DefaultInventoryBatchSize,
		func(rows []InventoryItem) error {
			for _, row := range rows {
				if row.Path != request.RelativeDirectory {
					continue
				}
				matches++
				if matches != 1 || row.Kind != "directory" || row.Size != 0 || row.Ignored ||
					row.NativeIdentity == nil || !row.NativeIdentity.Strong ||
					!row.NativeIdentity.RenameCandidate || row.NativeIdentity.LinkCount == 0 ||
					row.NativeIdentity.Key != request.ExpectedNativeIdentityKey {
					return errors.New("first directory CURRENT identity mismatch")
				}
			}
			return ctx.Err()
		})
	if err != nil {
		return deny(err)
	}
	if matches != 1 || snapshot.SnapshotName != generation.CurrentSnapshot ||
		snapshot.SnapshotSHA256 != generation.CurrentSHA256 ||
		snapshot.Items != generation.CurrentItems {
		return deny(nil)
	}
	first, err := readCurrentNativeFirstDirectory(grant, request.RelativeDirectory)
	if err != nil || first.Key != request.ExpectedNativeIdentityKey {
		return deny(err)
	}
	after, err := LoadLocalReconcileEvidence(ctx, configDir, grant, request.SourceRevision)
	if err != nil || after.IntegritySHA256 != generation.IntegritySHA256 ||
		after.PreviousSnapshot != generation.PreviousSnapshot ||
		after.CurrentSnapshot != generation.CurrentSnapshot ||
		after.PreviousSHA256 != generation.PreviousSHA256 ||
		after.CurrentSHA256 != generation.CurrentSHA256 {
		return deny(err)
	}
	second, err := readCurrentNativeFirstDirectory(grant, request.RelativeDirectory)
	if err != nil || second.Key != first.Key || second.LinkCount != first.LinkCount {
		return deny(err)
	}
	stored, err = LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny(err)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	return LocalFirstDirectoryNativeObservation{
		SourceID: request.SourceID, SourceRevision: request.SourceRevision,
		DeviceID: grant.DeviceID, RootID: grant.RootID,
		RelativeDirectory: request.RelativeDirectory,
		CurrentPathKey:    pathKey, NativeIdentityKey: first.Key,
		PreviousSnapshotSHA256: generation.PreviousSHA256,
		CurrentSnapshotSHA256:  generation.CurrentSHA256,
		NativeObserved:         true, CommitSupported: false, BackupComplete: false,
		Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
