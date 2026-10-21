package api

import (
	"crypto/subtle"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Only the original OS-private 32-byte operation key is a valid selector.
// These structures never cross a Router, Agent IPC or renderer boundary.
type localPushHistoricalOperationPhysicalSelector struct {
	requestKey                []byte
	operationID               string
	generation                uint64
	requireFileTerminalVacant bool
}

type localPushHistoricalOperationPhysicalObservation struct {
	operationID  string
	generation   uint64
	stageID      string
	nodeID       uint64
	sourceItemID uint64
	casObserved  bool
}

// observeBoundLocalPushHistoricalOperationPhysicalCommit is an UNROUTED
// owning-device-only READ. Its SQL transaction simultaneously inspects the
// original immutable keyed operation->Stage binding, the SQL COMMIT record,
// canonical PENDING Node/SourceItem and pinned physical CAS bytes. An expired
// reservation or replaced temporary Stage does not erase historical evidence.
// A positive result is STILL NOT native-file attestation, SourceRun success,
// safe cancellation or authority to retire the original request key.
func (s *Server) observeBoundLocalPushHistoricalOperationPhysicalCommit(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string, requestKey []byte, operationID string,
	generation uint64,
) (localPushHistoricalOperationPhysicalObservation, error) {
	var empty localPushHistoricalOperationPhysicalObservation
	if s == nil || s.Store == nil || s.DB == nil || c == nil ||
		c.Request == nil || c.Request.Context().Err() != nil ||
		!validLocalPushPrepareOperationUUID(operationID) ||
		generation == 0 {
		return empty, errLocalPushOperationIntentDenied
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return empty, errLocalPushOperationIntentDenied
	}
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), requestKey...),
		operationID: operationID, generation: generation,
	}
	receipt, err := s.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		c, sourceID, revision, proof, stageID, relativeLeaf,
		local.InspectPinnedLocalPushHistoricalCAS, selector,
	)
	if err != nil || receipt.State != localPushFirstLeafSQLReceiptState ||
		receipt.NodeID == 0 || receipt.SourceItemID == 0 {
		return empty, errLocalPushOperationIntentDenied
	}
	return localPushHistoricalOperationPhysicalObservation{
		operationID: operationID, generation: generation, stageID: stageID,
		nodeID: receipt.NodeID, sourceItemID: receipt.SourceItemID,
		casObserved: true,
	}, nil
}

