package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// localSourceDraftReadDTO is a strict allowlist. A source's creating-device
// claim is used only in the query, never serialized. No local path, Root ID,
// credential, ignore rules, checkpoint or error is returned to the UI.
type localSourceDraftReadDTO struct {
	SourceID  uint64    `json:"source_id"`
	Name      string    `json:"name"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
}

// listOwningLocalSourceDrafts is NOT a general owner-JWT Source listing.
// Its private device-token boundary is mandatory even if another Desktop
// has the same login and would otherwise be authorized for B-scope reads.
func (s *Server) listOwningLocalSourceDrafts(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	deviceID, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil {
		fail(c, http.StatusForbidden, "owning local device credential required")
		return
	}
	var device meta.ClientDevice
	db := s.DB.WithContext(c.Request.Context())
	if err := db.Where("id = ? AND owner_id = ?", deviceID.String(), userID(c)).
		Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "owning local device credential invalid")
		} else {
			fail(c, http.StatusInternalServerError, "verify local draft device failed")
		}
		return
	}
	if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		fail(c, http.StatusForbidden, "owning local device credential invalid or revoked")
		return
	}
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = value
	}
	var afterID uint64
	if raw := strings.TrimSpace(c.Query("after_id")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			fail(c, http.StatusBadRequest, "after_id must be a nonnegative integer")
			return
		}
		afterID = value
	}
	var sources []meta.Source
	// First-time, never-bound drafts only. A historic Source that was
	// unbound later has a higher revision and must not appear as a new draft.
	query := db.Model(&meta.Source{}).Select("id", "name", "revision", "created_at").
		Where("owner_id = ? AND local_creator_device_id = ? AND kind = ? AND direction = ?",
			userID(c), device.ID, meta.SourceKindLocalFolder, meta.SourceDirectionPush).
		Where("status = ? AND revision = ? AND run_requested_at IS NULL", meta.SourceStatusPaused, 1).
		Where("last_run_at IS NULL AND last_success_at IS NULL AND checkpoint = ''").
		Where("id > ?", afterID).
		Where("NOT EXISTS (SELECT 1 FROM xd_local_source_bindings b WHERE b.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_sync_runs r WHERE r.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_source_items i WHERE i.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_source_run_failures f WHERE f.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_source_collections cl WHERE cl.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_source_credentials cr WHERE cr.source_id = xd_sources.id)").
		Where("NOT EXISTS (SELECT 1 FROM xd_source_connector_configs cc WHERE cc.source_id = xd_sources.id)").
		Order("id ASC").Limit(limit + 1)
	if err := query.Find(&sources).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list local draft sources failed")
		return
	}
	hasMore := len(sources) > limit
	if hasMore {
		sources = sources[:limit]
	}
	out := make([]localSourceDraftReadDTO, 0, len(sources))
	for _, source := range sources {
		out = append(out, localSourceDraftReadDTO{
			SourceID: source.ID, Name: source.Name,
			Revision: source.Revision, CreatedAt: source.CreatedAt,
		})
	}
	var nextAfter uint64
	if hasMore && len(out) > 0 {
		nextAfter = out[len(out)-1].SourceID
	}
	c.JSON(http.StatusOK, gin.H{"items": out, "has_more": hasMore, "next_after_id": nextAfter})
}
