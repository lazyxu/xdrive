package localpushstage

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

// LocalNativePrecommitObservation is ephemeral and never backup completion.
// Even two equal observations leave a TOCTOU window before any CAS/SQL commit.
type LocalNativePrecommitObservation struct {
	NativeMatched        bool `json:"-"`
	PhysicalStageMatched bool `json:"-"`
	CommitSupported      bool `json:"-"`
	Authoritative        bool `json:"-"`
	MissingInferenceSafe bool `json:"-"`
}

func localPrecommitDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		b := value[i]
		if (b < '0' || b > '9') && (b < 'a' || b > 'f') {
			return false
		}
	}
	return true
}

func localPrecommitRootCurrent(configDir string, grant localpush.RootGrant) bool {
	if err := localpush.VerifyRootGrant(grant); err != nil {
		return false
	}
	saved, err := localpush.LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	return err == nil && saved.Server == grant.Server &&
		saved.Account == grant.Account && saved.SourceID == grant.SourceID &&
		saved.DeviceID == grant.DeviceID && saved.RootID == grant.RootID &&
		saved.Path == grant.Path && saved.Fingerprint == grant.Fingerprint &&
		saved.StrongIdentity == grant.StrongIdentity &&
		saved.CreatedAt.Equal(grant.CreatedAt)
}

// PreflightStagedNativeOriginalForCommit is owning-Agent-only, UNROUTED and
// READ-ONLY. It rechecks the sealed CURRENT native original and independent
// Server temporary physical bytes without POST, PUT, DELETE or a SourceRun.
// This function does NOT pin either file through a future canonical commit.
// A later writer MUST independently authorize Device, Root, Source revision,
// quarantine, CAS hash and physical bytes within its own transaction.
func PreflightStagedNativeOriginalForCommit(
	c *client.Client, ctx context.Context, configDir string,
	grant localpush.RootGrant, revision uint64, proof client.LocalBoundSourceProof,
	staged LocalOriginalServerStage, relativePath string,
) (LocalNativePrecommitObservation, error) {
	var empty LocalNativePrecommitObservation
	if c == nil || ctx == nil || configDir == "" || relativePath == "" ||
		revision == 0 || grant.SourceID == 0 ||
		staged.SourceID != grant.SourceID || staged.Revision != revision ||
		staged.Size < 0 || staged.Size > localOriginalServerStageMaxBytes ||
		!localPrecommitDigest(staged.SHA256) ||
		!localPrecommitDigest(staged.SnapshotSHA256) ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.DeviceID != grant.DeviceID || proof.RootID != grant.RootID ||
		proof.RootFingerprint != grant.Fingerprint {
		return empty, errors.New("invalid owning-Agent native Stage precommit scope")
	}
	id, err := uuid.Parse(staged.StageID)
	if err != nil || id.String() != staged.StageID {
		return empty, errors.New("invalid private precommit Stage ID")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if !localPrecommitRootCurrent(configDir, grant) {
		return empty, errors.New("owning native Root grant not current")
	}
	before, err := localpush.VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || before.MissingInferenceSafe ||
		before.SnapshotSHA256 != staged.SnapshotSHA256 {
		return empty, errors.New("sealed CURRENT inventory differs from staged generation")
	}
	nativeBefore, err := localpush.StreamCurrentInventoryFileToStaging(
		ctx, configDir, grant, staged.SnapshotSHA256, relativePath,
		staged.SHA256, io.Discard, nil,
	)
	if err != nil || nativeBefore.Size != staged.Size ||
		nativeBefore.SHA256 != staged.SHA256 ||
		nativeBefore.SnapshotSHA256 != staged.SnapshotSHA256 {
		return empty, errors.New("native original no longer matches staged bytes")
	}
	status, err := c.ReadLocalPushStaging(
		ctx, staged.SourceID, revision, proof, staged.StageID, staged.Size,
	)
	if err != nil || status.Status != "staged" ||
		!time.Now().Before(status.ExpiresAt) ||
		status.ContentVerified || status.CommitSupported ||
		status.Authoritative || status.MissingInferenceSafe {
		return empty, errors.New("owning Server Stage no longer valid")
	}
	physical, err := c.PreflightLocalPushStagingPhysical(
		ctx, staged.SourceID, revision, proof, staged.StageID, staged.Size,
	)
	if err != nil || !physical.PhysicalStagingMatched ||
		physical.SourceID != staged.SourceID ||
		physical.Revision != revision || physical.StageID != staged.StageID ||
		physical.Size != staged.Size || physical.ContentVerified ||
		physical.CommitSupported || physical.Authoritative ||
		physical.MissingInferenceSafe {
		return empty, errors.New("private Server Stage physical bytes not verified")
	}
	// A local edit, Root revocation or journal rotation during the network
	// request invalidates the observation before any future writer sees it.
	nativeAfter, err := localpush.StreamCurrentInventoryFileToStaging(
		ctx, configDir, grant, staged.SnapshotSHA256, relativePath,
		staged.SHA256, io.Discard, nil,
	)
	if err != nil || nativeAfter != nativeBefore {
		return empty, errors.New("native original changed during Stage precommit")
	}
	after, err := localpush.VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || after.MissingInferenceSafe ||
		after.SnapshotName != before.SnapshotName ||
		after.SnapshotSHA256 != before.SnapshotSHA256 ||
		after.Items != before.Items || after.Bytes != before.Bytes ||
		!localPrecommitRootCurrent(configDir, grant) {
		return empty, errors.New("native CURRENT or Root changed during Stage precommit")
	}
	// Narrow, never close, the network-to-SQL commit window.
	status, err = c.ReadLocalPushStaging(
		ctx, staged.SourceID, revision, proof, staged.StageID, staged.Size,
	)
	if err != nil || status.Status != "staged" ||
		!time.Now().Before(status.ExpiresAt) ||
		status.ContentVerified || status.CommitSupported ||
		status.Authoritative || status.MissingInferenceSafe ||
		ctx.Err() != nil {
		return empty, errors.New("owning Stage lost authorization or expired")
	}
	return LocalNativePrecommitObservation{
		NativeMatched: true, PhysicalStageMatched: true,
		CommitSupported: false, Authoritative: false,
		MissingInferenceSafe: false,
	}, nil
}
