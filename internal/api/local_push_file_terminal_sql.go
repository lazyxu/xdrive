package api

import (
	"crypto/subtle"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushFileTerminalHeldTx insists on a caller-owned SQL transaction.
// FOR UPDATE outside a retained transaction is NOT an atomic exclusion.
func localPushFileTerminalHeldTx(tx *gorm.DB) bool {
	if tx == nil || tx.Error != nil || tx.Statement == nil ||
		tx.Statement.ConnPool == nil {
		return false
	}
	_, held := tx.Statement.ConnPool.(interface {
		Commit() error
		Rollback() error
	})
	return held
}

// requireLocalPushFileTerminalVacantTx is a fail-closed Source-WIDE embargo.
// The caller already holds Owner SHARE -> Device UPDATE -> Source UPDATE ->
// Root SHARE -> current Operation UPDATE, retained through the transaction.
// Any historical physical terminal (or a missing/unreadable migration) vetoes
// a NEW writer/generation, regardless of the current lease's status.
// G2c2d2b2/b3 must use the SAME lock ordering for a future terminal writer.
func requireLocalPushFileTerminalVacantTx(tx *gorm.DB, sourceID uint64) error {
	if !localPushFileTerminalHeldTx(tx) || sourceID == 0 {
		return errLocalPushOperationIntentDenied
	}
	var count int64
	if err := tx.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", sourceID).Count(&count).Error; err != nil || count != 0 {
		return errLocalPushOperationIntentDenied
	}
	return nil
}

