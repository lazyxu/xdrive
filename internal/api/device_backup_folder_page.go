package api

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// B-scope pages are owner-readable display summaries, never Root, device
// credential, SourceItem, checkpoint, or per-file failure projections.
// This endpoint complements the legacy 1000-binding overview cap.
func (s *Server) listDeviceBackupFolderPage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid backup folder page query")
		return
	}
	for key, values := range query {
		if (key != "device_id" && key != "limit" && key != "after_source_id") || len(values) != 1 {
			fail(c, http.StatusBadRequest, "invalid backup folder page query")
			return
		}
	}
	rawDevice := query.Get("device_id")
	deviceUUID, err := uuid.Parse(rawDevice)
	if len(query["device_id"]) != 1 || err != nil || deviceUUID.String() != rawDevice {
		fail(c, http.StatusBadRequest, "invalid backup device")
		return
	}
	limit := 100
	if raw, present := query["limit"]; present {
		value, parseErr := strconv.Atoi(raw[0])
		if parseErr != nil || value < 1 || value > 100 || strconv.Itoa(value) != raw[0] {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = value
	}
	var cursor uint64
	if raw, present := query["after_source_id"]; present {
		value, parseErr := strconv.ParseUint(raw[0], 10, 64)
		if parseErr != nil || value == 0 || strconv.FormatUint(value, 10) != raw[0] {
			fail(c, http.StatusBadRequest, "invalid backup folder cursor")
			return
		}
		cursor = value
	}
	db := s.DB.WithContext(c.Request.Context())
	uid := userID(c)
	var device meta.ClientDevice
	if err := db.Select("id").Where("id = ? AND owner_id = ?", rawDevice, uid).
		Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "backup device not found")
		} else {
			fail(c, http.StatusInternalServerError, "lookup backup device failed")
		}
		return
	}
	// The INNER JOIN excludes malformed/stale bindings and legacy NAS Push.
	// It also ensures has_more counts only valid owner-local-folder Sources.
	scoped := func() *gorm.DB {
		return db.Model(&meta.Source{}).
			Joins("JOIN xd_local_source_bindings b ON b.source_id = xd_sources.id AND b.owner_id = xd_sources.owner_id").
			Where("b.owner_id = ? AND b.device_id = ? AND xd_sources.owner_id = ? AND xd_sources.kind = ? AND xd_sources.direction = ?",
				uid, device.ID, uid, meta.SourceKindLocalFolder, meta.SourceDirectionPush)
	}
	if cursor != 0 {
		var anchor meta.Source
		if err := scoped().Where("xd_sources.id = ?", cursor).Take(&anchor).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusBadRequest, "invalid backup folder cursor")
			} else {
				fail(c, http.StatusInternalServerError, "lookup backup folder cursor failed")
			}
			return
		}
	}
	var sources []meta.Source
	if err := scoped().Select("xd_sources.*").
		Where("xd_sources.id > ?", cursor).
		Order("xd_sources.id ASC").Limit(limit + 1).
		Find(&sources).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list backup folders failed")
		return
	}
	hasMore := len(sources) > limit
	if hasMore {
		sources = sources[:limit]
	}
	var nextAfter uint64
	if hasMore && len(sources) > 0 {
		nextAfter = sources[len(sources)-1].ID
	}
	folders := make([]deviceBackupFolderReadDTO, 0, len(sources))
	if len(sources) != 0 {
		sourceIDs := make([]uint64, 0, len(sources))
		for _, source := range sources {
			sourceIDs = append(sourceIDs, source.ID)
		}
		var latest []meta.SyncRun
		if err := db.Raw(
			"SELECT * FROM (SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.source_id ORDER BY r.started_at DESC, r.id DESC) AS row_no FROM xd_sync_runs r WHERE r.source_id IN ?) ranked WHERE ranked.row_no = 1",
			sourceIDs,
		).Scan(&latest).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list backup run summaries failed")
			return
		}
		byRun := make(map[uint64]deviceBackupRunReadDTO, len(latest))
		for _, run := range latest {
			byRun[run.SourceID] = safeDeviceBackupRun(run)
		}
		for _, source := range sources {
			folder := deviceBackupFolderReadDTO{
				SourceID: source.ID, Name: source.Name,
				TargetPath: s.sourceDTO(source).TargetPath,
				SyncMode:   source.SyncMode, Status: source.Status,
			}
			if run, ok := byRun[source.ID]; ok {
				copy := run
				folder.LatestRun = &copy
			}
			folders = append(folders, folder)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"folders": folders, "has_more": hasMore, "next_after_source_id": nextAfter,
	})
}