// validateLocalPushHistoricalOperationPhysicalTx is called BEFORE acquiring
// the content hash/CAS lock. Preserve Owner->Device->Source->Root->Operation
// SHARE->immutable correlation SHARE->CAS hash/Blob/Node ordering. All locks
// are held until the same read-only SQL transaction COMMIT inside the real
// pinned physical CAS callback. No current/next-generation writer admission.
func (s *Server) validateLocalPushHistoricalOperationPhysicalTx(
	tx *gorm.DB, c *gin.Context, owner meta.User, source meta.Source,
	proof localSourceExecutorProof, stageID string,
	hint meta.LocalPushCASPrepareIntent,
	selector *localPushHistoricalOperationPhysicalSelector,
) (meta.LocalPushFirstLeafOperationCommit, error) {
	var empty meta.LocalPushFirstLeafOperationCommit
	deny := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || tx == nil || tx.Error != nil ||
		tx.Statement == nil || tx.Statement.ConnPool == nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		selector == nil || source.ID == 0 || owner.ID != userID(c) ||
		source.TargetNodeID == nil ||
		!validLocalPushPrepareOperationUUID(selector.operationID) ||
		selector.generation == 0 || stageID == "" {
		return empty, deny
	}
	if _, held := tx.Statement.ConnPool.(interface {
		Commit() error
		Rollback() error
	}); !held {
		return empty, deny
	}
	digest, valid := localPushOperationRequestKeyDigest(selector.requestKey)
	if !valid {
		return empty, deny
	}
	fingerprint := strings.ToLower(strings.TrimSpace(
		c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	if len(fingerprint) != 64 ||
		hint.StageID != stageID || hint.SourceID != source.ID ||
		hint.OwnerID != owner.ID || hint.SourceRevision != source.Revision ||
		hint.DeviceID != proof.DeviceID || hint.RootID != proof.RootID ||
		hint.RootFingerprint != fingerprint ||
		hint.TargetNodeID != *source.TargetNodeID ||
		hint.State != meta.LocalPushCASPrepareIntentQuarantined ||
		!validLocalEvidenceDigest(hint.CurrentPathKey) ||
		!validLocalEvidenceDigest(hint.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(hint.ContentSHA256) ||
		hint.TotalSize < 0 || hint.TotalSize > localPushStageMaxBytes ||
		hint.StageExpiresAt.IsZero() {
		return empty, deny
	}
	// Only the private terminal candidate requires original Operation UPDATE.
	// Normal historical read callers retain their existing SHARE behavior.
	originalLockStrength := "SHARE"
	if selector.requireFileTerminalVacant {
		if source.SyncMode != meta.SourceSyncModeBackup || source.Status != meta.SourceStatusPaused {
			return empty, deny
		}
		originalLockStrength = "UPDATE"
	}
	var original meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: originalLockStrength}).
		Where("id = ? AND source_id = ? AND generation = ?",
			selector.operationID, source.ID, selector.generation).
		Take(&original).Error; err != nil {
		return empty, deny
	}
	if original.ID != selector.operationID ||
		original.Generation != selector.generation ||
		original.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*original.RequestKeyDigest), []byte(digest)) != 1 ||
		original.OwnerID != owner.ID ||
		original.OwnerSession != owner.SessionVersion ||
		original.DeviceID != proof.DeviceID || original.RootID != proof.RootID ||
		original.RootFingerprint != fingerprint ||
		original.SourceRevision != source.Revision ||
		original.TargetNodeID != *source.TargetNodeID ||
		original.IssuedAt.IsZero() || !original.ExpiresAt.After(original.IssuedAt) {
		return empty, deny
	}
	// Historical evidence remains observable after a reservation expires or
	// is terminal. Never interpret that historical state as live admission.
	var binding meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND source_id = ? AND generation = ?",
			stageID, source.ID, selector.generation).
		Take(&binding).Error; err != nil {
		return empty, deny
	}
	if binding.OperationID != selector.operationID ||
		binding.RequestKeyDigest != digest ||
		binding.OwnerID != owner.ID ||
		binding.OwnerSession != original.OwnerSession ||
		binding.DeviceID != proof.DeviceID || binding.RootID != proof.RootID ||
		binding.RootFingerprint != fingerprint ||
		binding.SourceRevision != source.Revision ||
		binding.TargetNodeID != *source.TargetNodeID ||
		binding.CurrentSnapshotSHA256 != hint.CurrentSnapshotSHA256 ||
		binding.CurrentPathKey != hint.CurrentPathKey ||
		binding.ContentSHA256 != hint.ContentSHA256 ||
		binding.TotalSize != hint.TotalSize ||
		!binding.StageExpiresAt.Equal(hint.StageExpiresAt) ||
		binding.BoundAt.IsZero() ||
		binding.BoundAt.Before(original.IssuedAt) ||
		binding.BoundAt.After(original.ExpiresAt) {
		return empty, deny
	}
	// Hold the original Operation UPDATE, not a historical SHARE, before
	// checking the source-wide decision slot and latest generation. This
	// check expires at transaction end and never becomes a writer ticket.
	if selector.requireFileTerminalVacant {
		if err := requireLocalPushFileTerminalVacantTx(tx, source.ID); err != nil {
			return empty, deny
		}
		var later int64
		if err := tx.Model(&meta.LocalPushOperationIntent{}).
			Where("source_id = ? AND generation > ?", source.ID, selector.generation).
			Count(&later).Error; err != nil || later != 0 {
			return empty, deny
		}
	}
	var outcome meta.LocalPushFirstLeafOperationCommit
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ? AND source_id = ? AND generation = ? AND stage_id = ?",
			selector.operationID, source.ID, selector.generation, stageID).
		Take(&outcome).Error; err != nil {
		return empty, deny
	}
	if outcome.OperationID != selector.operationID ||
		outcome.SourceID != source.ID || outcome.Generation != selector.generation ||
		outcome.StageID != stageID ||
		outcome.RequestKeyDigest != digest ||
		outcome.OwnerID != owner.ID ||
		outcome.OwnerSession != original.OwnerSession ||
		outcome.DeviceID != proof.DeviceID || outcome.RootID != proof.RootID ||
		outcome.RootFingerprint != fingerprint ||
		outcome.SourceRevision != source.Revision ||
		outcome.TargetNodeID != *source.TargetNodeID ||
		outcome.CurrentSnapshotSHA256 != hint.CurrentSnapshotSHA256 ||
		outcome.CurrentPathKey != hint.CurrentPathKey ||
		outcome.ContentSHA256 != hint.ContentSHA256 ||
		outcome.TotalSize != hint.TotalSize ||
		outcome.NodeID == 0 || outcome.SourceItemID == 0 ||
		outcome.CommittedAt.IsZero() ||
		outcome.CommittedAt.Before(binding.BoundAt) ||
		outcome.CommittedAt.Before(original.IssuedAt) ||
		outcome.CommittedAt.After(original.ExpiresAt) ||
		c.Request.Context().Err() != nil {
		return empty, deny
	}
	return outcome, nil
}
