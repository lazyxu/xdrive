package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errLocalDraftUnauthorized = errors.New("owning device credential required for local draft")
	errLocalDraftNotEmpty     = errors.New("local draft has binding or history")
	errLocalDraftWrongType    = errors.New("local folder push draft required")
)

// discardLocalSourceDraft is intentionally distinct from DELETE /sources/:id.
// The generic endpoint continues to require an authorized Root for bound Push.
// This endpoint deletes only an empty, paused, never-bound local creation
// draft; no remotely stored files, SourceItems, runs or Root grants are touched.
func (s *Server) discardLocalSourceDraft(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	parsed, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil {
		fail(c, http.StatusForbidden, "owning device credential required")
		return
	}
	deviceID := parsed.String()
	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Match revocation and first-bind ordering: device lock precedes
		// Source lock. Recheck the secret and status inside the write txn.
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", deviceID, userID(c)).
			Take(&device).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errLocalDraftUnauthorized
			}
			return err
		}
		if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
			return errLocalDraftUnauthorized
		}
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).
			Take(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush {
			return errLocalDraftWrongType
		}
		// A legacy unclaimed draft must not be reclaimed by a new device
		// simply because that device has the same account JWT.
		if source.LocalCreatorDeviceID == nil || *source.LocalCreatorDeviceID != device.ID {
			return errLocalDraftUnauthorized
		}
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused || source.RunRequestedAt != nil ||
			source.Checkpoint != "" || source.LastRunAt != nil || source.LastSuccessAt != nil ||
			source.RetryAttempt != 0 || source.RetryAt != nil {
			return errLocalDraftNotEmpty
		}
		// The first bind also locks device then Source. Counts here cannot
		// race a new binding after we acquired both locks. Never cascade
		// deletion of existing history, files, credentials, or collections.
		for _, model := range []any{
			&meta.LocalSourceBinding{},
			&meta.SyncRun{},
			&meta.SourceItem{},
			&meta.SourceRunFailure{},
			&meta.SourceCollection{},
			&meta.SourceCredential{},
			&meta.SourceConnectorConfig{},
		} {
			var count int64
			if err := tx.Model(model).Where("source_id = ?", id).
				Limit(1).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errLocalDraftNotEmpty
			}
		}
		return tx.Delete(&source).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalDraftUnauthorized):
			fail(c, http.StatusForbidden, "owning device credential invalid or revoked")
		case errors.Is(err, errLocalDraftWrongType):
			fail(c, http.StatusBadRequest, "local folder push draft required")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errLocalDraftNotEmpty):
			fail(c, http.StatusConflict, "local draft is bound, active, or has history")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "discard local draft failed")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusNoContent)
}
