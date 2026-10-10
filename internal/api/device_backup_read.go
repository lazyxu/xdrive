package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Only allowlisted aggregate fields are exposed to another Desktop or Web.
// Never return Source.Checkpoint/IgnoreRules/LastError, SyncRun.Error,
// ActiveTransferPath, SourceItem paths, Root fingerprints or device credentials.
type deviceBackupRunReadDTO struct {
	ID                string     `json:"id"`
	SourceID          uint64     `json:"source_id"`
	RunNumber         int64      `json:"run_number"`
	Mode              string     `json:"mode"`
	Trigger           string     `json:"trigger"`
	Status            string     `json:"status"`
	ScannedItems      int64      `json:"scanned_items"`
	ScannedBytes      int64      `json:"scanned_bytes"`
	IgnoredItems      int64      `json:"ignored_items"`
	NewItems          int64      `json:"new_items"`
	ChangedItems      int64      `json:"changed_items"`
	MovedItems        int64      `json:"moved_items"`
	UnchangedItems    int64      `json:"unchanged_items"`
	PlannedBytes      int64      `json:"planned_transfer_bytes"`
	TransferredItems  int64      `json:"transferred_items"`
	TransferredBytes  int64      `json:"transferred_bytes"`
	FailedItems       int64      `json:"failed_items"`
	ActiveBytes       int64      `json:"active_transfer_bytes"`
	ActiveTotalBytes  int64      `json:"active_transfer_total_bytes"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt         time.Time  `json:"started_at"`
	FinishedAt        *time.Time `json:"finished_at,omitempty"`
}

func safeDeviceBackupRun(run meta.SyncRun) deviceBackupRunReadDTO {
	return deviceBackupRunReadDTO{
		ID: run.ID, SourceID: run.SourceID, RunNumber: run.RunNumber,
		Mode: run.Mode, Trigger: run.Trigger, Status: run.Status,
		ScannedItems: run.ScannedItems, ScannedBytes: run.ScannedBytes,
		IgnoredItems: run.IgnoredItems, NewItems: run.NewItems,
		ChangedItems: run.ChangedItems, MovedItems: run.MovedItems,
		UnchangedItems: run.UnchangedItems, PlannedBytes: run.PlannedTransferBytes,
		TransferredItems: run.TransferredItems, TransferredBytes: run.TransferredBytes,
		FailedItems: run.FailedItems, ActiveBytes: run.ActiveTransferBytes,
		ActiveTotalBytes: run.ActiveTransferTotal, CancelRequestedAt: run.CancelRequestedAt,
		StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
	}
}

type deviceBackupFolderReadDTO struct {
	SourceID   uint64                  `json:"source_id"`
	Name       string                  `json:"name"`
	TargetPath string                  `json:"target_path,omitempty"`
	SyncMode   string                  `json:"sync_mode"`
	Status     string                  `json:"status"`
	LatestRun  *deviceBackupRunReadDTO `json:"latest_run,omitempty"`
}

type deviceBackupReadDTO struct {
	ID              string                      `json:"id"`
	Name            string                      `json:"name"`
	Platform        string                      `json:"platform"`
	ClientVersion   string                      `json:"client_version,omitempty"`
	LastSeenAt      *time.Time                  `json:"last_seen_at,omitempty"`
	ConnectionState string                      `json:"connection_state"`
	Revoked         bool                        `json:"revoked"`
	Folders         []deviceBackupFolderReadDTO `json:"folders"`
}

// listDeviceBackupOverview is owner-scoped and strictly read-only.
// A device registration/binding timestamp is not proof of active heartbeat:
// connection_state must remain unknown until an authenticated live probe ships.
func (s *Server) listDeviceBackupOverview(c *gin.Context) {
	db := s.DB.WithContext(c.Request.Context())
	uid := userID(c)
	var devices []meta.ClientDevice
	if err := db.Where("owner_id = ?", uid).
		Order("created_at DESC, id DESC").Limit(101).Find(&devices).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list backup devices failed")
		return
	}
	hasMore := len(devices) > 100
	if hasMore {
		devices = devices[:100]
	}
	items := make([]deviceBackupReadDTO, 0, len(devices))
	deviceIDs := make([]string, 0, len(devices))
	indices := make(map[string]int, len(devices))
	for _, device := range devices {
		indices[device.ID] = len(items)
		deviceIDs = append(deviceIDs, device.ID)
		items = append(items, deviceBackupReadDTO{
			ID: device.ID, Name: device.Name, Platform: device.Platform,
			ClientVersion: device.ClientVersion, LastSeenAt: device.LastSeenAt,
			ConnectionState: "unknown", Revoked: device.RevokedAt != nil,
			Folders: make([]deviceBackupFolderReadDTO, 0),
		})
	}
	if len(deviceIDs) == 0 {
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"devices": items, "has_more": hasMore, "has_more_folders": false})
		return
	}

	var bindings []meta.LocalSourceBinding
	if err := db.Where("owner_id = ? AND device_id IN ?", uid, deviceIDs).
		Order("source_id ASC").Limit(1001).Find(&bindings).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list backup folder bindings failed")
		return
	}
	hasMoreFolders := len(bindings) > 1000
	if hasMoreFolders {
		bindings = bindings[:1000]
	}
	sourceIDs := make([]uint64, 0, len(bindings))
	bySource := make(map[uint64]string, len(bindings))
	for _, binding := range bindings {
		if _, ok := indices[binding.DeviceID]; !ok {
			continue
		}
		sourceIDs = append(sourceIDs, binding.SourceID)
		bySource[binding.SourceID] = binding.DeviceID
	}
	if len(sourceIDs) != 0 {
		var sources []meta.Source
		if err := db.Where("owner_id = ? AND id IN ? AND kind = ? AND direction = ?",
			uid, sourceIDs, meta.SourceKindLocalFolder, meta.SourceDirectionPush).
			Order("id ASC").Find(&sources).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list backup sources failed")
			return
		}
		var latest []meta.SyncRun
		// One latest run per Source. Never load all runs or SourceItems into the UI.
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
			idx, ok := indices[bySource[source.ID]]
			if !ok {
				continue
			}
			folder := deviceBackupFolderReadDTO{
				SourceID: source.ID, Name: source.Name,
				TargetPath: s.sourceDTO(source).TargetPath,
				SyncMode:   source.SyncMode, Status: source.Status,
			}
			if run, found := byRun[source.ID]; found {
				copy := run
				folder.LatestRun = &copy
			}
			items[idx].Folders = append(items[idx].Folders, folder)
		}
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{
		"devices": items, "has_more": hasMore, "has_more_folders": hasMoreFolders,
	})
}

// listDeviceBackupRunSummaries is the only foreign-device history view.
// It omits raw run errors, active local paths and per-file failure details.
func (s *Server) listDeviceBackupRunSummaries(c *gin.Context) {
	id, ok := parseID(c.Param("sourceID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	uid := userID(c)
	db := s.DB.WithContext(c.Request.Context())
	var source meta.Source
	if err := db.Where("id = ? AND owner_id = ? AND kind = ? AND direction = ?",
		id, uid, meta.SourceKindLocalFolder, meta.SourceDirectionPush).
		Take(&source).Error; err != nil {
		fail(c, http.StatusNotFound, "backup folder not found")
		return
	}
	var binding meta.LocalSourceBinding
	if err := db.Where("source_id = ? AND owner_id = ?", source.ID, uid).
		Take(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "backup folder not found")
		} else {
			fail(c, http.StatusInternalServerError, "lookup backup folder binding failed")
		}
		return
	}
	limit := 20
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = n
	}
	offset := 0
	if v := strings.TrimSpace(c.Query("offset")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = n
	}
	var runs []meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).
		Order("started_at DESC, id DESC").Limit(limit + 1).Offset(offset).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list backup history failed")
		return
	}
	hasMore := len(runs) > limit
	if hasMore {
		runs = runs[:limit]
	}
	out := make([]deviceBackupRunReadDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, safeDeviceBackupRun(run))
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"items": out, "has_more": hasMore})
}
