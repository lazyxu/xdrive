package api

import (
	"context"
	"crypto/subtle"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushHeldNativeCommitWitness is an INTERNAL hand-off contract, not an
// HTTP/JSON attestation. Only a future independently verified owning-Agent
// transport may construct a production value with originalClaimHeld=true.
// This struct MUST NOT be decoded directly from caller-controlled input.
type localPushHeldNativeCommitWitness struct {
	operationID         string
	generation          uint64
	stageID             string
	sourceID            uint64
	revision            uint64
	deviceID            string
	rootID              string
	rootFingerprint     string
	snapshotSHA256      string
	pathKey             string
	contentSHA256       string
	totalSize           int64
	nativeWitnessSHA256 string
	originalClaimHeld   bool
}

// persistBoundLocalPushOriginalPhysicalCommitTx writes a physical-commit ONLY
// within the *original* Operation UPDATE + Owner/Device/Source/Root + immutable
// Stage/SQL receipt locks and the doubly verified Local CAS pin held by the
// caller's precommit callback. It is not an independent claim of native trust.
// No production transport calls this function before OS evidence is bound.
// A successful row is immutable and still does NOT retire Stage/key/Writer,
// complete a SourceRun, or authorize a second file.
func (s *Server) persistBoundLocalPushOriginalPhysicalCommitTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context,
	sourceID, revision uint64, proof localSourceExecutorProof,
	selector *localPushHistoricalOperationPhysicalSelector,
	witness localPushHeldNativeCommitWitness,
	receipt localPushFirstLeafSQLReceipt,
) error {
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		!localPushFileTerminalHeldTx(tx) || selector == nil ||
		!selector.requireFileTerminalVacant ||
		!validLocalPushPrepareOperationUUID(selector.operationID) ||
		selector.generation == 0 || sourceID == 0 || revision == 0 ||
		receipt.State != localPushFirstLeafSQLReceiptState ||
		receipt.NodeID == 0 || receipt.SourceItemID == 0 ||
		!witness.originalClaimHeld ||
		witness.operationID != selector.operationID ||
		witness.generation != selector.generation ||
		witness.stageID == "" || witness.sourceID != sourceID ||
		witness.revision != revision || witness.deviceID != proof.DeviceID ||
		witness.rootID != proof.RootID ||
		!validLocalEvidenceDigest(witness.snapshotSHA256) ||
		!validLocalEvidenceDigest(witness.pathKey) ||
		!validLocalEvidenceDigest(witness.contentSHA256) ||
		!validLocalEvidenceDigest(witness.nativeWitnessSHA256) ||
		witness.nativeWitnessSHA256 == strings.Repeat("0", 64) ||
		witness.totalSize < 0 || witness.totalSize > localPushStageMaxBytes {
		return denied
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return denied
	}
	fingerprint := strings.ToLower(strings.TrimSpace(
		c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	if !validLocalEvidenceDigest(fingerprint) ||
		witness.rootFingerprint != fingerprint {
		return denied
	}
	keyDigest, valid := localPushOperationRequestKeyDigest(selector.requestKey)
	if !valid {
		return denied
	}
	// The surrounding pinned CAS callback has already taken the required
	// canonical lock order. All re-reads below use the SAME SQL transaction,
	// never a detached advisory physical observation.
	var original meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND source_id = ? AND generation = ?",
			selector.operationID, sourceID, selector.generation).
		Take(&original).Error; err != nil {
		return denied
	}
	if original.ID != selector.operationID ||
		original.SourceID != sourceID ||
		original.State != meta.LocalPushOperationIntentReserved ||
		original.AbortedAt != nil || original.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*original.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		original.OwnerID != userID(c) || original.OwnerSession == 0 ||
		original.SourceRevision != revision || original.DeviceID != proof.DeviceID ||
		original.RootID != proof.RootID ||
		original.RootFingerprint != fingerprint ||
		original.TargetNodeID == 0 {
		return denied
	}
	var binding meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND source_id = ? AND generation = ?",
			witness.stageID, sourceID, selector.generation).
		Take(&binding).Error; err != nil {
		return denied
	}
	if binding.OperationID != original.ID || binding.SourceRevision != revision ||
		binding.OwnerID != original.OwnerID ||
		binding.OwnerSession != original.OwnerSession ||
		binding.DeviceID != original.DeviceID || binding.RootID != original.RootID ||
		binding.RootFingerprint != original.RootFingerprint ||
		binding.TargetNodeID != original.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(binding.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		binding.CurrentSnapshotSHA256 != witness.snapshotSHA256 ||
		binding.CurrentPathKey != witness.pathKey ||
		binding.ContentSHA256 != witness.contentSHA256 ||
		binding.TotalSize != witness.totalSize || binding.BoundAt.IsZero() {
		return denied
	}
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ?", selector.operationID).
		Take(&committed).Error; err != nil {
		return denied
	}
	if committed.OperationID != binding.OperationID ||
		committed.StageID != binding.StageID ||
		committed.SourceID != binding.SourceID ||
		committed.Generation != binding.Generation ||
		committed.OwnerID != binding.OwnerID ||
		committed.OwnerSession != binding.OwnerSession ||
		committed.DeviceID != binding.DeviceID ||
		committed.RootID != binding.RootID ||
		committed.RootFingerprint != binding.RootFingerprint ||
		committed.SourceRevision != binding.SourceRevision ||
		committed.TargetNodeID != binding.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(committed.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		committed.CurrentSnapshotSHA256 != binding.CurrentSnapshotSHA256 ||
		committed.CurrentPathKey != binding.CurrentPathKey ||
		committed.ContentSHA256 != binding.ContentSHA256 ||
		committed.TotalSize != binding.TotalSize ||
		committed.NodeID != receipt.NodeID ||
		committed.SourceItemID != receipt.SourceItemID ||
		committed.CommittedAt.IsZero() ||
		committed.CommittedAt.Before(binding.BoundAt) {
		return denied
	}
	// A reservation abort/expiry receipt is never a physical CANCEL and may
	// not coexist with this positive terminal. Existing file terminal rows,
	// even from a different Source generation, veto a second decision.
	if err := requireLocalPushFileTerminalVacantTx(tx, sourceID); err != nil {
		return denied
	}
	var reservationCount int64
	if err := tx.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Where("operation_id = ?", original.ID).Count(&reservationCount).Error; err != nil ||
		reservationCount != 0 {
		return denied
	}
	now, err := localPushFirstDirectoryDBClock(tx)
	if err != nil || now.Before(committed.CommittedAt) ||
		now.Before(binding.BoundAt) || ctx.Err() != nil {
		return denied
	}
	// Persist ONLY canonical SQL identities, not client-supplied Node,
	// SourceItem, path, or arbitrary byte counts. This insert and the pinned
	// CAS commit are one atomic SQL/physical observation boundary.
	record := meta.LocalPushFileTerminal{
		OperationID: original.ID, StageID: binding.StageID,
		SourceID: sourceID, Generation: original.Generation,
		OwnerID: original.OwnerID, OwnerSession: original.OwnerSession,
		DeviceID: original.DeviceID, RootID: original.RootID,
		RootFingerprint: original.RootFingerprint,
		SourceRevision:  revision, TargetNodeID: original.TargetNodeID,
		RequestKeyDigest:      keyDigest,
		CurrentSnapshotSHA256: binding.CurrentSnapshotSHA256,
		CurrentPathKey:        binding.CurrentPathKey,
		ContentSHA256:         binding.ContentSHA256,
		TotalSize:             binding.TotalSize,
		NativeWitnessSHA256:   witness.nativeWitnessSHA256,
		State:                 meta.LocalPushFileTerminalPhysicalCommit,
		NodeID:                committed.NodeID, SourceItemID: committed.SourceItemID,
		RecordedAt: now,
	}
	if err := tx.Create(&record).Error; err != nil {
		return denied
	}
	return ctx.Err()
}

// observeBoundLocalPushPhysicalCommitWithHeldNative is PRIVATE and UNROUTED.
// Tests may supply synthetic native witnesses; that is NOT a production
// attestation. A future Agent bridge must establish the actual still-held
// native Writer Claim and OS fd, authenticated Device/Root and exact witness
// before it may call this method. Absence/mismatch fails closed.
func (s *Server) observeBoundLocalPushPhysicalCommitWithHeldNative(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
	selector *localPushHistoricalOperationPhysicalSelector,
	witness localPushHeldNativeCommitWitness,
) (localPushFirstLeafSQLReceipt, error) {
	var empty localPushFirstLeafSQLReceipt
	if selector == nil || stageID == "" || witness.stageID != stageID ||
		!witness.originalClaimHeld ||
		witness.operationID != selector.operationID ||
		witness.generation != selector.generation ||
		!selector.requireFileTerminalVacant {
		return empty, errLocalPushOperationIntentDenied
	}
	return s.observeBoundLocalPushOriginalCASWithPrivatePrecommit(
		c, sourceID, revision, proof, stageID, relativeLeaf, selector,
		func(ctx context.Context, tx *gorm.DB, receipt localPushFirstLeafSQLReceipt) error {
			return s.persistBoundLocalPushOriginalPhysicalCommitTx(
				ctx, tx, c, sourceID, revision, proof, selector, witness, receipt)
		},
	)
}
