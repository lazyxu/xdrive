package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	sourceObservationBatchLimit = 500
	sourceRunStaleAfter         = 30 * time.Minute
	sourceRunTextLimit          = 64 << 10
)

type beginSourceRunRequest struct {
	RunID   string `json:"run_id"`
	Trigger string `json:"trigger"`
}

type sourceObservationDTO struct {
	ExternalID     string     `json:"external_id"`
	Kind           string     `json:"kind"`
	Path           string     `json:"path"`
	Size           int64      `json:"size"`
	ModifiedAt     *time.Time `json:"modified_at,omitempty"`
	SHA256         string     `json:"sha256,omitempty"`
	RemoteRevision string     `json:"remote_revision,omitempty"`
}

type observeSourceRunRequest struct {
	Items []sourceObservationDTO `json:"items"`
}

type sourcePlanDTO struct {
	ExternalID   string  `json:"external_id"`
	Action       string  `json:"action"`
	NodeID       *uint64 `json:"node_id,omitempty"`
	NodeRevision uint64  `json:"node_revision,omitempty"`
}

type observeSourceRunResponse struct {
	Plans []sourcePlanDTO `json:"plans"`
}

type finishSourceRunRequest struct {
	Status            string            `json:"status"`
	CompleteInventory bool              `json:"complete_inventory"`
	Checkpoint        string            `json:"checkpoint,omitempty"`
	Summary           sourcepkg.Summary `json:"summary"`
	Error             string            `json:"error,omitempty"`
}

