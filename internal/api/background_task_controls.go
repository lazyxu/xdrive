package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	backgroundTaskActionCancel    = "cancel"
	backgroundTaskActionRetry     = "retry"
	backgroundTaskActionUndo      = "undo"
	backgroundTaskActionRedo      = "redo"
	backgroundTaskActionReanalyze = "reanalyze"
	backgroundTaskActionRun       = "run"
)

var errBackgroundTaskControlUnavailable = errors.New("background task control is unavailable")

type backgroundTaskControlRequest struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

type backgroundTaskControlResponse struct {
	TaskID       string `json:"task_id"`
	Action       string `json:"action"`
	ResultTaskID string `json:"result_task_id,omitempty"`
	Accepted     bool   `json:"accepted"`
}

type backgroundTaskControlOutcome struct {
	ResultTaskID string
	OwnerID      uint64
	Kind         string
}

type backgroundTaskRef struct {
	domain  string
	key     string
	scope   background.Scope
	ownerID uint64
	kind    string
}

func backgroundTaskActionAllowed(actions []string, action string) bool {
	for _, candidate := range actions {
		if candidate == action {
			return true
		}
	}
	return false
}

func backgroundFileOperationControlActions(
	operation meta.FileOperation,
	viewerID uint64,
	admin bool,
) []string {
	owner := operation.OwnerID == viewerID
	if !owner && !admin {
		return nil
	}
	actions := make([]string, 0, 4)
	switch operation.Status {
	case meta.FileOperationStatusQueued,
		meta.FileOperationStatusRunning:
		actions = append(actions, backgroundTaskActionCancel)
	}
	if owner && fileOperationRetryable(operation) {
		actions = append(actions, backgroundTaskActionRetry)
	}
	if owner && fileOperationUndoable(operation) {
		actions = append(actions, backgroundTaskActionUndo)
	}
	if owner && fileOperationRedoable(operation) {
		actions = append(actions, backgroundTaskActionRedo)
	}
	return actions
}

func backgroundSourceRunControlActions(
	ownerID uint64,
	run meta.SyncRun,
	viewerID uint64,
	admin bool,
) []string {
	if (ownerID != viewerID && !admin) ||
		run.Status != meta.SyncRunStatusRunning ||
		run.CancelRequestedAt != nil {
		return nil
	}
	return []string{backgroundTaskActionCancel}
}

func backgroundRuntimeControlActions(
	kind string,
	scope background.Scope,
	ownerID, viewerID uint64,
	admin bool,
) []string {
	if scope != background.ScopeUser {
		return nil
	}
	actions := make([]string, 0, 2)
	if ownerID == viewerID || admin {
		switch kind {
		case "media.index",
			"photo.face",
			"photo.smart_search",
			"photo.semantic_search",
			"photo.place",
			"photo.person_cluster":
			actions = append(actions, backgroundTaskActionCancel)
		}
	}
	switch kind {
	case "photo.face", "photo.smart_search", "photo.semantic_search", "photo.place", "photo.person_cluster":
		if ownerID == viewerID || admin {
			actions = append(actions, backgroundTaskActionReanalyze)
		}
	}
	return actions
}

