package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errSourceArchived    = errors.New("source is archived")
	errSourceNotArchived = errors.New("source is not archived")
)

// archiveSource retains the canonical Source ID, target Node/CAS, SourceItems,
// Runs, credentials and collection history. It only stops future scheduling and
// manual runs. An already running Run must finish or be cancelled first, so
// the archive boundary is not an implicit data-transfer cancellation.
func (s *Server) archiveSource(c *gin.Context) {
	s.setSourceArchiveState(c, true)
}

// restoreArchivedSource makes the original Source visible again, but leaves it
// paused. The Owner must explicitly revalidate credentials/bindings and resume;
// restore must not start unexpected external transfers.
func (s *Server) restoreArchivedSource(c *gin.Context) {
	s.setSourceArchiveState(c, false)
}

func (s *Server) setSourceArchiveState(c *gin.Context, archive bool) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}

	var currentRevision uint64
	var updated meta.Source
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Historical Synology Photos Push may only be archived by its Owner,
		// without resuming execution or deleting any Source/Target/CAS data.
		// Other Source types retain their original device/Root proof.
		var identity meta.Source
		if err := tx.Select("kind", "direction").
			Where("id = ? AND owner_id = ?", id, userID(c)).Take(&identity).Error; err != nil {
			return err
		}
		if isRetiredSynologyPhotosPush(identity) {
			if !archive {
				return errLocalSourceExecutorTransactionUnauthorized
			}
		} else if err := s.requireLocalSourceMutationTx(tx, c, id); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).
			Take(&updated).Error; err != nil {
			return err
		}
		currentRevision = updated.Revision
		if updated.Revision != expected {
			return errRevisionConflict
		}
		if archive {
			if updated.Status == meta.SourceStatusArchived {
				return nil
			}
			var running int64
			if err := tx.Model(&meta.SyncRun{}).
				Where("source_id = ? AND status = ?", updated.ID, meta.SyncRunStatusRunning).
				Count(&running).Error; err != nil {
				return err
			}
			if running != 0 {
				if !isRetiredSynologyPhotosPush(updated) {
					return errSourceRunActive
				}
				// Retired DSM Photos Push cannot finish orphaned old runs.
				// Only these runs are cancelled in the Source-locked transaction;
				// original files, identity, stats and CAS remain untouched.
				cancelledAt := time.Now().UTC()
				if err := tx.Model(&meta.SyncRun{}).
					Where("source_id = ? AND status = ?", updated.ID, meta.SyncRunStatusRunning).
					Updates(map[string]any{
						"status":                meta.SyncRunStatusCancelled,
						"cancel_requested_at":   cancelledAt,
						"finished_at":           cancelledAt,
						"error":                 gorm.Expr("CASE WHEN COALESCE(\"error\", '') = '' THEN ? ELSE \"error\" END", "DSM Photos Push retired before run completed"),
						"active_transfer_path":  "",
						"active_transfer_bytes": 0,
						"active_transfer_total": 0,
						"updated_at":            cancelledAt,
					}).Error; err != nil {
					return err
				}
			}
		} else if updated.Status != meta.SourceStatusArchived {
			return errSourceNotArchived
		}

		nextStatus := meta.SourceStatusArchived
		if !archive {
			nextStatus = meta.SourceStatusPaused
		}
		now := time.Now().UTC()
		changed := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ? AND revision = ?", updated.ID, updated.OwnerID, expected).
			Updates(map[string]any{
				"status":           nextStatus,
				"revision":         gorm.Expr("revision + 1"),
				"run_requested_at": nil,
				"retry_at":         nil,
				"retry_attempt":    0,
				"retry_class":      "",
				"updated_at":       now,
			})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return errRevisionConflict
		}
		// Clear the pre-update snapshot before reloading. GORM may otherwise
		// retain pointer fields whose database value was set to NULL (notably
		// run_requested_at) in the already-populated destination struct.
		updated = meta.Source{}
		return tx.Where("id = ? AND owner_id = ?", id, userID(c)).
			Take(&updated).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errSourceRunActive):
			fail(c, http.StatusConflict, "source has an active run; cancel or finish it before archive")
		case errors.Is(err, errSourceNotArchived):
			fail(c, http.StatusConflict, "source is not archived")
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "change Source archival state failed")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("ETag", strconv.Quote(strconv.FormatUint(updated.Revision, 10)))
	c.JSON(http.StatusOK, s.sourceDTO(updated))
}
