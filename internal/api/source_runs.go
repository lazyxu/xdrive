package api

import (
	"context"
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
	sourceRunTextLimit          = 64 << 10
	sourceItemFailureTextLimit  = 4 << 10
)

type beginSourceRunRequest struct {
	RunID   string `json:"run_id"`
	Trigger string `json:"trigger"`
}

type sourceObservationDTO struct {
	ExternalID        string     `json:"external_id"`
	ExternalIDAliases []string   `json:"external_id_aliases,omitempty"`
	PromoteExternalID bool       `json:"promote_external_id,omitempty"`
	Kind              string     `json:"kind"`
	Path              string     `json:"path"`
	Size              int64      `json:"size"`
	ModifiedAt        *time.Time `json:"modified_at,omitempty"`
	SHA256            string     `json:"sha256,omitempty"`
	RemoteRevision    string     `json:"remote_revision,omitempty"`
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

type sourceFailureDTO struct {
	ExternalID string `json:"external_id"`
	Error      string `json:"error"`
}

type failSourceRunRequest struct {
	Items []sourceFailureDTO `json:"items"`
}

type finishSourceRunRequest struct {
	Status            string            `json:"status"`
	CompleteInventory bool              `json:"complete_inventory"`
	Checkpoint        string            `json:"checkpoint,omitempty"`
	Summary           sourcepkg.Summary `json:"summary"`
	Error             string            `json:"error,omitempty"`
}

type sourceRunProgressRequest struct {
	Summary          *sourcepkg.Summary `json:"summary,omitempty"`
	ActivePath       string             `json:"active_path,omitempty"`
	ActiveBytes      *int64             `json:"active_bytes,omitempty"`
	ActiveTotalBytes *int64             `json:"active_total_bytes,omitempty"`
}

func sourceRunContinueError(run meta.SyncRun) error {
	if run.Status != meta.SyncRunStatusRunning {
		return errSourceRunNotRunning
	}
	if run.CancelRequestedAt != nil {
		return errSourceRunCancellationRequested
	}
	return nil
}

func sourceRunSummaryUpdates(summary sourcepkg.Summary) map[string]any {
	return map[string]any{
		"scanned_items":          summary.ScannedItems,
		"scanned_bytes":          summary.ScannedBytes,
		"ignored_items":          summary.IgnoredItems,
		"ignored_bytes":          summary.IgnoredBytes,
		"new_items":              summary.NewItems,
		"new_bytes":              summary.NewBytes,
		"changed_items":          summary.ChangedItems,
		"changed_bytes":          summary.ChangedBytes,
		"moved_items":            summary.MovedItems,
		"unchanged_items":        summary.UnchangedItems,
		"unchanged_bytes":        summary.UnchangedBytes,
		"planned_transfer_items": summary.PlannedTransferItems,
		"planned_transfer_bytes": summary.PlannedTransferBytes,
		"skipped_items":          summary.IgnoredItems + summary.UnchangedItems,
		"failed_items":           gorm.Expr("GREATEST(failed_items, ?)", summary.FailedItems),
	}
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
		if !meta.ValidSourceSyncMode(source.SyncMode) || !meta.ValidSourceRunMode(source.RunMode) {
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
			if !sourcepkg.SyncRunStale(active, now) {
				return errSourceRunActive
			}
			finished := now
			status := meta.SyncRunStatusFailed
			errorText := "stale source run superseded"
			if active.CancelRequestedAt != nil {
				status = meta.SyncRunStatusCancelled
				errorText = "stale cancelled source run superseded"
			}
			if err := tx.Model(&meta.SyncRun{}).Where("id = ?", active.ID).Updates(map[string]any{
				"status":                status,
				"error":                 errorText,
				"active_transfer_path":  "",
				"active_transfer_bytes": 0,
				"active_transfer_total": 0,
				"finished_at":           &finished,
				"updated_at":            now,
			}).Error; err != nil {
				return err
			}
		} else if !errors.Is(activeErr, gorm.ErrRecordNotFound) {
			return activeErr
		}

		var maxRunNumber int64
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ?", source.ID).
			Select("COALESCE(MAX(run_number), 0)").
			Scan(&maxRunNumber).Error; err != nil {
			return err
		}
		targetID := target.ID
		out = meta.SyncRun{
			ID: runID, SourceID: source.ID, RunNumber: maxRunNumber + 1, SourceRevision: source.Revision,
			SyncMode: source.SyncMode, TargetNodeID: &targetID, IgnoreRules: source.IgnoreRules,
			Mode: source.RunMode, Trigger: req.Trigger, Status: meta.SyncRunStatusRunning,
			CheckpointBefore: source.Checkpoint, StartedAt: now,
		}
		if err := tx.Create(&out).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.Source{}).Where("id = ?", source.ID).
			Updates(map[string]any{"last_run_at": now, "run_requested_at": nil, "last_error": "", "updated_at": now}).Error; err != nil {
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

	observations := make([]normalizedSourceObservation, 0, len(req.Items))
	identityKeys := make([]string, 0, len(req.Items)*2)
	claimed := make(map[string]string, len(req.Items)*2)
	for _, raw := range req.Items {
		observation, err := normalizeSourceObservation(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		for _, identity := range append([]string{observation.item.ExternalID}, observation.aliases...) {
			if owner, exists := claimed[identity]; exists {
				fail(c, http.StatusBadRequest, fmt.Sprintf("source identity %q is claimed by both %q and %q", identity, owner, observation.item.ExternalID))
				return
			}
			claimed[identity] = observation.item.ExternalID
			identityKeys = append(identityKeys, identity)
		}
		observations = append(observations, observation)
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
		if err := sourceRunContinueError(run); err != nil {
			return err
		}
		matcher, err := sourcepkg.CompileIgnoreRules(run.IgnoreRules)
		if err != nil {
			return fmt.Errorf("compile stored ignore rules: %w", err)
		}

		identityIndex, err := loadSourceIdentityIndex(tx, sourceID, identityKeys)
		if err != nil {
			return err
		}
		nodeIDs := make([]uint64, 0, len(identityIndex.itemsByID))
		for _, item := range identityIndex.itemsByID {
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

		plans = make([]sourcePlanDTO, 0, len(observations))
		resolvedItemIDs := make(map[uint64]string)
		for _, observation := range observations {
			item := observation.item
			current, exists, err := identityIndex.resolve(item.ExternalID, observation.aliases)
			if err != nil {
				return err
			}
			if observation.promote && !exists {
				return errSourceIdentityConflict
			}
			if exists {
				if previous, duplicate := resolvedItemIDs[current.ID]; duplicate && previous != item.ExternalID {
					return errSourceIdentityConflict
				}
				resolvedItemIDs[current.ID] = item.ExternalID
				if err := identityIndex.prepareExisting(tx, sourceID, &current, item.ExternalID, observation.aliases, observation.promote, now); err != nil {
					return err
				}
			}

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
				copy.ExternalID = item.ExternalID
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
			if !exists && plan.Action != sourcepkg.ActionIgnore {
				if err := identityIndex.registerCreated(tx, sourceID, item.ExternalID, observation.aliases, now); err != nil {
					return err
				}
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
		if err := sourceRunContinueError(run); err != nil {
			return err
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

		var created, updated, processedTransferItems, processedTransferBytes, transferredItems, transferredBytes int64
		for _, commit := range commits {
			item := commit.item
			raw := commit.raw
			action := sourcepkg.PlanAction(raw.Action)

			current, err := findSourceItemByIdentity(tx, sourceID, item.ExternalID)
			if err != nil {
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
				"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
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
			if item.Kind == meta.SourceItemKindFile && action != sourcepkg.ActionMove {
				processedTransferItems++
				processedTransferBytes += item.Size
			}
			if raw.Transferred {
				transferredItems++
				transferredBytes += raw.TransferredBytes
			}
		}

		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Updates(map[string]any{
			"created_items":            gorm.Expr("created_items + ?", created),
			"updated_items":            gorm.Expr("updated_items + ?", updated),
			"processed_transfer_items": gorm.Expr("processed_transfer_items + ?", processedTransferItems),
			"processed_transfer_bytes": gorm.Expr("processed_transfer_bytes + ?", processedTransferBytes),
			"transferred_items":        gorm.Expr("transferred_items + ?", transferredItems),
			"transferred_bytes":        gorm.Expr("transferred_bytes + ?", transferredBytes),
			"active_transfer_path":     "",
			"active_transfer_bytes":    0,
			"active_transfer_total":    0,
			"updated_at":               now,
		}).Error
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) failSourceRunItems(c *gin.Context) {
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
	var req failSourceRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Items) == 0 || len(req.Items) > sourceObservationBatchLimit {
		fail(c, http.StatusBadRequest, fmt.Sprintf("items must contain 1-%d entries", sourceObservationBatchLimit))
		return
	}

	seen := make(map[string]struct{}, len(req.Items))
	failures := make([]sourceFailureDTO, 0, len(req.Items))
	for _, raw := range req.Items {
		raw.ExternalID = strings.TrimSpace(raw.ExternalID)
		raw.Error = strings.TrimSpace(raw.Error)
		if raw.ExternalID == "" || len([]byte(raw.ExternalID)) > 512 {
			fail(c, http.StatusBadRequest, "external_id is required and must be at most 512 bytes")
			return
		}
		if raw.Error == "" || len([]byte(raw.Error)) > sourceItemFailureTextLimit {
			fail(c, http.StatusBadRequest, fmt.Sprintf("error is required and must be at most %d bytes", sourceItemFailureTextLimit))
			return
		}
		if _, duplicate := seen[raw.ExternalID]; duplicate {
			fail(c, http.StatusBadRequest, "duplicate external_id in failure batch")
			return
		}
		seen[raw.ExternalID] = struct{}{}
		failures = append(failures, raw)
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
		if err := sourceRunContinueError(run); err != nil {
			return err
		}

		for _, failure := range failures {
			item, err := findSourceItemByIdentity(tx, sourceID, failure.ExternalID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errSourceExecutionConflict
				}
				return err
			}
			if item.LastSeenRunID != runID ||
				(item.State != meta.SourceItemStatePending && item.State != meta.SourceItemStateError) {
				return errSourceExecutionConflict
			}
			history := meta.SourceRunFailure{
				RunID: runID, SourceID: sourceID, SourceItemID: item.ID,
				ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path, Size: item.Size,
				Error: failure.Error, FailedAt: now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "run_id"}, {Name: "source_item_id"}},
				DoNothing: true,
			}).Create(&history).Error; err != nil {
				return err
			}
			if item.State == meta.SourceItemStateError && item.LastError == failure.Error {
				continue
			}
			if err := tx.Model(&meta.SourceItem{}).Where("id = ?", item.ID).Updates(map[string]any{
				"state":      meta.SourceItemStateError,
				"last_error": failure.Error,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
		}
		var failureCount int64
		if err := tx.Model(&meta.SourceRunFailure{}).Where("run_id = ?", run.ID).Count(&failureCount).Error; err != nil {
			return err
		}
		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Updates(map[string]any{
			"failed_items":          gorm.Expr("GREATEST(failed_items, ?)", failureCount),
			"active_transfer_path":  "",
			"active_transfer_bytes": 0,
			"active_transfer_total": 0,
			"updated_at":            now,
		}).Error
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) progressSourceRun(c *gin.Context) {
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
	var req sourceRunProgressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Summary == nil && req.ActiveBytes == nil && req.ActiveTotalBytes == nil {
		fail(c, http.StatusBadRequest, "summary or active transfer progress is required")
		return
	}
	if req.Summary != nil {
		if err := validateSourceSummary(*req.Summary); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if (req.ActiveBytes == nil) != (req.ActiveTotalBytes == nil) {
		fail(c, http.StatusBadRequest, "active_bytes and active_total_bytes must be provided together")
		return
	}
	if req.ActiveBytes != nil {
		if *req.ActiveBytes < 0 || *req.ActiveTotalBytes < 0 || *req.ActiveBytes > *req.ActiveTotalBytes {
			fail(c, http.StatusBadRequest, "invalid active transfer progress")
			return
		}
		if len([]byte(req.ActivePath)) > 2048 {
			fail(c, http.StatusBadRequest, "active_path is too long")
			return
		}
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
		if err := sourceRunContinueError(run); err != nil {
			return err
		}
		updates := map[string]any{"updated_at": now}
		if req.Summary != nil {
			for key, value := range sourceRunSummaryUpdates(*req.Summary) {
				updates[key] = value
			}
		}
		if req.ActiveBytes != nil {
			updates["active_transfer_path"] = strings.TrimSpace(req.ActivePath)
			updates["active_transfer_bytes"] = *req.ActiveBytes
			updates["active_transfer_total"] = *req.ActiveTotalBytes
		}
		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Updates(updates).Error
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) requestSourceRunCancel(
	ctx context.Context,
	ownerID, sourceID uint64,
	runID string,
) (meta.SyncRun, bool, error) {
	now := time.Now().UTC()
	accepted := false
	var out meta.SyncRun
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Where(
			"id = ? AND owner_id = ?",
			sourceID,
			ownerID,
		).First(&source).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).
			First(&out).Error; err != nil {
			return err
		}
		if meta.SyncRunTerminal(out.Status) {
			return nil
		}
		if out.Status != meta.SyncRunStatusRunning {
			return errSourceRunNotRunning
		}
		if out.CancelRequestedAt == nil {
			out.CancelRequestedAt = &now
			out.UpdatedAt = now
			accepted = true
			return tx.Model(&meta.SyncRun{}).
				Where("id = ?", out.ID).
				Updates(map[string]any{
					"cancel_requested_at": &now,
					"updated_at":          now,
				}).Error
		}
		return nil
	})
	return out, accepted, err
}

func (s *Server) cancelSourceRun(c *gin.Context) {
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
	out, accepted, err := s.requestSourceRunCancel(
		c.Request.Context(),
		userID(c),
		sourceID,
		runID,
	)
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	status := http.StatusOK
	if accepted {
		status = http.StatusAccepted
	}
	c.JSON(status, toSyncRunDTO(out))
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
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if err := sourceRunContinueError(run); err != nil {
			return err
		}
		return tx.Model(&meta.SyncRun{}).Where("id = ?", run.ID).Update("updated_at", now).Error
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

		status := req.Status
		if run.CancelRequestedAt != nil {
			status = meta.SyncRunStatusCancelled
		}
		summary := req.Summary
		summary.MissingItems = 0
		summary.MissingBytes = 0
		inventoryComplete := req.CompleteInventory &&
			(status == meta.SyncRunStatusCompleted || status == meta.SyncRunStatusPartial)
		missingItems := make([]meta.SourceItem, 0)
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
					if err := tx.Model(&meta.SourceItem{}).Where("id = ?", item.ID).
						Updates(map[string]any{
							"state":                     meta.SourceItemStateIgnored,
							"mirror_missing_full_scans": 0,
							"mirror_missing_since":      nil,
							"last_error":                "",
							"updated_at":                now,
						}).Error; err != nil {
						return err
					}
					continue
				}
				summary.AddMissing(item)
				if err := tx.Model(&meta.SourceItem{}).Where("id = ?", item.ID).
					Updates(map[string]any{
						"state":      meta.SourceItemStateMissing,
						"last_error": "",
						"updated_at": now,
					}).Error; err != nil {
					return err
				}
				missingItems = append(missingItems, item)
			}
		}

		if run.Mode == meta.SourceRunModeSync {
			unresolvedStates := []string{meta.SourceItemStateError}
			if status == meta.SyncRunStatusCompleted || status == meta.SyncRunStatusPartial {
				unresolvedStates = append(unresolvedStates, meta.SourceItemStatePending)
			}
			var unresolved []meta.SourceItem
			if err := tx.Where("source_id = ? AND last_seen_run_id = ? AND state IN ?",
				sourceID, runID, unresolvedStates).
				Find(&unresolved).Error; err != nil {
				return err
			}
			for _, item := range unresolved {
				errorText := strings.TrimSpace(item.LastError)
				if errorText == "" {
					errorText = "source item remained pending when run finished"
				}
				history := meta.SourceRunFailure{
					RunID: runID, SourceID: sourceID, SourceItemID: item.ID,
					ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path, Size: item.Size,
					Error: errorText, FailedAt: now,
				}
				if err := tx.Clauses(clause.OnConflict{
					Columns:   []clause.Column{{Name: "run_id"}, {Name: "source_item_id"}},
					DoNothing: true,
				}).Create(&history).Error; err != nil {
					return err
				}
			}
			unresolvedItems := int64(len(unresolved))
			if unresolvedItems > summary.FailedItems {
				summary.FailedItems = unresolvedItems
			}
		}

		var historicalFailures int64
		if err := tx.Model(&meta.SourceRunFailure{}).Where("run_id = ?", runID).Count(&historicalFailures).Error; err != nil {
			return err
		}
		if historicalFailures > summary.FailedItems {
			summary.FailedItems = historicalFailures
		}
		if status == meta.SyncRunStatusCompleted && summary.FailedItems > 0 {
			status = meta.SyncRunStatusPartial
		}

		var deletedItems int64
		if req.CompleteInventory && status == meta.SyncRunStatusCompleted {
			var mirrorErr error
			deletedItems, mirrorErr = advanceMirrorMissingEvidenceTx(
				tx,
				source,
				run,
				missingItems,
				now,
			)
			if mirrorErr != nil {
				return mirrorErr
			}
		}

		summary.ApplyToSyncRun(&run)
		run.DeletedItems = deletedItems
		finished := now
		run.Status = status
		run.CheckpointAfter = req.Checkpoint
		runError := strings.TrimSpace(req.Error)
		if runError == "" && status == meta.SyncRunStatusPartial {
			runError = fmt.Sprintf("%d source items failed", summary.FailedItems)
		}
		if runError == "" && status == meta.SyncRunStatusFailed {
			runError = "source run " + status
		}
		run.Error = runError
		run.ActiveTransferPath = ""
		run.ActiveTransferBytes = 0
		run.ActiveTransferTotal = 0
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
		} else if status == meta.SyncRunStatusCancelled {
			sourceUpdates["last_error"] = ""
		} else {
			sourceUpdates["last_error"] = run.Error
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
			"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
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
			"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
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
			"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
			"last_seen_at": now, "last_error": "", "updated_at": now,
		}).Error

	case sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return tx.Model(&meta.SourceItem{}).Where("id = ?", current.ID).Updates(map[string]any{
			"state": meta.SourceItemStatePending, "last_seen_run_id": runID,
			"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
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
	case errors.Is(err, errSourceRunCancellationRequested):
		fail(c, http.StatusConflict, "source run cancellation requested")
	case errors.Is(err, errSourceRunIDConflict):
		fail(c, http.StatusConflict, "run_id already belongs to another source")
	case errors.Is(err, errSourceExecutionConflict):
		fail(c, http.StatusConflict, "source execution result conflicts with current state")
	case errors.Is(err, errSourceIdentityConflict):
		fail(c, http.StatusConflict, "source identity aliases conflict with existing source items")
	case errors.Is(err, errInvalidSourceConfig):
		fail(c, http.StatusConflict, "source configuration is not executable")
	default:
		fail(c, http.StatusInternalServerError, "source run operation failed")
	}
}

var (
	errSourcePaused                   = errors.New("source paused")
	errSourceTargetUnavailable        = errors.New("source target unavailable")
	errSourceRunActive                = errors.New("source run already active")
	errSourceRunNotRunning            = errors.New("source run not running")
	errSourceRunCancellationRequested = errors.New("source run cancellation requested")
	errSourceRunIDConflict            = errors.New("source run id conflict")
	errSourceExecutionConflict        = errors.New("source execution conflict")
	errSourceIdentityConflict         = errors.New("source identity conflict")
)
