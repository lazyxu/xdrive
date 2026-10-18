package api

import (
	"crypto/subtle"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// validateCurrentLocalPushWriterFenceTx is an UNROUTED, fail-closed,
// transaction-scoped precommit admission check for a FUTURE owning Agent writer.
// The caller must retain this SAME transaction/operation UPDATE lock across
// physical CAS/SQL commit, and MUST recheck before its final SQL COMMIT.
// This helper does not itself write bytes, perform native attestation, start
// SourceRun, authorize key retirement, or make any existing writer safe.
func (s *Server) validateCurrentLocalPushWriterFenceTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	requestKey []byte, operationID string, generation uint64,
) error {
	denied := errLocalPushOperationIntentDenied
	digest, valid := localPushOperationRequestKeyDigest(requestKey)
	parsed, parseErr := uuid.Parse(operationID)
	if s == nil || s.DB == nil || tx == nil || tx.Error != nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		sourceID == 0 || revision == 0 || generation == 0 ||
		!valid || parseErr != nil || parsed.String() != operationID {
		return denied
	}
	// A plain *gorm.DB can execute FOR UPDATE under an implicit one-query
	// transaction, releasing its lock before a physical writer COMMIT.
	// Reject it: the caller must supply a REAL retained transaction.
	if tx.Statement == nil || tx.Statement.ConnPool == nil {
		return denied
	}
	if _, heldTransaction := tx.Statement.ConnPool.(interface {
		Commit() error
		Rollback() error
	}); !heldTransaction {
		return denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return denied
	}
	// Caller must not have acquired Stage/CAS/Node locks before this call.
	// Preserve the established Owner SHARE -> Device UPDATE -> Source
	// UPDATE -> Root SHARE -> latest operation UPDATE ordering.
	owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
		tx, c, sourceID, revision, proof)
	if err != nil || source.TargetNodeID == nil {
		return denied
	}
	now, err := localPushFirstDirectoryDBClock(tx)
	if err != nil {
		return denied
	}
	var latest meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ?", sourceID).Order("generation DESC").
		Take(&latest).Error; err != nil {
		return denied
	}
	if latest.ID != operationID || latest.Generation != generation ||
		latest.OwnerID != owner.ID || latest.OwnerSession != owner.SessionVersion ||
		latest.DeviceID != proof.DeviceID || latest.RootID != proof.RootID ||
		latest.RootFingerprint != fingerprint ||
		latest.SourceRevision != source.Revision ||
		latest.TargetNodeID != *source.TargetNodeID ||
		latest.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*latest.RequestKeyDigest), []byte(digest)) != 1 ||
		latest.State != meta.LocalPushOperationIntentReserved ||
		latest.AbortedAt != nil || latest.IssuedAt.IsZero() ||
		!latest.ExpiresAt.After(latest.IssuedAt) ||
		now.Before(latest.IssuedAt) || !now.Before(latest.ExpiresAt) {
		return denied
	}
	// A recorded terminal receipt is contradictory to live writer admission
	// even if a malformed/stale operation row claims to be reserved.
	// Fail closed if the terminal table migration is absent/unreadable.
	var count int64
	if err := tx.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Where("source_id = ? AND generation = ?", sourceID, generation).
		Count(&count).Error; err != nil || count != 0 ||
		c.Request.Context().Err() != nil {
		return denied
	}
	return nil
}