func (s *Server) beginSourceRun(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	var req beginSourceRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	parsedRunID, err := uuid.Parse(strings.TrimSpace(req.RunID))
	if err != nil {
		fail(c, http.StatusBadRequest, "run_id must be a UUID")
		return
	}
	runID := parsedRunID.String()
	req.Trigger = strings.TrimSpace(req.Trigger)
	if req.Trigger == "" {
		req.Trigger = meta.SyncRunTriggerManual
	}
	if !meta.ValidSyncRunTrigger(req.Trigger) {
		fail(c, http.StatusBadRequest, "invalid trigger")
		return
	}

	now := time.Now().UTC()
	var out meta.SyncRun
	created := false
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).First(&source).Error; err != nil {
			return err
		}

		var existing meta.SyncRun
		if err := tx.Where("id = ?", runID).First(&existing).Error; err == nil {
			if existing.SourceID != source.ID {
				return errSourceRunIDConflict
			}
			out = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if source.Status != meta.SourceStatusActive {
			return errSourcePaused
		}
		if source.SyncMode != meta.SourceSyncModeBackup || !meta.ValidSourceRunMode(source.RunMode) {
			return errInvalidSourceConfig
		}
		if source.TargetNodeID == nil {
			return errSourceTargetUnavailable
		}
		var target meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errSourceTargetUnavailable
			}
			return err
		}

		var active meta.SyncRun
		activeErr := tx.Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
			Order("updated_at DESC, started_at DESC").First(&active).Error
		if activeErr == nil {
			heartbeat := active.UpdatedAt
			if heartbeat.IsZero() {
				heartbeat = active.StartedAt
			}
			if now.Sub(heartbeat) <= sourceRunStaleAfter {
				return errSourceRunActive
			}
			finished := now
			if err := tx.Model(&meta.SyncRun{}).Where("id = ?", active.ID).Updates(map[string]any{
				"status":      meta.SyncRunStatusFailed,
				"error":       "stale source run superseded",
				"finished_at": &finished,
				"updated_at":  now,
			}).Error; err != nil {
				return err
			}
		} else if !errors.Is(activeErr, gorm.ErrRecordNotFound) {
			return activeErr
		}

		targetID := target.ID
		out = meta.SyncRun{
			ID: runID, SourceID: source.ID, SourceRevision: source.Revision,
			TargetNodeID: &targetID, IgnoreRules: source.IgnoreRules,
			Mode: source.RunMode, Trigger: req.Trigger, Status: meta.SyncRunStatusRunning,
			CheckpointBefore: source.Checkpoint, StartedAt: now,
		}
		if err := tx.Create(&out).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.Source{}).Where("id = ?", source.ID).
			Updates(map[string]any{"last_run_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, toSyncRunDTO(out))
}

func (s *Server) observeSourceRun(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	runID, ok := canonicalRunID(c.Param("runID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	var req observeSourceRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Items) == 0 || len(req.Items) > sourceObservationBatchLimit {
		fail(c, http.StatusBadRequest, fmt.Sprintf("items must contain 1-%d entries", sourceObservationBatchLimit))
		return
	}

	items := make([]sourcepkg.DiscoveredItem, 0, len(req.Items))
	externalIDs := make([]string, 0, len(req.Items))
	seen := make(map[string]struct{}, len(req.Items))
	for _, raw := range req.Items {
		item := sourcepkg.DiscoveredItem{
			ExternalID: raw.ExternalID, Kind: raw.Kind, Path: raw.Path, Size: raw.Size,
			ModifiedAt: raw.ModifiedAt, SHA256: raw.SHA256, RemoteRevision: raw.RemoteRevision,
		}
		if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		if _, exists := seen[item.ExternalID]; exists {
			fail(c, http.StatusBadRequest, "duplicate external_id in observation batch")
			return
		}
		seen[item.ExternalID] = struct{}{}
		items = append(items, item)
		externalIDs = append(externalIDs, item.ExternalID)
	}

	now := time.Now().UTC()
	var plans []sourcePlanDTO
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).First(&source).Error; err != nil {
			return err
		}
		if source.Status != meta.SourceStatusActive {
			return errSourcePaused
		}

		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != meta.SyncRunStatusRunning {
			return errSourceRunNotRunning
		}
		matcher, err := sourcepkg.CompileIgnoreRules(run.IgnoreRules)
		if err != nil {
			return fmt.Errorf("compile stored ignore rules: %w", err)
		}

		var currentItems []meta.SourceItem
		if err := tx.Where("source_id = ? AND external_id IN ?", sourceID, externalIDs).
			Find(&currentItems).Error; err != nil {
			return err
		}
		currentByExternal := make(map[string]meta.SourceItem, len(currentItems))
		nodeIDs := make([]uint64, 0, len(currentItems))
		for _, item := range currentItems {
			currentByExternal[item.ExternalID] = item
			if item.NodeID != nil {
				nodeIDs = append(nodeIDs, *item.NodeID)
			}
		}

		nodesByID := map[uint64]meta.Node{}
		if len(nodeIDs) != 0 {
			var nodes []meta.Node
			if err := tx.Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", nodeIDs, source.OwnerID).
				Find(&nodes).Error; err != nil {
				return err
			}
			for _, node := range nodes {
				nodesByID[node.ID] = node
			}
		}

		plans = make([]sourcePlanDTO, 0, len(items))
		for _, item := range items {
			current, exists := currentByExternal[item.ExternalID]
			var currentPtr *meta.SourceItem
			if exists {
				if current.NodeID != nil {
					if _, active := nodesByID[*current.NodeID]; !active {
						if err := tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).
							Update("node_id", nil).Error; err != nil {
							return err
						}
						current.NodeID = nil
					}
				}
				copy := current
				currentPtr = &copy
			}

			plan, err := sourcepkg.Plan(currentPtr, item, matcher)
			if err != nil {
				return err
			}
			if err := persistObservedSourceItem(tx, sourceID, runID, now, current, exists, plan); err != nil {
				return err
			}

			dto := sourcePlanDTO{ExternalID: item.ExternalID, Action: string(plan.Action)}
			if currentPtr != nil && currentPtr.NodeID != nil {
				if node, active := nodesByID[*currentPtr.NodeID]; active {
					nodeID := node.ID
					dto.NodeID = &nodeID
					dto.NodeRevision = node.Revision
				}
			}
			plans = append(plans, dto)
		}
		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Update("updated_at", now).Error
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, observeSourceRunResponse{Plans: plans})
}