func parseBackgroundTaskRef(raw string) (backgroundTaskRef, bool) {
	value := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(value, "file-operation:"):
		key := strings.TrimSpace(strings.TrimPrefix(value, "file-operation:"))
		return backgroundTaskRef{domain: "file_operation", key: key}, key != ""
	case strings.HasPrefix(value, "sync-run:"):
		key := strings.TrimSpace(strings.TrimPrefix(value, "sync-run:"))
		return backgroundTaskRef{domain: "sync_run", key: key}, key != ""
	case strings.HasPrefix(value, "archive-prepare:"):
		key := strings.TrimSpace(strings.TrimPrefix(value, "archive-prepare:"))
		return backgroundTaskRef{domain: "archive_prepare", key: key}, key != ""
	case strings.HasPrefix(value, "system-maintenance:"):
		kind := strings.TrimSpace(strings.TrimPrefix(value, "system-maintenance:"))
		return backgroundTaskRef{
			domain: "system_maintenance",
			key:    kind,
			scope:  background.ScopeSystem,
			kind:   kind,
		}, kind != ""
	case strings.HasPrefix(value, "runtime:"):
		parts := strings.SplitN(strings.TrimPrefix(value, "runtime:"), ":", 3)
		if len(parts) != 3 {
			return backgroundTaskRef{}, false
		}
		ownerID, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil || ownerID == 0 {
			return backgroundTaskRef{}, false
		}
		scope := background.Scope(strings.TrimSpace(parts[0]))
		if scope != background.ScopeUser && scope != background.ScopeSystem {
			return backgroundTaskRef{}, false
		}
		kind := strings.TrimSpace(parts[2])
		if kind == "" {
			return backgroundTaskRef{}, false
		}
		return backgroundTaskRef{
			domain:  "scheduler",
			scope:   scope,
			ownerID: ownerID,
			kind:    kind,
		}, true
	default:
		return backgroundTaskRef{}, false
	}
}

func (s *Server) controlBackgroundTask(c *gin.Context) {
	s.controlBackgroundTaskForViewer(c, false)
}

func (s *Server) adminControlBackgroundTask(c *gin.Context) {
	s.controlBackgroundTaskForViewer(c, true)
}

func (s *Server) controlBackgroundTaskForViewer(c *gin.Context, admin bool) {
	var req backgroundTaskControlRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		if admin {
			s.recordBackgroundTaskControlAudit(
				c, "", "", backgroundTaskRef{}, backgroundTaskControlOutcome{},
				auditpkg.ResultFailure, "invalid_request",
			)
		}
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	ref, ok := parseBackgroundTaskRef(req.ID)
	if !ok || req.Action == "" {
		if admin {
			s.recordBackgroundTaskControlAudit(
				c, req.ID, req.Action, ref, backgroundTaskControlOutcome{},
				auditpkg.ResultFailure, "invalid_control",
			)
		}
		fail(c, http.StatusBadRequest, "invalid background task control")
		return
	}

	outcome, err := s.dispatchBackgroundTaskControl(
		c.Request.Context(),
		ref,
		req.Action,
		userID(c),
		admin,
	)
	if admin {
		result := auditpkg.ResultSuccess
		reason := ""
		if err != nil {
			result = auditpkg.ResultFailure
			reason = "rejected"
		}
		s.recordBackgroundTaskControlAudit(
			c, req.ID, req.Action, ref, outcome, result, reason,
		)
	}
	if err != nil {
		writeBackgroundTaskControlError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, backgroundTaskControlResponse{
		TaskID:       req.ID,
		Action:       req.Action,
		ResultTaskID: outcome.ResultTaskID,
		Accepted:     true,
	})
}

func (s *Server) recordBackgroundTaskControlAudit(
	c *gin.Context,
	taskID, controlAction string,
	ref backgroundTaskRef,
	outcome backgroundTaskControlOutcome,
	result, reason string,
) {
	metadata := map[string]any{
		"domain": ref.domain,
	}
	if controlAction != "" {
		metadata["control_action"] = controlAction
	}
	ownerID := outcome.OwnerID
	if ownerID == 0 {
		ownerID = ref.ownerID
	}
	if ownerID != 0 {
		metadata["owner_id"] = ownerID
	}
	kind := outcome.Kind
	if kind == "" {
		kind = ref.kind
	}
	if kind != "" {
		metadata["kind"] = kind
	}
	if outcome.ResultTaskID != "" {
		metadata["result_task_id"] = outcome.ResultTaskID
	}
	if reason != "" {
		metadata["reason"] = reason
	}
	s.recordAuditBestEffort(c, auditEventFromContext(
		c,
		auditpkg.ActionAdminTaskControl,
		"background_task",
		taskID,
		"",
		result,
		metadata,
	))
}

