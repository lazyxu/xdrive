package api

import (
	"crypto/subtle"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// requireLocalPushStageOperationBindingTx is a private, fail-closed
// prerequisite for the UNROUTED operation-aware first-file CAS/SQL prototype.
// The caller MUST already hold the current operation UPDATE lock from
// validateCurrentLocalPushWriterFenceTx and the Stage UPDATE lock in the
// SAME still-live SQL transaction. This function is not an independent
// writer admission, native-file proof, SourceRun or cancellation receipt.
func (s *Server) requireLocalPushStageOperationBindingTx(
	tx *gorm.DB, c *gin.Context, stage meta.LocalPushStaging,
	operation *localPushFirstLeafOperation,
) error {
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || tx == nil || tx.Error != nil ||
		tx.Statement == nil || tx.Statement.ConnPool == nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		operation == nil || operation.operationID == "" || operation.generation == 0 ||
		stage.StageID == "" || stage.SourceID == 0 || stage.SourceRevision == 0 ||
		stage.OwnerID != userID(c) ||
		(stage.Status != localPushStageReady && stage.Status != localPushStageCommitted) ||
		stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
		!validLocalEvidenceDigest(stage.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(stage.CurrentPathKey) ||
		!validLocalEvidenceDigest(stage.ContentSHA256) {
		return denied
	}
	if _, held := tx.Statement.ConnPool.(interface {
		Commit() error
		Rollback() error
	}); !held {
		return denied
	}
	digest, ok := localPushOperationRequestKeyDigest(operation.requestKey)
	if !ok {
		return denied
	}
	var intent meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND source_id = ? AND generation = ?",
			operation.operationID, stage.SourceID, operation.generation).
		Take(&intent).Error; err != nil {
		return denied
	}
	if intent.State != meta.LocalPushOperationIntentReserved ||
		intent.AbortedAt != nil || intent.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*intent.RequestKeyDigest), []byte(digest)) != 1 ||
		intent.OwnerID != stage.OwnerID ||
		intent.SourceRevision != stage.SourceRevision ||
		intent.DeviceID != stage.DeviceID || intent.RootID != stage.RootID ||
		intent.RootFingerprint != stage.RootFingerprint ||
		intent.TargetNodeID != stage.TargetNodeID ||
		intent.OwnerSession == 0 || intent.IssuedAt.IsZero() ||
		!intent.ExpiresAt.After(intent.IssuedAt) {
		return denied
	}
	var saved meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND source_id = ? AND generation = ?",
			stage.StageID, stage.SourceID, operation.generation).
		Take(&saved).Error; err != nil {
		// Missing migration and missing/mismatched Stage link both deny.
		return denied
	}
	expected := meta.LocalPushOperationStageBinding{
		StageID: stage.StageID, OperationID: operation.operationID,
		SourceID: stage.SourceID, Generation: operation.generation,
		OwnerID: intent.OwnerID, OwnerSession: intent.OwnerSession,
		SourceRevision: stage.SourceRevision, DeviceID: stage.DeviceID,
		RootID: stage.RootID, RootFingerprint: stage.RootFingerprint,
		TargetNodeID: stage.TargetNodeID, RequestKeyDigest: digest,
		CurrentSnapshotSHA256: stage.CurrentSnapshotSHA256,
		CurrentPathKey:        stage.CurrentPathKey,
		ContentSHA256:         stage.ContentSHA256, TotalSize: stage.TotalSize,
		StageExpiresAt: stage.ExpiresAt,
	}
	if !sameLocalPushStageOperationIdentity(saved, expected) ||
		saved.BoundAt.IsZero() ||
		saved.BoundAt.Before(intent.IssuedAt) ||
		saved.BoundAt.After(intent.ExpiresAt) ||
		saved.BoundAt.After(stage.ExpiresAt) ||
		c.Request.Context().Err() != nil {
		return denied
	}
	return nil
}