func (s *Server) heartbeatSourceRun(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	runID, ok := canonicalRunID(c.Param("runID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}

	now := time.Now().UTC()
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Where("id = ? AND owner_id = ?", sourceID, userID(c)).First(&source).Error; err != nil {
			return err
		}
		if source.Status != meta.SourceStatusActive {
			return errSourcePaused
		}
		result := tx.Model(&meta.SyncRun{}).
			Where("id = ? AND source_id = ? AND status = ?", runID, sourceID, meta.SyncRunStatusRunning).
			Update("updated_at", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 0 {
			return nil
		}
		var run meta.SyncRun
		if err := tx.Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		return errSourceRunNotRunning
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) finishSourceRun(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	runID, ok := canonicalRunID(c.Param("runID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	var req finishSourceRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	req.Error = strings.TrimSpace(req.Error)
	if !meta.ValidSyncRunStatus(req.Status) || !meta.SyncRunTerminal(req.Status) {
		fail(c, http.StatusBadRequest, "status must be a terminal sync-run status")
		return
	}
	if len([]byte(req.Checkpoint)) > sourceRunTextLimit || len([]byte(req.Error)) > sourceRunTextLimit {
		fail(c, http.StatusBadRequest, "checkpoint or error text is too large")
		return
	}
	if err := validateSourceSummary(req.Summary); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	now := time.Now().UTC()
	var out meta.SyncRun
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).First(&source).Error; err != nil {
			return err
		}
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != meta.SyncRunStatusRunning {
			out = run
			return nil
		}

		summary := req.Summary
		summary.MissingItems = 0
		summary.MissingBytes = 0
		inventoryComplete := req.CompleteInventory &&
			(req.Status == meta.SyncRunStatusCompleted || req.Status == meta.SyncRunStatusPartial)
		if inventoryComplete {
			matcher, err := sourcepkg.CompileIgnoreRules(run.IgnoreRules)
			if err != nil {
				return fmt.Errorf("compile stored ignore rules: %w", err)
			}
			var unseen []meta.SourceItem
			if err := tx.Where("source_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)", sourceID, runID).
				Find(&unseen).Error; err != nil {
				return err
			}
			for _, item := range unseen {
				if matcher.Ignored(item.Path, item.Kind == meta.SourceItemKindDirectory) {
					if item.State != meta.SourceItemStateIgnored {
						if err := tx.Model(&meta.SourceItem{}).Where("id = ?", item.ID).
							Updates(map[string]any{"state": meta.SourceItemStateIgnored, "last_error": "", "updated_at": now}).Error; err != nil {
							return err
						}
					}
					continue
				}
				summary.AddMissing(item)
				if err := tx.Model(&meta.SourceItem{}).Where("id = ?", item.ID).
					Updates(map[string]any{"state": meta.SourceItemStateMissing, "last_error": "", "updated_at": now}).Error; err != nil {
					return err
				}
			}
		}

		status := req.Status
		if status == meta.SyncRunStatusCompleted && summary.FailedItems > 0 {
			status = meta.SyncRunStatusPartial
		}
		summary.ApplyToSyncRun(&run)
		finished := now
		run.Status = status
		run.CheckpointAfter = req.Checkpoint
		run.Error = req.Error
		run.FinishedAt = &finished
		run.UpdatedAt = now
		if err := tx.Save(&run).Error; err != nil {
			return err
		}

		sourceUpdates := map[string]any{"last_run_at": now, "updated_at": now}
		if status == meta.SyncRunStatusCompleted && inventoryComplete {
			sourceUpdates["last_success_at"] = now
			sourceUpdates["last_error"] = ""
			if req.Checkpoint != "" {
				sourceUpdates["checkpoint"] = req.Checkpoint
			}
		} else {
			msg := req.Error
			if msg == "" && status == meta.SyncRunStatusPartial {
				msg = fmt.Sprintf("%d source items failed", summary.FailedItems)
			}
			if msg == "" {
				msg = "source run " + status
			}
			sourceUpdates["last_error"] = msg
		}
		if err := tx.Model(&meta.Source{}).Where("id = ?", source.ID).Updates(sourceUpdates).Error; err != nil {
			return err
		}
		out = run
		return nil
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, toSyncRunDTO(out))
}

func persistObservedSourceItem(
	tx *gorm.DB,
	sourceID uint64,
	runID string,
	now time.Time,
	current meta.SourceItem,
	exists bool,
	plan sourcepkg.PlanResult,
) error {
	item := plan.Item
	switch plan.Action {
	case sourcepkg.ActionIgnore:
		if !exists {
			return nil
		}
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"state": meta.SourceItemStateIgnored, "last_seen_run_id": runID,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	case sourcepkg.ActionCreate:
		if !exists {
			return tx.Create(&meta.SourceItem{
				SourceID: sourceID, ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path,
				Size: item.Size, ModifiedAt: item.ModifiedAt, SHA256: item.SHA256,
				RemoteRevision: item.RemoteRevision, State: meta.SourceItemStatePending,
				LastSeenRunID: runID, LastSeenAt: now,
			}).Error
		}
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"kind": item.Kind, "path": item.Path, "size": item.Size, "modified_at": item.ModifiedAt,
			"sha256": item.SHA256, "remote_revision": item.RemoteRevision,
			"state": meta.SourceItemStatePending, "last_seen_run_id": runID,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	case sourcepkg.ActionUnchanged:
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"kind": item.Kind, "path": item.Path, "size": item.Size, "modified_at": item.ModifiedAt,
			"sha256": item.SHA256, "remote_revision": item.RemoteRevision,
			"state": meta.SourceItemStateSynced, "last_seen_run_id": runID,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	case sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"state": meta.SourceItemStatePending, "last_seen_run_id": runID,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	default:
		return fmt.Errorf("unsupported source plan action %q", plan.Action)
	}
}

func validateSourceSummary(summary sourcepkg.Summary) error {
	values := []int64{
		summary.ScannedItems, summary.ScannedBytes, summary.IgnoredItems, summary.IgnoredBytes,
		summary.NewItems, summary.NewBytes, summary.ChangedItems, summary.ChangedBytes,
		summary.MovedItems, summary.UnchangedItems, summary.UnchangedBytes,
		summary.MissingItems, summary.MissingBytes, summary.PlannedTransferItems,
		summary.PlannedTransferBytes, summary.FailedItems,
	}
	for _, value := range values {
		if value < 0 {
			return fmt.Errorf("summary values must be zero or greater")
		}
	}
	return nil
}

func canonicalRunID(value string) (string, bool) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

func writeSourceRunError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "source or source run not found")
	case errors.Is(err, errSourcePaused):
		fail(c, http.StatusConflict, "source is paused")
	case errors.Is(err, errSourceTargetUnavailable):
		fail(c, http.StatusConflict, "source target directory is unavailable")
	case errors.Is(err, errSourceRunActive):
		fail(c, http.StatusConflict, "source already has an active run")
	case errors.Is(err, errSourceRunNotRunning):
		fail(c, http.StatusConflict, "source run is not running")
	case errors.Is(err, errSourceRunIDConflict):
		fail(c, http.StatusConflict, "run_id already belongs to another source")
	case errors.Is(err, errInvalidSourceConfig):
		fail(c, http.StatusConflict, "source configuration is not executable")
	default:
		fail(c, http.StatusInternalServerError, "source run operation failed")
	}
}

var (
	errSourcePaused            = errors.New("source paused")
	errSourceTargetUnavailable = errors.New("source target unavailable")
	errSourceRunActive         = errors.New("source run already active")
	errSourceRunNotRunning     = errors.New("source run not running")
	errSourceRunIDConflict     = errors.New("source run id conflict")
)
