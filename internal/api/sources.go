package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type sourceDTO struct {
	ID             uint64     `json:"id"`
	Name           string     `json:"name"`
	Kind           string     `json:"kind"`
	Direction      string     `json:"direction"`
	SyncMode       string     `json:"sync_mode"`
	RunMode        string     `json:"run_mode"`
	Status         string     `json:"status"`
	Revision       uint64     `json:"revision"`
	TargetNodeID   *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules    string     `json:"ignore_rules,omitempty"`
	Checkpoint     string     `json:"checkpoint,omitempty"`
	LastRunAt      *time.Time `json:"last_run_at,omitempty"`
	LastSuccessAt  *time.Time `json:"last_success_at,omitempty"`
	LastError      string     `json:"last_error,omitempty"`
	RunRequestedAt *time.Time `json:"run_requested_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type syncRunDTO struct {
	ID                   string     `json:"id"`
	SourceID             uint64     `json:"source_id"`
	SourceRevision       uint64     `json:"source_revision"`
	TargetNodeID         *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules          string     `json:"ignore_rules,omitempty"`
	Mode                 string     `json:"mode"`
	Trigger              string     `json:"trigger"`
	Status               string     `json:"status"`
	CheckpointBefore     string     `json:"checkpoint_before,omitempty"`
	CheckpointAfter      string     `json:"checkpoint_after,omitempty"`
	ScannedItems         int64      `json:"scanned_items"`
	ScannedBytes         int64      `json:"scanned_bytes"`
	IgnoredItems         int64      `json:"ignored_items"`
	IgnoredBytes         int64      `json:"ignored_bytes"`
	NewItems             int64      `json:"new_items"`
	NewBytes             int64      `json:"new_bytes"`
	ChangedItems         int64      `json:"changed_items"`
	ChangedBytes         int64      `json:"changed_bytes"`
	MovedItems           int64      `json:"moved_items"`
	UnchangedItems       int64      `json:"unchanged_items"`
	UnchangedBytes       int64      `json:"unchanged_bytes"`
	MissingItems         int64      `json:"missing_items"`
	MissingBytes         int64      `json:"missing_bytes"`
	PlannedTransferItems int64      `json:"planned_transfer_items"`
	PlannedTransferBytes int64      `json:"planned_transfer_bytes"`
	CreatedItems         int64      `json:"created_items"`
	UpdatedItems         int64      `json:"updated_items"`
	SkippedItems         int64      `json:"skipped_items"`
	TransferredItems     int64      `json:"transferred_items"`
	TransferredBytes     int64      `json:"transferred_bytes"`
	FailedItems          int64      `json:"failed_items"`
	Error                string     `json:"error,omitempty"`
	StartedAt            time.Time  `json:"started_at"`
	FinishedAt           *time.Time `json:"finished_at,omitempty"`
}

func toSourceDTO(source meta.Source) sourceDTO {
	return sourceDTO{
		ID: source.ID, Name: source.Name, Kind: source.Kind, Direction: source.Direction,
		SyncMode: source.SyncMode, RunMode: source.RunMode, Status: source.Status,
		Revision: source.Revision, TargetNodeID: source.TargetNodeID, IgnoreRules: source.IgnoreRules,
		Checkpoint: source.Checkpoint, LastRunAt: source.LastRunAt, LastSuccessAt: source.LastSuccessAt,
		LastError: source.LastError, RunRequestedAt: source.RunRequestedAt,
		CreatedAt: source.CreatedAt, UpdatedAt: source.UpdatedAt,
	}
}

func toSyncRunDTO(run meta.SyncRun) syncRunDTO {
	return syncRunDTO{
		ID: run.ID, SourceID: run.SourceID, SourceRevision: run.SourceRevision,
		TargetNodeID: run.TargetNodeID, IgnoreRules: run.IgnoreRules,
		Mode: run.Mode, Trigger: run.Trigger, Status: run.Status,
		CheckpointBefore: run.CheckpointBefore, CheckpointAfter: run.CheckpointAfter,
		ScannedItems: run.ScannedItems, ScannedBytes: run.ScannedBytes,
		IgnoredItems: run.IgnoredItems, IgnoredBytes: run.IgnoredBytes,
		NewItems: run.NewItems, NewBytes: run.NewBytes, ChangedItems: run.ChangedItems, ChangedBytes: run.ChangedBytes,
		MovedItems: run.MovedItems, UnchangedItems: run.UnchangedItems, UnchangedBytes: run.UnchangedBytes,
		MissingItems: run.MissingItems, MissingBytes: run.MissingBytes,
		PlannedTransferItems: run.PlannedTransferItems, PlannedTransferBytes: run.PlannedTransferBytes,
		CreatedItems: run.CreatedItems, UpdatedItems: run.UpdatedItems, SkippedItems: run.SkippedItems,
		TransferredItems: run.TransferredItems, TransferredBytes: run.TransferredBytes,
		FailedItems: run.FailedItems, Error: run.Error, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
	}
}

func (s *Server) listSources(c *gin.Context) {
	var sources []meta.Source
	if err := s.DB.Where("owner_id = ?", userID(c)).Order("lower(name) ASC, id ASC").Find(&sources).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list sources failed")
		return
	}
	out := make([]sourceDTO, 0, len(sources))
	for _, source := range sources {
		out = append(out, toSourceDTO(source))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) createSource(c *gin.Context) {
	var req struct {
		Name         string `json:"name"`
		Kind         string `json:"kind"`
		Direction    string `json:"direction"`
		SyncMode     string `json:"sync_mode"`
		RunMode      string `json:"run_mode"`
		TargetNodeID uint64 `json:"target_node_id"`
		IgnoreRules  string `json:"ignore_rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Kind = strings.TrimSpace(req.Kind)
	req.Direction = strings.TrimSpace(req.Direction)
	req.SyncMode = strings.TrimSpace(req.SyncMode)
	req.RunMode = strings.TrimSpace(req.RunMode)
	if req.SyncMode == "" {
		req.SyncMode = meta.SourceSyncModeBackup
	}
	if req.RunMode == "" {
		req.RunMode = meta.SourceRunModeSync
	}
	if !meta.ValidSourceName(req.Name) || !meta.ValidSourceKind(req.Kind) || !meta.ValidSourceDirection(req.Direction) {
		fail(c, http.StatusBadRequest, "invalid source name, kind, or direction")
		return
	}
	if req.SyncMode != meta.SourceSyncModeBackup {
		fail(c, http.StatusBadRequest, "only backup sync_mode is currently supported")
		return
	}
	if !meta.ValidSourceRunMode(req.RunMode) {
		fail(c, http.StatusBadRequest, "invalid run_mode")
		return
	}
	if req.TargetNodeID == 0 {
		fail(c, http.StatusBadRequest, "target_node_id is required")
		return
	}
	if _, err := sourcepkg.CompileIgnoreRules(req.IgnoreRules); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.ownedDirectory(userID(c), req.TargetNodeID); err != nil {
		fail(c, http.StatusBadRequest, "target directory not found")
		return
	}
	target := req.TargetNodeID
	source := meta.Source{
		OwnerID: userID(c), Name: req.Name, Kind: req.Kind, Direction: req.Direction,
		SyncMode: meta.SourceSyncModeBackup, RunMode: req.RunMode, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &target, IgnoreRules: req.IgnoreRules,
	}
	if err := s.DB.Create(&source).Error; err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "source name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "create source failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusCreated, toSourceDTO(source))
}

