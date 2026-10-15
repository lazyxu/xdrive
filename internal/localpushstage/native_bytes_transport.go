package localpushstage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

const localOriginalServerStageMaxBytes = int64(64 << 20)

// LocalOriginalServerStage is an Agent-private, NONCANONICAL temporary upload
// receipt. Even a successful result cannot authorize File, SourceItem, CAS,
// SyncRun, Mirror or a remote deletion. Never serialize this as an IPC DTO.
type LocalOriginalServerStage struct {
	SourceID uint64 `json:"-"`
	Revision uint64 `json:"-"`
	StageID  string `json:"-"`
	Size     int64  `json:"-"`
	SHA256   string `json:"-"`
}

// StageVerifiedNativeOriginalBytes uses native CURRENT journal membership,
// a persisted exact local Root and an authenticated owning-Agent transport.
// It is an Agent-only opt-in primitive and is NOT called by IPC, a scheduler,
// SourceRun or Desktop/Web. No canonical cloud writes are made.
//
// The native file is independently hashed before reservation and then streamed
// from a SECOND securely opened and verified OS handle through a bounded
// io.Pipe into the dedicated owning-device /local-staging endpoint. Exact
// completed stage replay rehashes the native file without a second PUT. Neither
// caller-supplied relative paths nor expected SHA256 are upload authorization;
// the Server still independently checks credentials, Root and Source revision.
// Any failure best-effort cancels the temporary stage. All physical bytes are
// discardable until a future separately audited CAS/SQL canonical commit.
func StageVerifiedNativeOriginalBytes(
	c *client.Client, ctx context.Context, configDir string,
	grant localpush.RootGrant, sourceRevision uint64,
	proof client.LocalBoundSourceProof, relativePath, expectedSHA256 string,
) (LocalOriginalServerStage, error) {
	var empty LocalOriginalServerStage
	if c == nil || ctx == nil || configDir == "" ||
		grant.SourceID == 0 || sourceRevision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.DeviceID != grant.DeviceID || proof.RootID != grant.RootID ||
		proof.RootFingerprint != grant.Fingerprint ||
		relativePath == "" || strings.TrimSpace(expectedSHA256) == "" {
		return empty, errors.New("missing owning Agent, Source or native Root scope")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	var item localpush.InventoryItem
	matches := 0
	current, err := localpush.StreamVerifiedInventoryJournal(
		ctx, configDir, grant, localpush.DefaultInventoryBatchSize,
		func(batch []localpush.InventoryItem) error {
			for _, row := range batch {
				if row.Path != relativePath {
					continue
				}
				matches++
				if matches != 1 {
					return errors.New("ambiguous private CURRENT file membership")
				}
				item = row
			}
			return ctx.Err()
		},
	)
	if err != nil {
		return empty, err
	}
	if matches != 1 || current.MissingInferenceSafe ||
		item.Ignored || item.Kind != "file" ||
		item.Size < 0 || item.Size > localOriginalServerStageMaxBytes ||
		item.NativeIdentity == nil || !item.NativeIdentity.Strong ||
		item.NativeIdentity.LinkCount != 1 {
		return empty, errors.New("unsafe or oversized verified native file")
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", relativePath)
	if err != nil {
		return empty, err
	}
	// First full native pass precedes *any* Server reservation; caller cannot
	// claim guessed original bytes or trust a previous file hash cache.
	before, err := localpush.StreamCurrentInventoryFileToStaging(
		ctx, configDir, grant, current.SnapshotSHA256, relativePath,
		expectedSHA256, io.Discard, nil,
	)
	if err != nil || before.Size != item.Size || before.SHA256 != expectedSHA256 {
		return empty, errors.New("native file content or journal changed before reservation")
	}
	reserved, err := c.ReserveLocalPushStaging(ctx, grant.SourceID, sourceRevision, proof,
		client.LocalPushStagingInput{
			CurrentSnapshotSHA256: current.SnapshotSHA256,
			CurrentPathKey:        key,
			SHA256:                before.SHA256,
			Size:                  before.Size,
		},
	)
	if err != nil {
		return empty, err
	}
	stageAccepted := false
	defer func() {
		if stageAccepted {
			return
		}
		// The caller's context might be cancelled or expired. This is only
		// best-effort temporary cleanup; Server TTL/janitor is the fallback.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = c.CancelLocalPushStaging(
			cleanupCtx, grant.SourceID, sourceRevision, proof, reserved.StageID,
		)
	}()
	switch reserved.Status {
	case "reserved":
		readCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		reader, writer := io.Pipe()
		defer reader.Close()
		type nativeResult struct {
			proof localpush.LocalStagedOriginal
			err   error
		}
		native := make(chan nativeResult, 1)
		go func() {
			got, readErr := localpush.StreamCurrentInventoryFileToStaging(
				readCtx, configDir, grant, current.SnapshotSHA256,
				relativePath, expectedSHA256, writer, nil,
			)
			_ = writer.CloseWithError(readErr)
			native <- nativeResult{proof: got, err: readErr}
		}()
		received, sendErr := c.PutLocalPushStagingBytes(
			readCtx, grant.SourceID, sourceRevision, proof,
			reserved.StageID, before.Size, reader,
		)
		if sendErr != nil {
			cancel()
			_ = reader.CloseWithError(sendErr)
		}
		did := <-native // buffered channel prevents a producer goroutine leak
		if sendErr != nil {
			return empty, sendErr
		}
		if did.err != nil {
			return empty, did.err
		}
		if did.proof.Size != before.Size ||
			did.proof.SHA256 != before.SHA256 ||
			did.proof.SnapshotSHA256 != current.SnapshotSHA256 ||
			received.StageID != reserved.StageID || received.Status != "staged" {
			return empty, errors.New("Agent and temporary Server bytes differ")
		}
	case "staged":
		// Recover an EXACT finished stage after an ambiguous acknowledgment.
		// Rehash the live native original with a second verified file handle,
		// but never issue a second PUT or authorize canonical File/CAS writes.
		rechecked, recheckErr := localpush.StreamCurrentInventoryFileToStaging(
			ctx, configDir, grant, current.SnapshotSHA256,
			relativePath, expectedSHA256, io.Discard, nil,
		)
		if recheckErr != nil || rechecked.Size != before.Size ||
			rechecked.SHA256 != before.SHA256 ||
			rechecked.SnapshotSHA256 != current.SnapshotSHA256 {
			return empty, errors.New("native original or CURRENT generation changed on staged replay")
		}
	default:
		return empty, errors.New("temporary stage cannot be reused in this state")
	}
	// Revisit the physical native generation/Root AFTER the authenticated
	// Server accepted bytes, and repeat Server authorization via status GET.
	latest, err := localpush.VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || latest.SnapshotName != current.SnapshotName ||
		latest.SnapshotSHA256 != current.SnapshotSHA256 ||
		latest.Items != current.Items {
		return empty, errors.New("native CURRENT generation changed during upload")
	}
	after, err := localpush.LoadRootGrant(
		configDir, grant.Server, grant.Account, grant.RootID,
	)
	if err != nil || after.SourceID != grant.SourceID ||
		after.RootID != grant.RootID || after.DeviceID != grant.DeviceID ||
		after.Fingerprint != grant.Fingerprint || after.Path != grant.Path {
		return empty, errors.New("owning native Root grant revoked during upload")
	}
	readback, err := c.ReadLocalPushStaging(
		ctx, grant.SourceID, sourceRevision, proof, reserved.StageID, before.Size,
	)
	if err != nil {
		return empty, err
	}
	if readback.Status != "staged" ||
		readback.StageID != reserved.StageID ||
		readback.Revision != sourceRevision || readback.Size != before.Size {
		return empty, fmt.Errorf("noncanonical Server stage not confirmed")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	// Server staging receipt alone is NOT a real physical-byte observation.
	// Require an independent owning-device preflight of the actual temporary
	// Server file before returning even this NONCANONICAL private receipt.
	// The preflight remains ephemeral, never a CAS or SourceItem commit proof.
	physical, err := c.PreflightLocalPushStagingPhysical(
		ctx, grant.SourceID, sourceRevision, proof, reserved.StageID, before.Size,
	)
	if err != nil {
		return empty, fmt.Errorf("independent temporary physical-byte recheck failed: %w", err)
	}
	if physical.SourceID != grant.SourceID ||
		physical.Revision != sourceRevision || physical.StageID != reserved.StageID ||
		physical.Size != before.Size || !physical.PhysicalStagingMatched ||
		physical.ContentVerified || physical.CommitSupported ||
		physical.Authoritative || physical.MissingInferenceSafe {
		return empty, errors.New("temporary physical-byte result cannot grant canonical authority")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	stageAccepted = true
	return LocalOriginalServerStage{
		SourceID: grant.SourceID, Revision: sourceRevision,
		StageID: reserved.StageID, Size: before.Size, SHA256: before.SHA256,
	}, nil
}