// inspectBoundLocalPushFileTerminalTx is strictly a PRIVATE, READ-ONLY SQL
// correlation interface for later separately authenticated physical proof.
// It is NOT a terminal recorder, physical writer-quiescence attestation,
// request-key retirement capability, or public/Agent/renderer endpoint.
// A verified-looking SHA256 field is a correlation value, NOT a native proof.
//
// Preserve Owner SHARE -> Device UPDATE -> Source UPDATE -> Root SHARE ->
// original Operation SHARE -> immutable Stage binding SHARE -> terminal SHARE
// -> historical SQL COMMIT SHARE. Every lock stays held until caller's COMMIT.
func (s *Server) inspectBoundLocalPushFileTerminalTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	requestKey []byte, operationID string, generation uint64, stageID string,
) (meta.LocalPushFileTerminal, error) {
	var empty meta.LocalPushFileTerminal
	denied := errLocalPushOperationIntentDenied
	digest, valid := localPushOperationRequestKeyDigest(requestKey)
	if s == nil || s.DB == nil || !localPushFileTerminalHeldTx(tx) ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		sourceID == 0 || revision == 0 || generation == 0 || stageID == "" ||
		!valid || !validLocalPushPrepareOperationUUID(operationID) {
		return empty, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return empty, denied
	}
	owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
		tx, c, sourceID, revision, proof)
	if err != nil || source.TargetNodeID == nil {
		return empty, denied
	}
	var original meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND source_id = ? AND generation = ?",
			operationID, sourceID, generation).
		Take(&original).Error; err != nil {
		return empty, denied
	}
	if original.ID != operationID || original.Generation != generation ||
		original.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*original.RequestKeyDigest), []byte(digest)) != 1 ||
		original.OwnerID != owner.ID || original.OwnerSession != owner.SessionVersion ||
		original.DeviceID != proof.DeviceID || original.RootID != proof.RootID ||
		original.RootFingerprint != fingerprint || original.SourceRevision != revision ||
		original.TargetNodeID != *source.TargetNodeID ||
		original.IssuedAt.IsZero() || !original.ExpiresAt.After(original.IssuedAt) {
		return empty, denied
	}
	var binding meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND source_id = ? AND generation = ?",
			stageID, sourceID, generation).
		Take(&binding).Error; err != nil {
		return empty, denied
	}
	if binding.StageID != stageID || binding.OperationID != operationID ||
		binding.RequestKeyDigest != digest ||
		binding.OwnerID != owner.ID || binding.OwnerSession != original.OwnerSession ||
		binding.DeviceID != proof.DeviceID || binding.RootID != proof.RootID ||
		binding.RootFingerprint != fingerprint ||
		binding.SourceRevision != revision || binding.TargetNodeID != *source.TargetNodeID ||
		!validLocalEvidenceDigest(binding.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(binding.CurrentPathKey) ||
		!validLocalEvidenceDigest(binding.ContentSHA256) ||
		binding.TotalSize < 0 || binding.TotalSize > localPushStageMaxBytes ||
		binding.BoundAt.IsZero() || binding.BoundAt.Before(original.IssuedAt) ||
		binding.BoundAt.After(original.ExpiresAt) {
		return empty, denied
	}
	var terminal meta.LocalPushFileTerminal
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ? AND source_id = ? AND generation = ? AND stage_id = ?",
			operationID, sourceID, generation, stageID).
		Take(&terminal).Error; err != nil {
		return empty, denied
	}
	if terminal.OperationID != operationID || terminal.SourceID != sourceID ||
		terminal.Generation != generation || terminal.StageID != stageID ||
		terminal.OwnerID != owner.ID || terminal.OwnerSession != original.OwnerSession ||
		terminal.DeviceID != proof.DeviceID || terminal.RootID != proof.RootID ||
		terminal.RootFingerprint != fingerprint || terminal.SourceRevision != revision ||
		terminal.TargetNodeID != *source.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(terminal.RequestKeyDigest), []byte(digest)) != 1 ||
		terminal.CurrentSnapshotSHA256 != binding.CurrentSnapshotSHA256 ||
		terminal.CurrentPathKey != binding.CurrentPathKey ||
		terminal.ContentSHA256 != binding.ContentSHA256 ||
		terminal.TotalSize != binding.TotalSize ||
		!validLocalEvidenceDigest(terminal.NativeWitnessSHA256) ||
		terminal.RecordedAt.IsZero() || terminal.RecordedAt.Before(binding.BoundAt) ||
		c.Request.Context().Err() != nil {
		return empty, denied
	}
	// A reservation 'aborted' or 'expired' is NOT a physical cancellation.
	// A negative physical terminal requires later native writer quiescence;
	// this B1 reader does NOT issue or endorse such a witness.
	var committed meta.LocalPushFirstLeafOperationCommit
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ?", operationID).Take(&committed).Error
	switch terminal.State {
	case meta.LocalPushFileTerminalPhysicalCommit:
		if err != nil || committed.OperationID != operationID ||
			committed.StageID != stageID || committed.SourceID != sourceID ||
			committed.Generation != generation ||
			committed.OwnerID != owner.ID || committed.OwnerSession != original.OwnerSession ||
			committed.DeviceID != proof.DeviceID || committed.RootID != proof.RootID ||
			committed.RootFingerprint != fingerprint || committed.SourceRevision != revision ||
			committed.TargetNodeID != *source.TargetNodeID ||
			subtle.ConstantTimeCompare([]byte(committed.RequestKeyDigest), []byte(digest)) != 1 ||
			committed.CurrentSnapshotSHA256 != binding.CurrentSnapshotSHA256 ||
			committed.CurrentPathKey != binding.CurrentPathKey ||
			committed.ContentSHA256 != binding.ContentSHA256 ||
			committed.TotalSize != binding.TotalSize ||
			committed.NodeID == 0 || committed.SourceItemID == 0 ||
			terminal.NodeID != committed.NodeID || terminal.SourceItemID != committed.SourceItemID ||
			committed.CommittedAt.IsZero() ||
			terminal.RecordedAt.Before(committed.CommittedAt) {
			return empty, denied
		}
	case meta.LocalPushFileTerminalPhysicalCancelQuiesced:
		if !errors.Is(err, gorm.ErrRecordNotFound) ||
			terminal.NodeID != 0 || terminal.SourceItemID != 0 {
			return empty, denied
		}
	default:
		return empty, denied
	}
	return terminal, nil
}