func (s *Server) getSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), id)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusOK, toSourceDTO(source))
}

func (s *Server) updateSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var req struct {
		Name         *string `json:"name"`
		RunMode      *string `json:"run_mode"`
		Status       *string `json:"status"`
		TargetNodeID *uint64 `json:"target_node_id"`
		IgnoreRules  *string `json:"ignore_rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}

	var updated meta.Source
	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var current meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&current).Error; err != nil {
			return err
		}
		currentRevision = current.Revision
		if current.Revision != expected {
			return errRevisionConflict
		}
		updates := map[string]any{}
		if req.Name != nil {
			name := strings.TrimSpace(*req.Name)
			if !meta.ValidSourceName(name) {
				return errInvalidSourceConfig
			}
			var count int64
			if err := tx.Model(&meta.Source{}).
				Where("owner_id = ? AND id <> ? AND lower(name) = lower(?)", userID(c), id, name).
				Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errSourceNameTaken
			}
			updates["name"] = name
		}
		if req.RunMode != nil {
			mode := strings.TrimSpace(*req.RunMode)
			if !meta.ValidSourceRunMode(mode) {
				return errInvalidSourceConfig
			}
			updates["run_mode"] = mode
		}
		if req.Status != nil {
			status := strings.TrimSpace(*req.Status)
			if !meta.ValidSourceStatus(status) {
				return errInvalidSourceConfig
			}
			updates["status"] = status
		}
		if req.TargetNodeID != nil {
			if *req.TargetNodeID == 0 {
				return errInvalidSourceTarget
			}
			var target meta.Node
			if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*req.TargetNodeID, userID(c), meta.NodeTypeDir).First(&target).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errInvalidSourceTarget
				}
				return err
			}
			updates["target_node_id"] = target.ID
		}
		if req.IgnoreRules != nil {
			if _, err := sourcepkg.CompileIgnoreRules(*req.IgnoreRules); err != nil {
				return errInvalidSourceConfig
			}
			updates["ignore_rules"] = *req.IgnoreRules
		}
		if len(updates) == 0 {
			updated = current
			return nil
		}
		updates["revision"] = gorm.Expr("revision + 1")
		updates["updated_at"] = time.Now()
		if err := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ? AND revision = ?", id, userID(c), expected).
			Updates(updates).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND owner_id = ?", id, userID(c)).First(&updated).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errSourceNameTaken), isDuplicate(err):
			fail(c, http.StatusConflict, "source name already exists")
		case errors.Is(err, errInvalidSourceTarget):
			fail(c, http.StatusBadRequest, "target directory not found")
		case errors.Is(err, errInvalidSourceConfig):
			fail(c, http.StatusBadRequest, "invalid source configuration")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "update source failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(updated.Revision, 10)))
	c.JSON(http.StatusOK, toSourceDTO(updated))
}

func (s *Server) triggerSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}

	now := time.Now().UTC()
	var source meta.Source
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		if source.Status != meta.SourceStatusActive {
			return errSourcePaused
		}
		if err := tx.Model(&meta.Source{}).Where("id = ?", source.ID).Updates(map[string]any{
			"run_requested_at": now,
			"updated_at":       now,
		}).Error; err != nil {
			return err
		}
		source.RunRequestedAt = &now
		source.UpdatedAt = now
		return nil
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, toSourceDTO(source))
}

func (s *Server) deleteSource(c *gin.Context) {
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
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Revision != expected {
			return errRevisionConflict
		}
		return tx.Delete(&source).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "delete source failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) listSourceRuns(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), id); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = value
	}
	var runs []meta.SyncRun
	if err := s.DB.Where("source_id = ?", id).Order("started_at DESC, id DESC").Limit(limit).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source runs failed")
		return
	}
	out := make([]syncRunDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, toSyncRunDTO(run))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) getSourceRun(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), id); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	runID := strings.TrimSpace(c.Param("runID"))
	if runID == "" {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	var run meta.SyncRun
	if err := s.DB.Where("id = ? AND source_id = ?", runID, id).First(&run).Error; err != nil {
		fail(c, http.StatusNotFound, "source run not found")
		return
	}
	c.JSON(http.StatusOK, toSyncRunDTO(run))
}

func (s *Server) ownedSource(uid, id uint64) (meta.Source, error) {
	var source meta.Source
	return source, s.DB.Where("id = ? AND owner_id = ?", id, uid).First(&source).Error
}

var (
	errInvalidSourceConfig = errors.New("invalid source configuration")
	errInvalidSourceTarget = errors.New("invalid source target")
	errSourceNameTaken     = errors.New("source name taken")
)
