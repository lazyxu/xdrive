package api

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm/clause"
)

// readBoundLocalPushOriginalPhysicalTerminalPinned is an INTERNAL, read-only
// original-Operation replay primitive. A previously inserted physical-COMMIT
// terminal is useful only if its exact immutable Stage/Operation/key and the
// current owning Owner/Device/Root still match and the canonical Local CAS
// bytes remain physically pinned and hash verified in the SAME SQL window.
//
// This does NOT create a terminal, authenticate the original native Writer,
// prove physical-CANCEL quiescence, retire Stage/key/Writer or start SourceRun.
// Keep it UNROUTED until the trusted owning-Agent bridge and private replay
// transport have been independently implemented and tested.
func (s *Server) readBoundLocalPushOriginalPhysicalTerminalPinned(
	c *gin.Context, sourceID, revision uint64, stageID string,
	requestKey []byte, operationID string, generation uint64,
) (meta.LocalPushFileTerminal, error) {
	var empty meta.LocalPushFileTerminal
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || s.Store == nil ||
		c == nil || c.Request == nil || c.Request.Context().Err() != nil ||
		sourceID == 0 || revision == 0 || stageID == "" ||
		generation == 0 || !validLocalPushPrepareOperationUUID(operationID) {
		return empty, denied
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return empty, denied
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	tx := s.DB.WithContext(ctx).Begin()
	if tx.Error != nil || !localPushFileTerminalHeldTx(tx) {
		return empty, denied
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback().Error
		}
	}()

	// Existing B1 historical inspector retains all Owner/Device/Root/Source
	// and original Operation+Stage+key locks. It also rejects mismatched
	// physical COMMIT-vs-CANCEL records. No current Stage or lease inference.
	terminal, err := s.inspectBoundLocalPushFileTerminalTx(
		tx, c, sourceID, revision, requestKey, operationID, generation, stageID)
	if err != nil || terminal.State != meta.LocalPushFileTerminalPhysicalCommit ||
		terminal.NodeID == 0 || terminal.SourceItemID == 0 ||
		!validLocalEvidenceDigest(terminal.ContentSHA256) ||
		!validLocalEvidenceDigest(terminal.NativeWitnessSHA256) ||
		terminal.TotalSize < 0 || terminal.TotalSize > localPushStageMaxBytes {
		return empty, denied
	}

	// A source-wide historical terminal is immutable and exclusive. A missing
	// migration or conflicting synthetic row must never count as success.
	var count int64
	if err := tx.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", sourceID).Count(&count).Error; err != nil || count != 1 {
		return empty, denied
	}

	// Canonical content-addressed bytes are rechecked under the SAME SQL
	// locks. A digest stored in SQL is not proof that the physical CAS exists.
	if err := lockContentHash(tx, terminal.ContentSHA256); err != nil {
		return empty, denied
	}
	casKey, err := storage.ContentAddressedKey(terminal.ContentSHA256)
	if err != nil {
		return empty, denied
	}
	var blob meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("sha256 = ?", terminal.ContentSHA256).Take(&blob).Error; err != nil ||
		blob.State != meta.ContentBlobStateReady ||
		blob.StorageKey != casKey || blob.Size != terminal.TotalSize ||
		blob.RefCount < 1 {
		return empty, denied
	}

	// Commit the read-only transaction only inside the real Local CAS pinned
	// double-hash callback. A network/SQL failure after callback entry is
	// uncertain and never a negative terminal or permission to retry.
	callbackRan := false
	matched, err := local.InspectPinnedLocalPushHistoricalCAS(
		ctx, casKey, terminal.TotalSize, func(heldCtx context.Context) error {
			callbackRan = true
			if err := heldCtx.Err(); err != nil {
				return err
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			return nil
		})
	if err != nil || !matched || !callbackRan || !committed || ctx.Err() != nil {
		return empty, denied
	}
	return terminal, nil
}