func (s *Server) dispatchBackgroundTaskControl(
	ctx context.Context,
	ref backgroundTaskRef,
	action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	switch ref.domain {
	case "file_operation":
		return s.controlBackgroundFileOperation(
			ctx,
			ref.key,
			action,
			viewerID,
			admin,
		)
	case "sync_run":
		return s.controlBackgroundSyncRun(
			ctx,
			ref.key,
			action,
			viewerID,
			admin,
		)
	case "archive_prepare":
		return s.controlBackgroundArchivePrepare(
			ctx,
			ref.key,
			action,
			viewerID,
			admin,
		)
	case "scheduler":
		return s.controlBackgroundRuntimeTask(
			ctx,
			ref,
			action,
			viewerID,
			admin,
		)
	case "system_maintenance":
		return s.controlBackgroundSystemMaintenance(
			ctx,
			ref,
			action,
			viewerID,
			admin,
		)
	default:
		return backgroundTaskControlOutcome{}, errBackgroundTaskControlUnavailable
	}
}

func (s *Server) controlBackgroundFileOperation(
	ctx context.Context,
	operationID, action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	var operation meta.FileOperation
	query := s.DB.WithContext(ctx).Where("id = ?", operationID)
	if !admin {
		query = query.Where("owner_id = ?", viewerID)
	}
	if err := query.First(&operation).Error; err != nil {
		return backgroundTaskControlOutcome{}, err
	}
	outcome := backgroundTaskControlOutcome{
		OwnerID: operation.OwnerID,
		Kind:    operation.Type,
	}
	actions := backgroundFileOperationControlActions(operation, viewerID, admin)
	if !backgroundTaskActionAllowed(actions, action) {
		return outcome, errBackgroundTaskControlUnavailable
	}

	switch action {
	case backgroundTaskActionCancel:
		if err := s.requestFileOperationCancel(
			ctx,
			operation.OwnerID,
			operation.ID,
		); err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = "file-operation:" + operation.ID
		return outcome, nil
	case backgroundTaskActionRetry:
		next, err := s.enqueueFileOperationRetry(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = "file-operation:" + next.ID
		return outcome, nil
	case backgroundTaskActionUndo:
		next, err := s.enqueueFileOperationUndo(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = "file-operation:" + next.ID
		return outcome, nil
	case backgroundTaskActionRedo:
		next, err := s.enqueueFileOperationRedo(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = "file-operation:" + next.ID
		return outcome, nil
	default:
		return outcome, errBackgroundTaskControlUnavailable
	}
}

func (s *Server) controlBackgroundArchivePrepare(
	ctx context.Context,
	runID, action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	var run meta.ArchivePrepareRun
	query := s.DB.WithContext(ctx).Where("id = ?", runID)
	if !admin {
		query = query.Where("owner_id = ?", viewerID)
	}
	if err := query.First(&run).Error; err != nil {
		return backgroundTaskControlOutcome{}, err
	}
	outcome := backgroundTaskControlOutcome{
		OwnerID: run.OwnerID,
		Kind:    "archive.prepare",
	}
	if !backgroundTaskActionAllowed(
		archivePrepareControlActions(run, viewerID, admin),
		action,
	) {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if action != backgroundTaskActionCancel {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if err := s.requestArchivePrepareCancel(ctx, run); err != nil {
		return outcome, err
	}
	outcome.ResultTaskID = archivePrepareTaskID(run.ID)
	return outcome, nil
}

func (s *Server) controlBackgroundSyncRun(
	ctx context.Context,
	runID, action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	canonicalID, ok := canonicalRunID(runID)
	if !ok {
		return backgroundTaskControlOutcome{}, gorm.ErrRecordNotFound
	}
	var run meta.SyncRun
	if err := s.DB.WithContext(ctx).
		Where("id = ?", canonicalID).
		First(&run).Error; err != nil {
		return backgroundTaskControlOutcome{}, err
	}
	var source meta.Source
	query := s.DB.WithContext(ctx).Where("id = ?", run.SourceID)
	if !admin {
		query = query.Where("owner_id = ?", viewerID)
	}
	if err := query.First(&source).Error; err != nil {
		return backgroundTaskControlOutcome{}, err
	}
	outcome := backgroundTaskControlOutcome{
		OwnerID: source.OwnerID,
		Kind:    "source.sync",
	}
	actions := backgroundSourceRunControlActions(
		source.OwnerID,
		run,
		viewerID,
		admin,
	)
	if !backgroundTaskActionAllowed(actions, action) {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if action != backgroundTaskActionCancel {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if _, _, err := s.requestSourceRunCancel(
		ctx,
		source.OwnerID,
		source.ID,
		run.ID,
	); err != nil {
		return outcome, err
	}
	outcome.ResultTaskID = "sync-run:" + run.ID
	return outcome, nil
}

func photoIntelligenceKindFromBackgroundKind(
	kind string,
) (photoIntelligenceTaskKind, bool) {
	switch kind {
	case "photo.face":
		return photoIntelligenceFace, true
	case "photo.smart_search":
		return photoIntelligenceSmartSearch, true
	case "photo.semantic_search":
		return photoIntelligenceSemanticSearch, true
	case "photo.place":
		return photoIntelligencePlace, true
	case "photo.person_cluster":
		return photoIntelligencePersonCluster, true
	default:
		return "", false
	}
}

func runtimeBackgroundTaskID(ref backgroundTaskRef) string {
	return "runtime:" + string(ref.scope) + ":" +
		strconv.FormatUint(ref.ownerID, 10) + ":" + ref.kind
}

func (s *Server) invalidateRuntimeOwnerStateForCancel(
	ref backgroundTaskRef,
	keys map[string]struct{},
) bool {
	switch ref.kind {
	case "media.index":
		s.mediaIndexMu.Lock()
		defer s.mediaIndexMu.Unlock()
		state := s.mediaIndexOwners[ref.ownerID]
		if state == nil {
			return false
		}
		if _, ok := keys[state.currentKey]; !ok {
			return false
		}
		state.running = false
		state.pending = false
		state.currentKey = ""
		state.generation++
		return true
	case "photo.face", "photo.smart_search", "photo.semantic_search", "photo.place", "photo.person_cluster":
		kind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind)
		if !ok {
			return false
		}
		key := photoIntelligenceOwnerKey{OwnerID: ref.ownerID, Kind: kind}
		s.photoIntelligenceMu.Lock()
		defer s.photoIntelligenceMu.Unlock()
		state := s.photoIntelligenceOwners[key]
		if state == nil {
			return false
		}
		if _, ok := keys[state.currentKey]; !ok {
			return false
		}
		state.running = false
		state.pending = false
		state.currentKey = ""
		state.nextInitiator = ""
		state.nextInitiatorID = 0
		state.generation++
		return true
	default:
		return false
	}
}

func (s *Server) cancelBackgroundRuntimeTaskGroup(
	ctx context.Context,
	ref backgroundTaskRef,
	initiator background.Initiator,
	initiatorID uint64,
) (bool, error) {
	if s == nil ||
		ref.scope != background.ScopeUser ||
		ref.ownerID == 0 ||
		!backgroundOwnerCancellableKind(ref.kind) {
		return false, nil
	}

	cancelEpoch := uint64(0)
	if s.DB != nil {
		var err error
		cancelEpoch, err = s.requestBackgroundOwnerCancellation(
			ctx,
			ref.kind,
			ref.ownerID,
			initiator,
			initiatorID,
		)
		if err != nil {
			return false, err
		}
		if kind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind); ok {
			if err := s.cancelPendingPhotoIntelligenceReanalyzeIntent(
				ctx,
				kind,
				ref.ownerID,
			); err != nil {
				return false, err
			}
		}
	}

	identities := make([]background.Identity, 0)
	keys := make(map[string]struct{})
	if s.BackgroundScheduler != nil {
		ownerID := ref.ownerID
		for _, snapshot := range s.BackgroundScheduler.TaskSnapshots(&ownerID) {
			if snapshot.Identity.Scope != ref.scope ||
				snapshot.Identity.OwnerID != ref.ownerID ||
				snapshot.Kind != ref.kind {
				continue
			}
			identities = append(identities, snapshot.Identity)
			keys[snapshot.Identity.Key] = struct{}{}
		}
	}

	invalidatedOwnerState := s.invalidateRuntimeOwnerStateForCancel(ref, keys)
	cancelledScheduler := false
	for _, identity := range identities {
		if s.BackgroundScheduler.Cancel(identity) {
			cancelledScheduler = true
		}
	}
	if s.DB != nil && cancelEpoch > 0 {
		finalizeCtx, cancel := context.WithTimeout(
			context.Background(),
			backgroundOwnerCancelTimeout,
		)
		defer cancel()
		if _, err := s.tryFinalizeIdleBackgroundOwnerCancellation(
			finalizeCtx,
			ref.kind,
			ref.ownerID,
			cancelEpoch,
		); err != nil {
			return false, err
		}
	}
	return s.DB != nil || invalidatedOwnerState || cancelledScheduler, nil
}

func (s *Server) controlBackgroundRuntimeTask(
	ctx context.Context,
	ref backgroundTaskRef,
	action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	outcome := backgroundTaskControlOutcome{
		OwnerID: ref.ownerID,
		Kind:    ref.kind,
	}
	actions := backgroundRuntimeControlActions(
		ref.kind,
		ref.scope,
		ref.ownerID,
		viewerID,
		admin,
	)
	if !backgroundTaskActionAllowed(actions, action) {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if action == backgroundTaskActionCancel {
		available, err := s.backgroundRuntimeTaskCancellableNow(ctx, ref)
		if err != nil {
			return outcome, err
		}
		if !available {
			return outcome, errBackgroundTaskControlUnavailable
		}
		initiator := background.InitiatorUser
		if admin {
			initiator = background.InitiatorAdmin
		}
		cancelled, err := s.cancelBackgroundRuntimeTaskGroup(
			ctx,
			ref,
			initiator,
			viewerID,
		)
		if err != nil {
			return outcome, err
		}
		if !cancelled {
			return outcome, errBackgroundTaskControlUnavailable
		}
		outcome.ResultTaskID = runtimeBackgroundTaskID(ref)
		return outcome, nil
	}
	if action != backgroundTaskActionReanalyze {
		return outcome, errBackgroundTaskControlUnavailable
	}
	kind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind)
	if !ok {
		return outcome, errBackgroundTaskControlUnavailable
	}
	if admin && ref.ownerID != viewerID {
		var user meta.User
		if err := s.DB.WithContext(ctx).
			Where(
				"id = ? AND disabled_at IS NULL AND must_change_password = false",
				ref.ownerID,
			).
			First(&user).Error; err != nil {
			return outcome, err
		}
	}

	trigger := background.TriggerUserAction
	initiator := background.InitiatorUser
	if admin {
		trigger = background.TriggerAdminAction
		initiator = background.InitiatorAdmin
	}
	if err := s.enqueuePhotoIntelligenceReanalysis(
		ctx,
		ref.ownerID,
		[]photoIntelligenceTaskKind{kind},
		trigger,
		initiator,
		viewerID,
	); err != nil {
		return outcome, err
	}
	outcome.ResultTaskID = runtimeBackgroundTaskID(ref)
	return outcome, nil
}

func writeBackgroundTaskControlError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "background task not found")
	case errors.Is(err, errBackgroundTaskControlUnavailable),
		errors.Is(err, errFileOperationTerminal),
		errors.Is(err, errFileOperationRetryUnavailable),
		errors.Is(err, errFileOperationUndoUnavailable),
		errors.Is(err, errFileOperationAlreadyUndone),
		errors.Is(err, errFileOperationRedoUnavailable),
		errors.Is(err, errFileOperationAlreadyRedone),
		errors.Is(err, errSourceRunNotRunning),
		errors.Is(err, errPhotoIntelligenceUnavailable):
		fail(c, http.StatusConflict, "background task control is unavailable")
	case errors.Is(err, background.ErrQueueFull):
		fail(c, http.StatusServiceUnavailable, "background task queue is full")
	default:
		fail(c, http.StatusInternalServerError, "background task control failed")
	}
}
