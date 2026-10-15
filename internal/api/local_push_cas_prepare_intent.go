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

// quarantineBoundLocalPushCASPrepareIntent writes ONE private idempotent
// intent to inspect a staged new-content candidate later. This does NOT
// invoke storage I/O, materialize a CAS object, charge quota, publish content
// metadata, or activate Push. It has no REST, Client, Agent IPC or UI caller.
// In particular, persisted quarantine is not an upload/completion ticket.
func (s *Server) quarantineBoundLocalPushCASPrepareIntent(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
) (created bool, err error) {
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" {
		return false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return false, errLocalSourceExecutorTransactionUnauthorized
	}
	if _, err := localPushStageStoreKey(stageID); err != nil {
		return false, errLocalPushStageConflict
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil {
			return err
		}
		if stage.Status != localPushStageReady ||
			stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
			!validLocalEvidenceDigest(stage.ContentSHA256) ||
			!validLocalEvidenceDigest(stage.CurrentSnapshotSHA256) ||
			!validLocalEvidenceDigest(stage.CurrentPathKey) ||
			!time.Now().Before(stage.ExpiresAt) {
			return errLocalPushStageConflict
		}
		if _, err := storage.ContentAddressedKey(stage.ContentSHA256); err != nil {
			return errLocalPushStageConflict
		}
		// Device -> Source -> Root -> Stage already locked by loadLocalPushStageTx.
		// Take the CAS hash lock BEFORE checking ContentBlob, matching GC.
		if err := lockContentHash(tx, stage.ContentSHA256); err != nil {
			return err
		}
		var blob meta.ContentBlob
		err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("sha256 = ?", stage.ContentSHA256).Take(&blob).Error
		if err == nil {
			// Neither a ready nor a deleting ContentBlob may be hijacked by
			// the private new-content preparation path.
			return errLocalPushStageConflict
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var existing meta.LocalPushCASPrepareIntent
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("stage_id = ?", stage.StageID).Take(&existing).Error
		switch {
		case err == nil:
			if !sameLocalPushCASPrepareIntent(existing, stage) {
				return errLocalPushStageConflict
			}
			return ctx.Err() // verified exact replay; never rewrite metadata
		case errors.Is(err, gorm.ErrRecordNotFound):
			// A new record is intentionally always QUARANTINED. It may
			// outlive the Stage or physical CAS inode; no caller trusts it.
			intent := localPushCASPrepareIntentFromStage(stage)
			if err := tx.Create(&intent).Error; err != nil {
				return err
			}
			created = true
			return ctx.Err()
		default:
			return err
		}
	})
	if err != nil {
		return false, err
	}
	return created, nil
}

func localPushCASPrepareIntentFromStage(stage meta.LocalPushStaging) meta.LocalPushCASPrepareIntent {
	return meta.LocalPushCASPrepareIntent{
		StageID: stage.StageID, SourceID: stage.SourceID, OwnerID: stage.OwnerID,
		SourceRevision: stage.SourceRevision, DeviceID: stage.DeviceID,
		RootID: stage.RootID, RootFingerprint: stage.RootFingerprint,
		TargetNodeID:          stage.TargetNodeID,
		CurrentSnapshotSHA256: stage.CurrentSnapshotSHA256,
		CurrentPathKey:        stage.CurrentPathKey,
		ContentSHA256:         stage.ContentSHA256, TotalSize: stage.TotalSize,
		StageExpiresAt: stage.ExpiresAt,
		State:          meta.LocalPushCASPrepareIntentQuarantined,
	}
}

func sameLocalPushCASPrepareIntent(intent meta.LocalPushCASPrepareIntent, stage meta.LocalPushStaging) bool {
	return intent.State == meta.LocalPushCASPrepareIntentQuarantined &&
		intent.StageID == stage.StageID && intent.SourceID == stage.SourceID &&
		intent.OwnerID == stage.OwnerID && intent.SourceRevision == stage.SourceRevision &&
		intent.DeviceID == stage.DeviceID && intent.RootID == stage.RootID &&
		intent.RootFingerprint == stage.RootFingerprint &&
		intent.TargetNodeID == stage.TargetNodeID &&
		intent.CurrentSnapshotSHA256 == stage.CurrentSnapshotSHA256 &&
		intent.CurrentPathKey == stage.CurrentPathKey &&
		intent.ContentSHA256 == stage.ContentSHA256 &&
		intent.TotalSize == stage.TotalSize &&
		intent.StageExpiresAt.Equal(stage.ExpiresAt)
}
