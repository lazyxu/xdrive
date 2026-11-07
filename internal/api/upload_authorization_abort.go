package api

import (
	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// User-facing abort is a durable upload mutation, not a janitor cleanup.
// It must not bypass the Device/Source/Root/Target proof merely because the
// current Owner knows an UploadSession UUID. Janitor cleanup remains separate.
func (s *Server) abortUploadSessionAuthorized(c *gin.Context, session meta.UploadSession) error {
	ctx := c.Request.Context()
	var parts []meta.UploadPart
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).
			Take(&current).Error; err != nil {
			return errManagedSourceWriteDenied
		}
		if current.Status != meta.UploadStatusActive {
			return errUploadFinalized
		}
		if err := s.requireUploadChunkAuthorityTx(ctx, tx, c, current); err != nil {
			return err
		}
		if err := tx.Where("session_id = ?", current.ID).Find(&parts).Error; err != nil {
			return err
		}
		if err := tx.Where("session_id = ?", current.ID).Delete(&meta.UploadPart{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ? AND owner_id = ? AND status = ?",
			current.ID, current.OwnerID, meta.UploadStatusActive).
			Delete(&meta.UploadSession{}).Error; err != nil {
			return err
		}
		return recordUploadAuthorizationSuccessTx(tx, c, "abort.commit", current)
	})
	if err != nil {
		return err
	}
	for _, part := range parts {
		if !part.Reused {
			_ = s.Store.Delete(ctx, part.StorageKey)
		}
	}
	return nil
}
