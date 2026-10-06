package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
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
	_ bool,
) []string {
	if operation.OwnerID != viewerID {
		return nil
	}
	actions := make([]string, 0, 4)
	switch operation.Status {
	case meta.FileOperationStatusQueued,
		meta.FileOperationStatusRunning:
		actions = append(actions, backgroundTaskActionCancel)
	}
	if fileOperationRetryable(operation) {
		actions = append(actions, backgroundTaskActionRetry)
	}
	if fileOperationUndoable(operation) {
		actions = append(actions, backgroundTaskActionUndo)
	}
	if fileOperationRedoable(operation) {
		actions = append(actions, backgroundTaskActionRedo)
	}
	return actions
}

func backgroundSourceRunControlActions(
	ownerID uint64,
	run meta.SyncRun,
	viewerID uint64,
	_ bool,
) []string {
	if ownerID != viewerID ||
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
	if ownerID == viewerID {
		switch kind {
		case "media.index",
			"photo.face",
			"photo.place",
			"photo.person_cluster":
			actions = append(actions, backgroundTaskActionCancel)
		}
	}
	switch kind {
	case "photo.face", "photo.place", "photo.person_cluster":
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
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	ref, ok := parseBackgroundTaskRef(req.ID)
	if !ok || req.Action == "" {
		fail(c, http.StatusBadRequest, "invalid background task control")
		return
	}

	resultTaskID, err := s.dispatchBackgroundTaskControl(
		c.Request.Context(),
		ref,
		req.Action,
		userID(c),
		admin,
	)
	if err != nil {
		writeBackgroundTaskControlError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, backgroundTaskControlResponse{
		TaskID:       req.ID,
		Action:       req.Action,
		ResultTaskID: resultTaskID,
		Accepted:     true,
	})
}

func (s *Server) dispatchBackgroundTaskControl(
	ctx context.Context,
	ref backgroundTaskRef,
	action string,
	viewerID uint64,
	admin bool,
) (string, error) {
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
	case "scheduler":
		return s.controlBackgroundRuntimeTask(
			ctx,
			ref,
			action,
			viewerID,
			admin,
		)
	default:
		return "", errBackgroundTaskControlUnavailable
	}
}

func (s *Server) controlBackgroundFileOperation(
	ctx context.Context,
	operationID, action string,
	viewerID uint64,
	admin bool,
) (string, error) {
	var operation meta.FileOperation
	query := s.DB.WithContext(ctx).Where("id = ?", operationID)
	if !admin {
		query = query.Where("owner_id = ?", viewerID)
	}
	if err := query.First(&operation).Error; err != nil {
		return "", err
	}
	actions := backgroundFileOperationControlActions(operation, viewerID, admin)
	if !backgroundTaskActionAllowed(actions, action) {
		return "", errBackgroundTaskControlUnavailable
	}

	switch action {
	case backgroundTaskActionCancel:
		if err := s.requestFileOperationCancel(
			ctx,
			operation.OwnerID,
			operation.ID,
		); err != nil {
			return "", err
		}
		return "file-operation:" + operation.ID, nil
	case backgroundTaskActionRetry:
		next, err := s.enqueueFileOperationRetry(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return "", err
		}
		return "file-operation:" + next.ID, nil
	case backgroundTaskActionUndo:
		next, err := s.enqueueFileOperationUndo(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return "", err
		}
		return "file-operation:" + next.ID, nil
	case backgroundTaskActionRedo:
		next, err := s.enqueueFileOperationRedo(
			ctx,
			operation.OwnerID,
			operation.ID,
		)
		if err != nil {
			return "", err
		}
		return "file-operation:" + next.ID, nil
	default:
		return "", errBackgroundTaskControlUnavailable
	}
}

func (s *Server) controlBackgroundSyncRun(
	ctx context.Context,
	runID, action string,
	viewerID uint64,
	admin bool,
) (string, error) {
	canonicalID, ok := canonicalRunID(runID)
	if !ok {
		return "", gorm.ErrRecordNotFound
	}
	var run meta.SyncRun
	if err := s.DB.WithContext(ctx).
		Where("id = ?", canonicalID).
		First(&run).Error; err != nil {
		return "", err
	}
	var source meta.Source
	query := s.DB.WithContext(ctx).Where("id = ?", run.SourceID)
	if !admin {
		query = query.Where("owner_id = ?", viewerID)
	}
	if err := query.First(&source).Error; err != nil {
		return "", err
	}
	actions := backgroundSourceRunControlActions(
		source.OwnerID,
		run,
		viewerID,
		admin,
	)
	if !backgroundTaskActionAllowed(actions, action) {
		return "", errBackgroundTaskControlUnavailable
	}
	if action != backgroundTaskActionCancel {
		return "", errBackgroundTaskControlUnavailable
	}
	if _, _, err := s.requestSourceRunCancel(
		ctx,
		source.OwnerID,
		source.ID,
		run.ID,
	); err != nil {
		return "", err
	}
	return "sync-run:" + run.ID, nil
}

func photoIntelligenceKindFromBackgroundKind(
	kind string,
) (photoIntelligenceTaskKind, bool) {
	switch kind {
	case "photo.face":
		return photoIntelligenceFace, true
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
	case "photo.face", "photo.place", "photo.person_cluster":
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
) (string, error) {
	actions := backgroundRuntimeControlActions(
		ref.kind,
		ref.scope,
		ref.ownerID,
		viewerID,
		admin,
	)
	if !backgroundTaskActionAllowed(actions, action) {
		return "", errBackgroundTaskControlUnavailable
	}
	if action == backgroundTaskActionCancel {
		available, err := s.backgroundRuntimeTaskCancellableNow(ctx, ref)
		if err != nil {
			return "", err
		}
		if !available {
			return "", errBackgroundTaskControlUnavailable
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
			return "", err
		}
		if !cancelled {
			return "", errBackgroundTaskControlUnavailable
		}
		return runtimeBackgroundTaskID(ref), nil
	}
	if action != backgroundTaskActionReanalyze {
		return "", errBackgroundTaskControlUnavailable
	}
	kind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind)
	if !ok {
		return "", errBackgroundTaskControlUnavailable
	}
	if admin && ref.ownerID != viewerID {
		var user meta.User
		if err := s.DB.WithContext(ctx).
			Where(
				"id = ? AND disabled_at IS NULL AND must_change_password = false",
				ref.ownerID,
			).
			First(&user).Error; err != nil {
			return "", err
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
		return "", err
	}
	return runtimeBackgroundTaskID(ref), nil
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
