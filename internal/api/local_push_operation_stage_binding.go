package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// sameLocalPushStageOperationIdentity compares ONLY immutable scope and
// provenance, never CreatedAt or operation reply timing. No binding rewrite
// is permitted after an exact match or a conflicting replay.
func sameLocalPushStageOperationIdentity(
	a, b meta.LocalPushOperationStageBinding,
) bool {
	return a.StageID == b.StageID &&
		a.OperationID == b.OperationID &&
		a.SourceID == b.SourceID && a.Generation == b.Generation &&
		a.OwnerID == b.OwnerID && a.OwnerSession == b.OwnerSession &&
		a.SourceRevision == b.SourceRevision &&
		a.DeviceID == b.DeviceID && a.RootID == b.RootID &&
		a.RootFingerprint == b.RootFingerprint &&
		a.TargetNodeID == b.TargetNodeID &&
		subtle.ConstantTimeCompare([]byte(a.RequestKeyDigest), []byte(b.RequestKeyDigest)) == 1 &&
		a.CurrentSnapshotSHA256 == b.CurrentSnapshotSHA256 &&
		a.CurrentPathKey == b.CurrentPathKey &&
		a.ContentSHA256 == b.ContentSHA256 &&
		a.TotalSize == b.TotalSize &&
		a.StageExpiresAt.Equal(b.StageExpiresAt)
}

// bindBoundLocalPushOperationStage is UNROUTED, SERVER-PRIVATE SQL-only
// first-file evidence. It requires the original keyed current reservation,
// exact owning Source/Root/device proof, and one currently staged physical
// candidate. It does NOT inspect original native bytes, CAS, or authorize the
// existing writer. A binding is non-authoritative historical provenance.
//
// Lock order: User SHARE -> Device UPDATE -> Source UPDATE -> Root SHARE ->
// current Operation UPDATE -> Stage UPDATE -> immutable binding. Revalidate
// the original operation in the SAME held transaction before SQL commit.
// No new Agent IPC, Server Router, upload, SourceRun, cancellation or key
// retirement call is registered in this phase.
func (s *Server) bindBoundLocalPushOperationStage(
	c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, stageID string,
	requestKey []byte, operationID string, generation uint64,
) (meta.LocalPushOperationStageBinding, error) {
	var empty meta.LocalPushOperationStageBinding
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || generation == 0 ||
		stageID == "" || c.Request.Context().Err() != nil {
		return empty, denied
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return empty, denied
	}
	if _, err := localPushStageStoreKey(stageID); err != nil {
		return empty, denied
	}
	keyDigest, valid := localPushOperationRequestKeyDigest(requestKey)
	if !valid {
		return empty, denied
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	var result meta.LocalPushOperationStageBinding
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.validateCurrentLocalPushWriterFenceTx(
			tx, c, sourceID, revision, requestKey, operationID, generation,
		); err != nil {
			return denied
		}
		// Every Stage read is protected by current owner/device/Root/Source
		// verification and a retained Stage UPDATE lock.
		stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil || stage.Status != localPushStageReady ||
			stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
			!validLocalEvidenceDigest(stage.CurrentSnapshotSHA256) ||
			!validLocalEvidenceDigest(stage.CurrentPathKey) ||
			!validLocalEvidenceDigest(stage.ContentSHA256) {
			return denied
		}
		// A Stage row alone is a mutable temporary selector. Require the
		// existing immutable quarantine intent to match every physical
		// candidate field before persisting any operation correlation.
		var stagedProof meta.LocalPushCASPrepareIntent
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("stage_id = ?", stage.StageID).Take(&stagedProof).Error; err != nil ||
			!sameLocalPushCASPrepareIntent(stagedProof, stage) {
			return denied
		}
		var operation meta.LocalPushOperationIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ? AND generation = ?",
				operationID, sourceID, generation).Take(&operation).Error; err != nil {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil || !now.Before(operation.ExpiresAt) ||
			now.Before(operation.IssuedAt) || !now.Before(stage.ExpiresAt) ||
			operation.State != meta.LocalPushOperationIntentReserved ||
			operation.AbortedAt != nil || operation.RequestKeyDigest == nil ||
			subtle.ConstantTimeCompare(
				[]byte(*operation.RequestKeyDigest), []byte(keyDigest)) != 1 ||
			operation.SourceRevision != stage.SourceRevision ||
			operation.OwnerID != stage.OwnerID ||
			operation.DeviceID != stage.DeviceID ||
			operation.RootID != stage.RootID ||
			operation.RootFingerprint != stage.RootFingerprint ||
			operation.TargetNodeID != stage.TargetNodeID ||
			operation.Generation != generation ||
			operation.ID != operationID || operation.OwnerSession == 0 {
			return denied
		}
		candidate := meta.LocalPushOperationStageBinding{
			StageID: stage.StageID, OperationID: operationID,
			SourceID: sourceID, Generation: generation,
			OwnerID: operation.OwnerID, OwnerSession: operation.OwnerSession,
			SourceRevision: revision, DeviceID: stage.DeviceID,
			RootID: stage.RootID, RootFingerprint: stage.RootFingerprint,
			TargetNodeID: stage.TargetNodeID, RequestKeyDigest: keyDigest,
			CurrentSnapshotSHA256: stage.CurrentSnapshotSHA256,
			CurrentPathKey:        stage.CurrentPathKey,
			ContentSHA256:         stage.ContentSHA256, TotalSize: stage.TotalSize,
			StageExpiresAt: stage.ExpiresAt, BoundAt: now,
		}
		var previous meta.LocalPushOperationStageBinding
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("stage_id = ?", stageID).Take(&previous).Error
		switch {
		case lookup == nil:
			if !sameLocalPushStageOperationIdentity(previous, candidate) {
				return denied
			}
			result = previous // Exact replay retains original immutable BoundAt.
		case errors.Is(lookup, gorm.ErrRecordNotFound):
			if err := tx.Create(&candidate).Error; err != nil {
				return denied // Including a competing unique operation/gen.
			}
			result = candidate
		default:
			return denied
		}
		// Last DB-clock and revocation/cancel fencing occurs BEFORE the
		// transaction ends while the original locks are still held.
		if err := s.validateCurrentLocalPushWriterFenceTx(
			tx, c, sourceID, revision, requestKey, operationID, generation,
		); err != nil {
			return denied
		}
		return ctx.Err()
	})
	if err != nil || ctx.Err() != nil {
		return empty, denied
	}
	return result, nil
}
