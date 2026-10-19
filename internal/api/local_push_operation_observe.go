package api

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushOperationIntentObservation is a private, non-authoritative status
// observation. It is not a proof of a held native handle, committed bytes,
// SourceRun completion, or permission to upload. Never route it to a client.
type localPushOperationIntentObservation struct {
	state      string
	generation uint64
}

const localPushOperationIntentObservedExpired = "expired"

// observeBoundLocalPushOperationIntent provides a bounded, READ-ONLY
// abort-response/restart lookup for the exact newest operation and owning scope.
// Older generations are intentionally opaque even if they have durable rows.
// An unknown reservation ID after a lost initial reserve response cannot be
// recovered by this operation. No work is started, resumed, or committed.
func (s *Server) observeBoundLocalPushOperationIntent(
	c *gin.Context, sourceID, revision uint64, operationID string, generation uint64,
) (localPushOperationIntentObservation, error) {
	var empty localPushOperationIntentObservation
	denied := errLocalPushOperationIntentDenied
	parsed, parseErr := uuid.Parse(operationID)
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || generation == 0 ||
		parseErr != nil || parsed.String() != operationID || c.Request.Context().Err() != nil {
		return empty, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return empty, denied
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	var result localPushOperationIntentObservation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil {
			return denied
		}
		var latest meta.LocalPushOperationIntent
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ?", sourceID).Order("generation DESC").Take(&latest).Error; err != nil {
			return denied
		}
		if latest.IssuedAt.IsZero() || !latest.ExpiresAt.After(latest.IssuedAt) ||
			latest.ID != operationID || latest.Generation != generation ||
			latest.OwnerID != owner.ID || latest.OwnerSession != owner.SessionVersion ||
			latest.SourceRevision != source.Revision || latest.TargetNodeID != *source.TargetNodeID ||
			latest.DeviceID != proof.DeviceID || latest.RootID != proof.RootID ||
			latest.RootFingerprint != fingerprint {
			return denied
		}
		// Reservation state alone is never a trustworthy no-COMMIT answer.
		// The first-leaf writer holds this latest Operation row FOR UPDATE
		// through its SQL COMMIT; our SHARE lock serializes this source-wide
		// read with the writer. Older committed generations count too.
		// A missing/corrupt immutable receipt table is uncertainty, not
		// permission to report "reserved", "aborted" or "expired".
		var committed meta.LocalPushFirstLeafOperationCommit
		probe := tx.Model(&meta.LocalPushFirstLeafOperationCommit{}).
			Select("operation_id").Where("source_id = ?", sourceID).
			Limit(1).Find(&committed)
		if probe.Error != nil || probe.RowsAffected != 0 {
			return denied
		}
		switch {
		case latest.State == meta.LocalPushOperationIntentAborted && latest.AbortedAt != nil &&
			!latest.AbortedAt.Before(latest.IssuedAt) && !latest.AbortedAt.After(latest.ExpiresAt):
			// Durable abort is observable while the identical generation is
			// still latest, even after the original reservation has expired.
			result = localPushOperationIntentObservation{state: meta.LocalPushOperationIntentAborted, generation: generation}
		case latest.State == meta.LocalPushOperationIntentReserved && latest.AbortedAt == nil:
			state := meta.LocalPushOperationIntentReserved
			if !now.Before(latest.ExpiresAt) {
				state = localPushOperationIntentObservedExpired
			}
			result = localPushOperationIntentObservation{state: state, generation: generation}
		default:
			return denied
		}
		return ctx.Err()
	})
	if err != nil || ctx.Err() != nil {
		return empty, denied
	}
	return result, nil
}
