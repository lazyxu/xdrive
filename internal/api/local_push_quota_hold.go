package api

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// reserveBoundLocalPushQuota is a PRIVATE, stage-scoped quota reservation.
// A true result means only that a bounded owner quota slot was booked; this
// does NOT retain ContentBlob, create a File/SourceItem/Run, or authorize a
// backup. No HTTP, Agent IPC, Renderer, Web or scheduler caller is installed.
// The physical CAS and Stage must already exist and contain matching bytes.
func (s *Server) reserveBoundLocalPushQuota(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
) (bool, error) {
	if s == nil || s.Store == nil {
		return false, errLocalPushStageConflict
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return false, errLocalPushStageConflict
	}
	return s.reserveBoundLocalPushQuotaWithInspector(
		c, sourceID, revision, proof, stageID,
		local.InspectMatchingLocalPushStageAndCASPinned,
	)
}

// Inspector injection is only for failure testing. The production path
// independently hashes both files before/after committing the quota hold.
func (s *Server) reserveBoundLocalPushQuotaWithInspector(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
	inspect func(context.Context, string, string, int64, func(context.Context) error) (bool, error),
) (bool, error) {
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" || inspect == nil {
		return false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return false, errLocalSourceExecutorTransactionUnauthorized
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	tx := s.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return false, tx.Error
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback().Error
		}
	}()

	// Serialize with normal uploads using the SAME owner row lock, taken
	// before device/Source/Root/Stage and CAS locks. The quota snapshot
	// includes all live UploadSessions AND LocalPushQuotaHolds.
	quota, err := s.loadQuotaUsage(tx, userID(c), true)
	if err != nil {
		return false, err
	}
	stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
	if err != nil {
		return false, err
	}
	if stage.Status != localPushStageReady ||
		stage.OwnerID != userID(c) ||
		stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
		!validLocalEvidenceDigest(stage.ContentSHA256) ||
		!validLocalEvidenceDigest(stage.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(stage.CurrentPathKey) ||
		!time.Now().Before(stage.ExpiresAt) {
		return false, errLocalPushStageConflict
	}
	stageKey, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		return false, errLocalPushStageConflict
	}
	casKey, err := storage.ContentAddressedKey(stage.ContentSHA256)
	if err != nil {
		return false, errLocalPushStageConflict
	}
	if err := lockContentHash(tx, stage.ContentSHA256); err != nil {
		return false, err
	}
	var blob meta.ContentBlob
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("sha256 = ?", stage.ContentSHA256).Take(&blob).Error
	if err == nil {
		return false, errLocalPushStageConflict
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	var intent meta.LocalPushCASPrepareIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ?", stage.StageID).Take(&intent).Error; err != nil {
		return false, err
	}
	if !sameLocalPushCASPrepareIntent(intent, stage) {
		return false, errLocalPushStageConflict
	}
	// A dangling File/FileVersion CAS reference with no ContentBlob row
	// cannot be treated as free deduplication or a valid new-content write.
	owned, err := userOwnsStorageKey(tx, stage.OwnerID, casKey)
	if err != nil {
		return false, err
	}
	if owned {
		return false, errLocalPushStageConflict
	}

	var previous meta.LocalPushQuotaHold
	findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("stage_id = ?", stage.StageID).Take(&previous).Error
	newHold := false
	switch {
	case errors.Is(findErr, gorm.ErrRecordNotFound):
		newHold = true
	case findErr == nil:
		if !sameLocalPushQuotaHold(previous, stage) ||
			previous.ReleasedAt != nil || !time.Now().Before(previous.ExpiresAt) {
			return false, errLocalPushStageConflict
		}
	default:
		return false, findErr
	}
	if quota.QuotaBytes < 0 || quota.PhysicalUsedBytes < 0 || quota.ReservedBytes < 0 {
		return false, errLocalPushStageConflict
	}
	if newHold && quota.QuotaBytes > 0 {
		remaining := quota.QuotaBytes - quota.PhysicalUsedBytes
		if remaining < 0 || quota.ReservedBytes > remaining ||
			stage.TotalSize > remaining-quota.ReservedBytes {
			return false, &quotaExceededError{Usage: quota, Additional: stage.TotalSize}
		}
	}

	// Physical admission is try-only while SQL locks are held; no writer or
	// janitor can replace the cooperative CAS/Stage until after the SQL
	// commit. Missing/corrupt bytes or cancellation fail closed.
	created := false
	matched, err := inspect(ctx, stageKey, casKey, stage.TotalSize,
		func(heldCtx context.Context) error {
			if err := heldCtx.Err(); err != nil {
				return err
			}
			if newHold {
				hold := localPushQuotaHoldFromStage(stage)
				if err := tx.Create(&hold).Error; err != nil {
					return err
				}
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			created = newHold
			return nil
		})
	if err != nil || !matched || !committed || ctx.Err() != nil {
		// The after-callback physical rehash may fail even AFTER SQL commit.
		// A booked slot can then persist conservatively until expiry, but
		// cannot be used as backup success or physical proof.
		return false, err
	}
	return created, nil
}

func localPushQuotaHoldFromStage(stage meta.LocalPushStaging) meta.LocalPushQuotaHold {
	return meta.LocalPushQuotaHold{
		StageID: stage.StageID, OwnerID: stage.OwnerID,
		SourceID: stage.SourceID, SourceRevision: stage.SourceRevision,
		DeviceID: stage.DeviceID, RootID: stage.RootID,
		RootFingerprint: stage.RootFingerprint, TargetNodeID: stage.TargetNodeID,
		ContentSHA256: stage.ContentSHA256, Bytes: stage.TotalSize,
		ExpiresAt: stage.ExpiresAt,
	}
}

func sameLocalPushQuotaHold(hold meta.LocalPushQuotaHold, stage meta.LocalPushStaging) bool {
	return hold.StageID == stage.StageID && hold.OwnerID == stage.OwnerID &&
		hold.SourceID == stage.SourceID && hold.SourceRevision == stage.SourceRevision &&
		hold.DeviceID == stage.DeviceID && hold.RootID == stage.RootID &&
		hold.RootFingerprint == stage.RootFingerprint &&
		hold.TargetNodeID == stage.TargetNodeID &&
		hold.ContentSHA256 == stage.ContentSHA256 &&
		hold.Bytes == stage.TotalSize && hold.ExpiresAt.Equal(stage.ExpiresAt)
}
