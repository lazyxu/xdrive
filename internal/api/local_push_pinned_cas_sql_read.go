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

// inspectQuarantinedBoundLocalPushCASPinnedSQL is an INTERNAL, READ-ONLY
// prerequisite for a future transactional writer. It holds the exact owning
// device/Source/Root/Stage, CAS hash and quarantine SQL locks while verifying
// BOTH physical stage and CAS bytes under nonblocking CAS-first/Stage-second
// Local Store pins. The pins remain held until the read-only transaction has
// committed. No durable File, SourceItem, CAS reference, quota or Run is made.
func (s *Server) inspectQuarantinedBoundLocalPushCASPinnedSQL(
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
	return s.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReader(
		c, sourceID, revision, proof, stageID,
		local.InspectMatchingLocalPushStageAndCASPinned,
	)
}

// inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL adds a preliminary,
// transaction-scoped user quota/headroom check to the existing private pinned
// physical and SQL read window. The user's row is locked FIRST, before any
// device/Source/CAS locks, to follow normal upload's user-before-CAS order.
// It does not reserve bytes or write canonical records; the eventual writer
// must recheck quota and reserve/commit references atomically.
func (s *Server) inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
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
	return s.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota(
		c, sourceID, revision, proof, stageID,
		local.InspectMatchingLocalPushStageAndCASPinned, true,
	)
}

// Reader injection is unexported and exercises SQL/OS lock order and failed
// admission. The production reader physically hashes BOTH files twice; a
// synthetic reader result is NEVER accepted as a content/commit witness.
func (s *Server) inspectQuarantinedBoundLocalPushCASPinnedSQLWithReader(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
	inspect func(context.Context, string, string, int64, func(context.Context) error) (bool, error),
) (bool, error) {
	return s.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota(
		c, sourceID, revision, proof, stageID, inspect, false,
	)
}

// inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota is an
// internal read-only variant. A production writer MUST NOT reuse its positive
// return as a quota reservation or physical commit ticket.
func (s *Server) inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
	inspect func(context.Context, string, string, int64, func(context.Context) error) (bool, error),
	checkQuota bool,
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

	var quota quotaUsageDTO
	if checkQuota {
		// Generic upload quota writers lock User before CAS. Acquiring the
		// identical user row FIRST avoids inverting that lock order.
		var quotaErr error
		quota, quotaErr = s.loadQuotaUsage(tx, userID(c), true)
		if quotaErr != nil {
			return false, quotaErr
		}
	}
	stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
	if err != nil {
		return false, err
	}
	if stage.Status != localPushStageReady || stage.TotalSize < 0 ||
		stage.TotalSize > localPushStageMaxBytes ||
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
	// Existing CAS GC and retention paths lock the canonical SHA256 BEFORE
	// ContentBlob metadata. No OS lock is acquired until AFTER the SQL scope
	// is settled; OS admission is try-only to avoid SQL/OS inversion.
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
	if checkQuota {
		if stage.OwnerID != userID(c) || quota.QuotaBytes < 0 ||
			quota.PhysicalUsedBytes < 0 || quota.ReservedBytes < 0 {
			return false, errLocalPushStageConflict
		}
		// A File/FileVersion referencing CAS with no ContentBlob is corrupt
		// canonical metadata. Never treat it as "already paid" content.
		owned, err := userOwnsStorageKey(tx, stage.OwnerID, casKey)
		if err != nil {
			return false, err
		}
		if owned {
			return false, errLocalPushStageConflict
		}
		if quota.QuotaBytes > 0 {
			available := quota.QuotaBytes - quota.PhysicalUsedBytes
			if available < 0 || quota.ReservedBytes > available ||
				stage.TotalSize > available-quota.ReservedBytes {
				return false, &quotaExceededError{
					Usage: quota, Additional: stage.TotalSize,
				}
			}
		}
	}

	// The last read-only SQL COMMIT runs INSIDE the physical pair's pinned
	// observation callback. No SQL mutator may be placed here until a
	// separate quota/refcount/File/SourceItem crash-recovery design is proven.
	callbackRan := false
	matched, err := inspect(ctx, stageKey, casKey, stage.TotalSize,
		func(heldCtx context.Context) error {
			if err := heldCtx.Err(); err != nil {
				return err
			}
			callbackRan = true
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			return nil
		})
	if err != nil || !matched {
		return false, err // OS contention yields false,nil, never authority
	}
	if !callbackRan || !committed || ctx.Err() != nil {
		return false, errLocalPushStageConflict
	}
	// No result can be reused as authority. The next stage must repeat
	// these checks inside its own audited, idempotent write transaction.
	return true, nil
}
