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

type sourceCommitDTO struct {
	ExternalID       string     `json:"external_id"`
	Action           string     `json:"action"`
	NodeID           uint64     `json:"node_id"`
	NodeRevision     uint64     `json:"node_revision"`
	Kind             string     `json:"kind"`
	Path             string     `json:"path"`
	Size             int64      `json:"size"`
	ModifiedAt       *time.Time `json:"modified_at,omitempty"`
	SHA256           string     `json:"sha256,omitempty"`
	RemoteRevision   string     `json:"remote_revision,omitempty"`
	Transferred      bool       `json:"transferred,omitempty"`
	TransferredBytes int64      `json:"transferred_bytes,omitempty"`
}

type commitSourceRunRequest struct {
	Items []sourceCommitDTO `json:"items"`
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
			Updates(map[string]any{"last_run_at": now, "run_requested_at": nil, "updated_at": now}).Error; err != nil {
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
							Updates(map[string]any{"node_id": nil, "node_revision": 0}).Error; err != nil {
							return err
						}
						current.NodeID = nil
						current.NodeRevision = 0
					}
				}
				copy := current
				currentPtr = &copy
			}

			plan, err := sourcepkg.Plan(currentPtr, item, matcher)
			if err != nil {
				return err
			}
			var nodeRevision uint64
			if currentPtr != nil && currentPtr.NodeID != nil {
				if node, active := nodesByID[*currentPtr.NodeID]; active {
					nodeRevision = node.Revision
					if currentPtr.NodeRevision != 0 && node.Revision != currentPtr.NodeRevision &&
						plan.Action != sourcepkg.ActionIgnore && plan.Action != sourcepkg.ActionCreate {
						plan.Action = sourcepkg.ActionMoveUpdate
					}
				}
			}
			if err := persistObservedSourceItem(tx, sourceID, runID, now, current, exists, plan, nodeRevision); err != nil {
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

func (s *Server) commitSourceRun(c *gin.Context) {
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
	var req commitSourceRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Items) == 0 || len(req.Items) > sourceObservationBatchLimit {
		fail(c, http.StatusBadRequest, fmt.Sprintf("items must contain 1-%d entries", sourceObservationBatchLimit))
		return
	}

	type normalizedCommit struct {
		raw  sourceCommitDTO
		item sourcepkg.DiscoveredItem
	}
	commits := make([]normalizedCommit, 0, len(req.Items))
	seen := make(map[string]struct{}, len(req.Items))
	for _, raw := range req.Items {
		raw.Action = strings.TrimSpace(raw.Action)
		if !validSourceCommitAction(sourcepkg.PlanAction(raw.Action)) {
			fail(c, http.StatusBadRequest, "invalid source execution action")
			return
		}
		if raw.NodeID == 0 || raw.NodeRevision == 0 || raw.TransferredBytes < 0 ||
			(!raw.Transferred && raw.TransferredBytes != 0) {
			fail(c, http.StatusBadRequest, "invalid source execution result")
			return
		}
		item := sourcepkg.DiscoveredItem{
			ExternalID: raw.ExternalID, Kind: raw.Kind, Path: raw.Path, Size: raw.Size,
			ModifiedAt: raw.ModifiedAt, SHA256: raw.SHA256, RemoteRevision: raw.RemoteRevision,
		}
		if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		if item.Kind == meta.SourceItemKindDirectory && raw.Transferred {
			fail(c, http.StatusBadRequest, "directories cannot report transferred bytes")
			return
		}
		action := sourcepkg.PlanAction(raw.Action)
		if item.Kind == meta.SourceItemKindFile && action != sourcepkg.ActionMove && item.SHA256 == "" {
			fail(c, http.StatusBadRequest, "file execution result requires sha256")
			return
		}
		if _, exists := seen[item.ExternalID]; exists {
			fail(c, http.StatusBadRequest, "duplicate external_id in execution batch")
			return
		}
		seen[item.ExternalID] = struct{}{}
		commits = append(commits, normalizedCommit{raw: raw, item: item})
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
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != meta.SyncRunStatusRunning {
			return errSourceRunNotRunning
		}
		if run.Mode != meta.SourceRunModeSync || run.TargetNodeID == nil {
			return errInvalidSourceConfig
		}
		var target meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*run.TargetNodeID, source.OwnerID, meta.NodeTypeDir).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errSourceTargetUnavailable
			}
			return err
		}

		var created, updated, transferredItems, transferredBytes int64
		for _, commit := range commits {
			item := commit.item
			raw := commit.raw
			action := sourcepkg.PlanAction(raw.Action)

			var current meta.SourceItem
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("source_id = ? AND external_id = ?", sourceID, item.ExternalID).
				First(&current).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errSourceExecutionConflict
				}
				return err
			}
			if current.LastSeenRunID != runID {
				return errSourceExecutionConflict
			}

			effectiveSHA := item.SHA256
			if effectiveSHA == "" {
				effectiveSHA = current.SHA256
				item.SHA256 = effectiveSHA
			}
			if current.LastSyncedRunID == runID {
				if !sourceCommitMatches(current, item, raw.NodeID, raw.NodeRevision) {
					return errSourceExecutionConflict
				}
				continue
			}
			if current.State != meta.SourceItemStatePending {
				return errSourceExecutionConflict
			}
			switch action {
			case sourcepkg.ActionCreate:
				if current.NodeID != nil {
					return errSourceExecutionConflict
				}
			case sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
				if current.NodeID == nil || *current.NodeID != raw.NodeID {
					return errSourceExecutionConflict
				}
			default:
				return errSourceExecutionConflict
			}

			var node meta.Node
			if err := tx.Preload("File").
				Where("id = ? AND owner_id = ? AND deleted_at IS NULL", raw.NodeID, source.OwnerID).
				First(&node).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errSourceExecutionConflict
				}
				return err
			}
			if node.Revision != raw.NodeRevision || !sourceKindMatchesNodeType(item.Kind, node.Type) {
				return errSourceExecutionConflict
			}
			relativePath, inside, err := sourceNodePathWithinTarget(tx, source.OwnerID, node.ID, *run.TargetNodeID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errSourceExecutionConflict
				}
				return err
			}
			if !inside || relativePath != item.Path {
				return errSourceExecutionConflict
			}
			if item.Kind == meta.SourceItemKindFile {
				if node.File == nil || node.File.Size != item.Size {
					return errSourceExecutionConflict
				}
				if item.SHA256 != "" && !strings.EqualFold(node.File.SHA256, item.SHA256) {
					return errSourceExecutionConflict
				}
			}

			nodeID := node.ID
			if err := tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
				"node_id": nodeID, "node_revision": node.Revision,
				"kind": item.Kind, "path": item.Path, "size": item.Size,
				"modified_at": item.ModifiedAt, "sha256": effectiveSHA,
				"remote_revision": item.RemoteRevision, "state": meta.SourceItemStateSynced,
				"last_seen_run_id": runID, "last_seen_at": now,
				"last_synced_run_id": runID, "last_synced_at": now,
				"last_error": "", "updated_at": now,
			}).Error; err != nil {
				return err
			}

			if action == sourcepkg.ActionCreate {
				created++
			} else {
				updated++
			}
			if raw.Transferred {
				transferredItems++
				transferredBytes += raw.TransferredBytes
			}
		}

		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Updates(map[string]any{
			"created_items":     gorm.Expr("created_items + ?", created),
			"updated_items":     gorm.Expr("updated_items + ?", updated),
			"transferred_items": gorm.Expr("transferred_items + ?", transferredItems),
			"transferred_bytes": gorm.Expr("transferred_bytes + ?", transferredBytes),
			"updated_at":        now,
		}).Error
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
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

		if run.Mode == meta.SourceRunModeSync {
			var pendingItems int64
			if err := tx.Model(&meta.SourceItem{}).
				Where("source_id = ? AND last_seen_run_id = ? AND state = ?", sourceID, runID, meta.SourceItemStatePending).
				Count(&pendingItems).Error; err != nil {
				return err
			}
			if pendingItems > summary.FailedItems {
				summary.FailedItems = pendingItems
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
	nodeRevision uint64,
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
			"sha256": item.SHA256, "remote_revision": item.RemoteRevision, "node_revision": 0,
			"state": meta.SourceItemStatePending, "last_seen_run_id": runID,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	case sourcepkg.ActionUnchanged:
		observedSHA := item.SHA256
		if observedSHA == "" {
			observedSHA = current.SHA256
		}
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"kind": item.Kind, "path": item.Path, "size": item.Size, "modified_at": item.ModifiedAt,
			"sha256": observedSHA, "remote_revision": item.RemoteRevision,
			"node_revision": nodeRevision,
			"state":         meta.SourceItemStateSynced, "last_seen_run_id": runID,
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

func validSourceCommitAction(action sourcepkg.PlanAction) bool {
	switch action {
	case sourcepkg.ActionCreate, sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return true
	default:
		return false
	}
}

func sourceKindMatchesNodeType(kind, nodeType string) bool {
	switch kind {
	case meta.SourceItemKindFile:
		return nodeType == meta.NodeTypeFile
	case meta.SourceItemKindDirectory:
		return nodeType == meta.NodeTypeDir
	default:
		return false
	}
}

func sourceCommitMatches(current meta.SourceItem, item sourcepkg.DiscoveredItem, nodeID, nodeRevision uint64) bool {
	if current.NodeID == nil || *current.NodeID != nodeID || current.NodeRevision != nodeRevision ||
		current.Kind != item.Kind || current.Path != item.Path || current.Size != item.Size ||
		!strings.EqualFold(current.SHA256, item.SHA256) || current.RemoteRevision != item.RemoteRevision ||
		current.State != meta.SourceItemStateSynced {
		return false
	}
	if current.ModifiedAt == nil || item.ModifiedAt == nil {
		return current.ModifiedAt == nil && item.ModifiedAt == nil
	}
	return current.ModifiedAt.Equal(*item.ModifiedAt)
}

func sourceNodePathWithinTarget(tx *gorm.DB, ownerID, nodeID, targetID uint64) (string, bool, error) {
	if nodeID == targetID {
		return "", false, nil
	}
	current := nodeID
	parts := make([]string, 0, 8)
	for depth := 0; depth < 10000; depth++ {
		var node meta.Node
		if err := tx.Select("id", "parent_id", "name").
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", current, ownerID).
			First(&node).Error; err != nil {
			return "", false, err
		}
		parts = append(parts, node.Name)
		if node.ParentID == nil {
			return "", false, nil
		}
		if *node.ParentID == targetID {
			for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
				parts[i], parts[j] = parts[j], parts[i]
			}
			return strings.Join(parts, "/"), true, nil
		}
		current = *node.ParentID
	}
	return "", false, fmt.Errorf("source target ancestry exceeds limit")
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
	case errors.Is(err, errSourceExecutionConflict):
		fail(c, http.StatusConflict, "source execution result conflicts with current state")
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
	errSourceExecutionConflict = errors.New("source execution conflict")
)
