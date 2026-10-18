package api

import (
	"crypto/subtle"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func sameLocalPushFirstLeafOperationCommit(
	a, b meta.LocalPushFirstLeafOperationCommit,
) bool {
	return a.OperationID == b.OperationID &&
		a.StageID == b.StageID &&
		a.SourceID == b.SourceID &&
		a.Generation == b.Generation &&
		a.OwnerID == b.OwnerID &&
		a.OwnerSession == b.OwnerSession &&
		a.DeviceID == b.DeviceID &&
		a.RootID == b.RootID &&
		a.RootFingerprint == b.RootFingerprint &&
		a.SourceRevision == b.SourceRevision &&
		a.TargetNodeID == b.TargetNodeID &&
		subtle.ConstantTimeCompare([]byte(a.RequestKeyDigest), []byte(b.RequestKeyDigest)) == 1 &&
		a.CurrentSnapshotSHA256 == b.CurrentSnapshotSHA256 &&
		a.CurrentPathKey == b.CurrentPathKey &&
		a.ContentSHA256 == b.ContentSHA256 &&
		a.TotalSize == b.TotalSize &&
		a.NodeID == b.NodeID &&
		a.SourceItemID == b.SourceItemID
}

// persistLocalPushFirstLeafOperationCommitTx is an UNROUTED SQL-only
// post-commit witness: it inserts a row in the SAME transaction that
// publishes a first-file Blob/Node/SourceItem and transfers the quota hold.
// Its caller MUST hold the authentic current Operation UPDATE, Stage UPDATE,
// and pinned physical Stage/CAS through the final COMMIT. A persisted row
// is NOT proof of still-present CAS bytes or an unchanged native original.
// It NEVER authorizes SourceRun completion, key retirement or cancellation.
func (s *Server) persistLocalPushFirstLeafOperationCommitTx(
	tx *gorm.DB, c *gin.Context, stage meta.LocalPushStaging,
	operation *localPushFirstLeafOperation,
	result localPushFirstFileCommitResult,
) error {
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || tx == nil || tx.Error != nil ||
		tx.Statement == nil || tx.Statement.ConnPool == nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		operation == nil || result.NodeID == 0 || result.SourceItemID == 0 ||
		stage.SourceID == 0 || stage.StageID == "" ||
		stage.OwnerID != userID(c) || stage.TotalSize < 0 ||
		stage.TotalSize > localPushStageMaxBytes {
		return denied
	}
	if _, held := tx.Statement.ConnPool.(interface {
		Commit() error
		Rollback() error
	}); !held {
		return denied
	}
	digest, valid := localPushOperationRequestKeyDigest(operation.requestKey)
	if !valid {
		return denied
	}
	// This same-transaction check requires the immutable one-to-one Stage
	// provenance, the owning device, and the exact original keyed operation.
	if err := s.requireLocalPushStageOperationBindingTx(
		tx, c, stage, operation,
	); err != nil {
		return denied
	}
	var bound meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND source_id = ? AND generation = ?",
			stage.StageID, stage.SourceID, operation.generation).
		Take(&bound).Error; err != nil {
		return denied
	}
	if bound.OperationID != operation.operationID ||
		subtle.ConstantTimeCompare([]byte(bound.RequestKeyDigest), []byte(digest)) != 1 {
		return denied
	}
	// A durable receipt may only be written after the SAME SQL transaction
	// has recorded the first-file canonical metadata and committed quota.
	var canonicalStage meta.LocalPushStaging
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND stage_id = ? AND status = ?",
			stage.SourceID, stage.StageID, localPushStageCommitted).
		Take(&canonicalStage).Error; err != nil {
		return denied
	}
	if canonicalStage.SourceRevision != stage.SourceRevision ||
		canonicalStage.OwnerID != stage.OwnerID ||
		canonicalStage.CurrentPathKey != stage.CurrentPathKey ||
		canonicalStage.CurrentSnapshotSHA256 != stage.CurrentSnapshotSHA256 ||
		canonicalStage.ContentSHA256 != stage.ContentSHA256 ||
		canonicalStage.TotalSize != stage.TotalSize {
		return denied
	}
	var hold meta.LocalPushQuotaHold
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND owner_id = ?", stage.StageID, stage.OwnerID).
		Take(&hold).Error; err != nil ||
		hold.ReleasedAt == nil || hold.CommittedAt == nil ||
		hold.CommittedNodeID == nil || *hold.CommittedNodeID != result.NodeID ||
		hold.CommittedSourceItemID == nil ||
		*hold.CommittedSourceItemID != result.SourceItemID ||
		!sameLocalPushQuotaHold(hold, stage) {
		return denied
	}
	now, err := localPushFirstDirectoryDBClock(tx)
	if err != nil || now.Before(bound.BoundAt) ||
		hold.CommittedAt.IsZero() || c.Request.Context().Err() != nil {
		return denied
	}
	expected := meta.LocalPushFirstLeafOperationCommit{
		OperationID:           operation.operationID,
		StageID:               stage.StageID,
		SourceID:              stage.SourceID,
		Generation:            operation.generation,
		OwnerID:               bound.OwnerID,
		OwnerSession:          bound.OwnerSession,
		DeviceID:              stage.DeviceID,
		RootID:                stage.RootID,
		RootFingerprint:       stage.RootFingerprint,
		SourceRevision:        stage.SourceRevision,
		TargetNodeID:          stage.TargetNodeID,
		RequestKeyDigest:      digest,
		CurrentSnapshotSHA256: stage.CurrentSnapshotSHA256,
		CurrentPathKey:        stage.CurrentPathKey,
		ContentSHA256:         stage.ContentSHA256,
		TotalSize:             stage.TotalSize,
		NodeID:                result.NodeID,
		SourceItemID:          result.SourceItemID,
		CommittedAt:           now,
	}
	var previous meta.LocalPushFirstLeafOperationCommit
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ?", operation.operationID).Take(&previous).Error
	switch {
	case err == nil:
		if !sameLocalPushFirstLeafOperationCommit(previous, expected) ||
			previous.CommittedAt.IsZero() ||
			previous.CommittedAt.Before(bound.BoundAt) ||
			previous.CommittedAt.After(now) {
			return denied
		}
		return c.Request.Context().Err()
	case errors.Is(err, gorm.ErrRecordNotFound):
		if tx.Create(&expected).Error != nil {
			// Stage ID and Source generation are also uniquely constrained.
			return denied
		}
		return c.Request.Context().Err()
	default:
		return denied
	}
}
