package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// localPushStagePhysicalResponse is a point-in-time private observation.
// PhysicalStagingMatched is NOT physical CAS durability, native attestation,
// or authorization for a File/Node/SourceItem/SourceRun write.
type localPushStagePhysicalResponse struct {
	StageID                string `json:"stage_id"`
	SourceID               uint64 `json:"source_id"`
	Revision               uint64 `json:"revision"`
	Size                   int64  `json:"size"`
	PhysicalStagingMatched bool   `json:"physical_staging_matched"`
	ContentVerified        bool   `json:"content_verified"`
	CommitSupported        bool   `json:"commit_supported"`
	Authoritative          bool   `json:"authoritative"`
	MissingInferenceSafe   bool   `json:"missing_inference_safe"`
}

// verifyLocalPushPhysicalStaging hashes the SERVER'S ACTUAL regular staging
// file, not the SHA256 or size claimed by the owning Agent at reservation.
// Read no more than 64MiB+1 in <=256KiB buffers. A fixed, Server-owned UUID
// determines the key, never a user-provided filesystem path.
//
// Unlike canonical CAS objects, temporary stages are not protected by the
// CAS shard lease. This is a read-only, point-in-time observation. The caller
// must repeat the whole credential/Source/Root/stage DB proof AFTER reading
// and an eventual writer needs separate physical lifetime fencing. In-place
// adversarial mutations are detected by digest/mtime/identity/size checks;
// no claim of an immutable or durable content witness is made here.
func verifyLocalPushPhysicalStaging(
	ctx context.Context, local *storage.Local, stage meta.LocalPushStaging,
) error {
	if ctx == nil || local == nil ||
		stage.Status != localPushStageReady ||
		stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
		!validLocalEvidenceDigest(stage.ContentSHA256) ||
		!time.Now().Before(stage.ExpiresAt) {
		return errLocalPushStageConflict
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	key, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		return errLocalPushStageConflict
	}
	full := filepath.Join(local.FilesystemRoot(), filepath.FromSlash(key))
	// Lstat before opening and after reading is required: Local.Open follows
	// symlinks and must not be trusted to validate a physical staging type.
	before, err := os.Lstat(full)
	if err != nil || !before.Mode().IsRegular() || before.Size() != stage.TotalSize {
		return errLocalPushStageConflict
	}
	handle, err := local.Open(ctx, key)
	if err != nil {
		return errLocalPushStageConflict
	}
	defer handle.Close()
	opened, err := handle.Stat()
	if err != nil || !opened.Mode().IsRegular() ||
		!os.SameFile(before, opened) || opened.Size() != stage.TotalSize {
		return errLocalPushStageConflict
	}
	digest := sha256.New()
	count, err := io.CopyBuffer(digest,
		io.LimitReader(contextCASReader{ctx: ctx, src: handle}, stage.TotalSize+1),
		make([]byte, 256<<10))
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errLocalPushStageConflict
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	after, statErr := os.Lstat(full)
	openedAfter, handleErr := handle.Stat()
	if statErr != nil || handleErr != nil ||
		!after.Mode().IsRegular() || !openedAfter.Mode().IsRegular() ||
		!os.SameFile(before, after) || !os.SameFile(opened, openedAfter) ||
		!after.ModTime().Equal(before.ModTime()) ||
		!openedAfter.ModTime().Equal(opened.ModTime()) ||
		after.Size() != stage.TotalSize || openedAfter.Size() != stage.TotalSize ||
		count != stage.TotalSize ||
		hex.EncodeToString(digest.Sum(nil)) != stage.ContentSHA256 {
		return errLocalPushStageConflict
	}
	return ctx.Err()
}

func sameLocalPushPhysicalScope(first, second meta.LocalPushStaging) bool {
	return first.SourceID == second.SourceID &&
		first.StageID == second.StageID && first.OwnerID == second.OwnerID &&
		first.SourceRevision == second.SourceRevision &&
		first.DeviceID == second.DeviceID && first.RootID == second.RootID &&
		first.RootFingerprint == second.RootFingerprint &&
		first.TargetNodeID == second.TargetNodeID &&
		first.CurrentSnapshotSHA256 == second.CurrentSnapshotSHA256 &&
		first.CurrentPathKey == second.CurrentPathKey &&
		first.ContentSHA256 == second.ContentSHA256 &&
		first.TotalSize == second.TotalSize &&
		first.Status == localPushStageReady &&
		second.Status == localPushStageReady &&
		first.ExpiresAt.Equal(second.ExpiresAt)
}

// preflightLocalPushStagePhysical is owning-Agent-only, read-only and
// explicitly NONAUTHORITATIVE. Successful readback never publishes a CAS or
// cloud File. No generic owner-JWT upload session can call this endpoint.
func (s *Server) preflightLocalPushStagePhysical(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		fail(c, http.StatusServiceUnavailable, "physical temporary storage unavailable")
		return
	}
	readCtx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	c.Request = c.Request.WithContext(readCtx)

	check := func() (meta.LocalPushStaging, error) {
		var stage meta.LocalPushStaging
		err := s.DB.WithContext(readCtx).Transaction(func(tx *gorm.DB) error {
			var err error
			stage, err = s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
			if err != nil {
				return err
			}
			if stage.Status != localPushStageReady {
				return errLocalPushStageConflict
			}
			return readCtx.Err()
		})
		return stage, err
	}
	first, err := check()
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if err := verifyLocalPushPhysicalStaging(readCtx, local, first); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			fail(c, http.StatusServiceUnavailable, "physical staging verification interrupted")
		} else {
			fail(c, http.StatusConflict, "physical staging bytes do not match")
		}
		return
	}
	// Native device revocation, Source revision/target changes, cancel and
	// status replacement between transactions must NEVER produce success.
	second, err := check()
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if !sameLocalPushPhysicalScope(first, second) || readCtx.Err() != nil {
		fail(c, http.StatusConflict, "temporary stage changed during physical verification")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushStagePhysicalResponse{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		Size: first.TotalSize, PhysicalStagingMatched: true,
		ContentVerified: false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
