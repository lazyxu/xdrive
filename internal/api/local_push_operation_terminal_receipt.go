package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushPrivateReservationTerminal is evidence ONLY of a Server lease's
// termination. It proves neither physical upload/cancellation nor SourceRun
// completion and never grants permission to retire a local request key.
type localPushPrivateReservationTerminal struct {
	operationID string
	generation  uint64
	state       string
	recordedAt  time.Time
}

// recordBoundLocalPushReservationTerminal creates or reloads an immutable
// reservation-terminal receipt for the exact latest UUID, generation and
// previously minted native request key. It is deliberately UNROUTED; a later
// independently reviewed owning-Agent held-Root bridge is required.
func (s *Server) recordBoundLocalPushReservationTerminal(
	c *gin.Context, sourceID, revision uint64, requestKey []byte,
	operationID string, generation uint64,
) (localPushPrivateReservationTerminal, error) {
	var empty localPushPrivateReservationTerminal
	denied := errLocalPushOperationIntentDenied
	digest, validKey := localPushOperationRequestKeyDigest(requestKey)
	parsed, parseErr := uuid.Parse(operationID)
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || generation == 0 ||
		!validKey || parseErr != nil || parsed.String() != operationID ||
		c.Request.Context().Err() != nil {
		return empty, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return empty, denied
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	var result localPushPrivateReservationTerminal
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock order: Owner SHARE -> Device UPDATE -> Source UPDATE ->
		// Root SHARE -> latest intent UPDATE; revocation, Source changes
		// and generation advancement cannot race the terminal insert.
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
			latest.SourceRevision != source.Revision ||
			latest.TargetNodeID != *source.TargetNodeID ||
			latest.DeviceID != proof.DeviceID || latest.RootID != proof.RootID ||
			latest.RootFingerprint != fingerprint ||
			latest.RequestKeyDigest == nil ||
			subtle.ConstantTimeCompare([]byte(*latest.RequestKeyDigest), []byte(digest)) != 1 ||
			latest.IssuedAt.IsZero() || !latest.ExpiresAt.After(latest.IssuedAt) ||
			now.Before(latest.IssuedAt) {
			return denied
		}
		var terminalState string
		switch {
		case latest.State == meta.LocalPushOperationIntentAborted &&
			latest.AbortedAt != nil &&
			!latest.AbortedAt.Before(latest.IssuedAt) &&
			!latest.AbortedAt.After(latest.ExpiresAt) &&
			!now.Before(*latest.AbortedAt):
			terminalState = meta.LocalPushTerminalReservationAborted
		case latest.State == meta.LocalPushOperationIntentReserved &&
			latest.AbortedAt == nil && !now.Before(latest.ExpiresAt):
			terminalState = meta.LocalPushTerminalReservationExpired
		default:
			// Live, invalid or obsolete operation: no terminal proof.
			return denied
		}
		var receipt meta.LocalPushOperationTerminalReceipt
		err = tx.Where("operation_id = ?", operationID).Take(&receipt).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			receipt = meta.LocalPushOperationTerminalReceipt{
				OperationID: operationID, SourceID: sourceID, Generation: generation,
				RequestKeyDigest: digest, State: terminalState, RecordedAt: now,
			}
			if err := tx.Create(&receipt).Error; err != nil {
				return denied
			}
		} else if err != nil {
			return denied
		}
		if receipt.OperationID != operationID || receipt.SourceID != sourceID ||
			receipt.Generation != generation || receipt.RequestKeyDigest != digest ||
			receipt.State != terminalState || receipt.RecordedAt.IsZero() ||
			receipt.RecordedAt.Before(latest.IssuedAt) || receipt.RecordedAt.After(now) ||
			(terminalState == meta.LocalPushTerminalReservationExpired &&
				receipt.RecordedAt.Before(latest.ExpiresAt)) ||
			(terminalState == meta.LocalPushTerminalReservationAborted &&
				receipt.RecordedAt.Before(*latest.AbortedAt)) {
			return denied
		}
		result = localPushPrivateReservationTerminal{
			operationID: operationID, generation: generation,
			// Canonical UTC removes driver-specific Location pointers: a fresh
			// SQL insert and a later PostgreSQL reload must return the same
			// immutable instant, including across Server processes.
			state: terminalState, recordedAt: receipt.RecordedAt.UTC(),
		}
		return ctx.Err()
	})
	if err != nil || ctx.Err() != nil {
		return empty, denied
	}
	return result, nil
}
