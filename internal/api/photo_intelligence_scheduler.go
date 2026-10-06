package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

const (
	photoIntelligenceReconcileInterval = 30 * time.Second
	photoIntelligenceOwnerScanLimit    = 64
	photoFaceBatchSize                 = 4
	photoPlaceBatchSize                = 32
)

type photoIntelligenceTaskKind string

const (
	photoIntelligenceFace          photoIntelligenceTaskKind = "face"
	photoIntelligencePlace         photoIntelligenceTaskKind = "place"
	photoIntelligencePersonCluster photoIntelligenceTaskKind = "person_cluster"
)

type photoIntelligenceOwnerKey struct {
	OwnerID uint64
	Kind    photoIntelligenceTaskKind
}

type photoIntelligenceOwnerState struct {
	running            bool
	pending            bool
	generation         uint64
	currentKey         string
	currentPriority    background.Priority
	currentTrigger     background.Trigger
	currentInitiator   background.Initiator
	currentInitiatorID uint64
	currentCancelEpoch uint64
	nextPriority       background.Priority
	nextTrigger        background.Trigger
	nextInitiator      background.Initiator
	nextInitiatorID    uint64
}

type photoFaceOwnerRunner interface {
	CandidateOwnerIDs(context.Context, int) ([]uint64, error)
	RunOwnerBatch(context.Context, uint64, int) (int, error)
}

type photoPlaceOwnerRunner interface {
	CandidateOwnerIDs(context.Context, int) ([]uint64, error)
	RunOwnerBatch(context.Context, uint64, int) (int, error)
}

type photoPersonOwnerRunner interface {
	CandidateOwnerIDs(context.Context, int) ([]uint64, error)
	RunOwner(context.Context, uint64) error
}

type photoIntelligenceReanalyzeRequest struct {
	Kinds []string `json:"kinds,omitempty"`
}

type photoIntelligenceReanalyzeResponse struct {
	OwnerID  uint64   `json:"owner_id"`
	Accepted []string `json:"accepted"`
}

var errPhotoIntelligenceUnavailable = errors.New("photo intelligence kind is unavailable")

func (s *Server) StartPhotoIntelligence(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil {
		return
	}

	s.photoIntelligenceMu.Lock()
	if s.photoIntelligenceOwners == nil {
		s.photoIntelligenceOwners = make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState)
	}
	if s.PhotoPlaceResolver != nil {
		s.photoPlaceRunner = &photointelligence.PlaceRunner{
			DB:       s.DB,
			Resolver: s.PhotoPlaceResolver,
		}
	}
	if s.PhotoFaceAnalyzer != nil &&
		strings.TrimSpace(s.PhotoFacePreviewBaseURL) != "" {
		s.photoFaceRunner = &photointelligence.FaceRunner{
			DB:         s.DB,
			Analyzer:   s.PhotoFaceAnalyzer,
			PreviewURL: s.photoFacePreviewURL,
		}
	}
	s.photoPersonRunner = &photointelligence.PersonClusterRunner{DB: s.DB}
	s.photoIntelligenceMu.Unlock()

	if s.photoPlaceRunner != nil {
		slog.Info(
			"photo_place_intelligence_started",
			"resolver", s.PhotoPlaceResolver.Name(),
			"resolver_version", s.PhotoPlaceResolver.Version(),
		)
	}
	if s.photoFaceRunner != nil {
		slog.Info("photo_face_intelligence_started")
	}
	slog.Info(
		"photo_person_clustering_started",
		"analyzer_version", photointelligence.PersonClusterAnalyzerVersion(),
	)

	s.schedulePhotoIntelligenceCandidates(ctx)
	go s.runPhotoIntelligenceReconcileLoop(ctx)
}

func (s *Server) runPhotoIntelligenceReconcileLoop(ctx context.Context) {
	ticker := time.NewTicker(photoIntelligenceReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.schedulePhotoIntelligenceCandidates(ctx)
		}
	}
}

func (s *Server) schedulePhotoIntelligenceCandidates(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	s.reconcileBackgroundRuntimeCancellations(
		ctx,
		[]string{
			"photo.face",
			"photo.place",
			"photo.person_cluster",
		},
	)
	s.schedulePendingPhotoIntelligenceReanalyzeIntents(ctx)

	type candidateSource struct {
		kind     photoIntelligenceTaskKind
		priority background.Priority
		owners   func(context.Context, int) ([]uint64, error)
	}
	sources := make([]candidateSource, 0, 3)
	if s.photoFaceRunner != nil {
		sources = append(sources, candidateSource{
			kind: photoIntelligenceFace, priority: background.PriorityP2,
			owners: s.photoFaceRunner.CandidateOwnerIDs,
		})
	}
	if s.photoPlaceRunner != nil {
		sources = append(sources, candidateSource{
			kind: photoIntelligencePlace, priority: background.PriorityP3,
			owners: s.photoPlaceRunner.CandidateOwnerIDs,
		})
	}
	if s.photoPersonRunner != nil {
		sources = append(sources, candidateSource{
			kind: photoIntelligencePersonCluster, priority: background.PriorityP3,
			owners: s.photoPersonRunner.CandidateOwnerIDs,
		})
	}

	for _, source := range sources {
		owners, err := source.owners(ctx, photoIntelligenceOwnerScanLimit)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				slog.Warn(
					"photo_intelligence_candidate_scan_failed",
					"kind", source.kind,
					"error", err,
				)
			}
			continue
		}
		for _, ownerID := range owners {
			_ = s.requestPhotoIntelligenceOwner(
				source.kind,
				ownerID,
				source.priority,
				background.TriggerReconcile,
				background.InitiatorSystem,
				0,
			)
		}
	}
}

func (s *Server) requestPhotoIntelligenceForMedia(ownerID uint64) {
	if ownerID == 0 {
		return
	}
	if s.photoFaceRunner != nil {
		_ = s.requestPhotoIntelligenceOwner(
			photoIntelligenceFace,
			ownerID,
			background.PriorityP2,
			background.TriggerSystemEvent,
			background.InitiatorSystem,
			0,
		)
	}
	if s.photoPlaceRunner != nil {
		_ = s.requestPhotoIntelligenceOwner(
			photoIntelligencePlace,
			ownerID,
			background.PriorityP3,
			background.TriggerSystemEvent,
			background.InitiatorSystem,
			0,
		)
	}
}

func (s *Server) requestPhotoIntelligenceOwner(
	kind photoIntelligenceTaskKind,
	ownerID uint64,
	priority background.Priority,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
) error {
	if ownerID == 0 || s.BackgroundScheduler == nil {
		return errPhotoIntelligenceUnavailable
	}
	if !s.photoIntelligenceAvailable(kind) {
		return errPhotoIntelligenceUnavailable
	}

	key := photoIntelligenceOwnerKey{OwnerID: ownerID, Kind: kind}
	kindName := "photo." + string(kind)
	s.photoIntelligenceMu.Lock()
	if s.photoIntelligenceOwners == nil {
		s.photoIntelligenceOwners = make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState)
	}
	state := s.photoIntelligenceOwners[key]
	if state != nil && state.running {
		s.mergePendingPhotoIntelligenceRequest(
			state,
			priority,
			trigger,
			initiator,
			initiatorID,
		)
		taskKey := state.currentKey
		generation := state.generation
		cancelEpoch := state.currentCancelEpoch
		promote := priority < state.currentPriority
		if promote {
			state.currentPriority = priority
			state.currentTrigger = trigger
			state.currentInitiator = initiator
			state.currentInitiatorID = initiatorID
		}
		s.photoIntelligenceMu.Unlock()
		if promote && taskKey != "" {
			_ = s.submitPhotoIntelligenceOwnerTask(
				key,
				generation,
				taskKey,
				cancelEpoch,
				priority,
				trigger,
				initiator,
				initiatorID,
			)
		}
		return nil
	}
	s.photoIntelligenceMu.Unlock()

	cancelEpoch, err := s.backgroundRuntimeCancelEpochForSubmit(
		ownerID,
		kindName,
	)
	if err != nil {
		return err
	}

	s.photoIntelligenceMu.Lock()
	if s.photoIntelligenceOwners == nil {
		s.photoIntelligenceOwners = make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState)
	}
	state = s.photoIntelligenceOwners[key]
	if state == nil {
		state = &photoIntelligenceOwnerState{}
		s.photoIntelligenceOwners[key] = state
	}
	if state.running {
		s.mergePendingPhotoIntelligenceRequest(
			state,
			priority,
			trigger,
			initiator,
			initiatorID,
		)
		s.photoIntelligenceMu.Unlock()
		return nil
	}

	state.running = true
	state.generation++
	generation := state.generation
	taskKey := fmt.Sprintf(
		"photo-intelligence:%s:owner:%d:generation:%d",
		kind,
		ownerID,
		generation,
	)
	state.currentKey = taskKey
	state.currentPriority = priority
	state.currentTrigger = trigger
	state.currentInitiator = initiator
	state.currentInitiatorID = initiatorID
	state.currentCancelEpoch = cancelEpoch
	s.photoIntelligenceMu.Unlock()

	err = s.submitPhotoIntelligenceOwnerTask(
		key,
		generation,
		taskKey,
		cancelEpoch,
		priority,
		trigger,
		initiator,
		initiatorID,
	)
	if err == nil {
		return nil
	}

	s.photoIntelligenceMu.Lock()
	if current := s.photoIntelligenceOwners[key]; current != nil &&
		current.generation == generation {
		delete(s.photoIntelligenceOwners, key)
	}
	s.photoIntelligenceMu.Unlock()
	return err
}

func (s *Server) submitPhotoIntelligenceOwnerTask(
	key photoIntelligenceOwnerKey,
	generation uint64,
	taskKey string,
	cancelEpoch uint64,
	priority background.Priority,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
) error {
	kindName := "photo." + string(key.Kind)
	resource := photoIntelligenceTaskResource(key.Kind)

	_, err := s.BackgroundScheduler.Submit(background.Task{
		Key:               taskKey,
		Kind:              kindName,
		GroupKey:          kindName,
		Scope:             background.ScopeUser,
		OwnerID:           key.OwnerID,
		Trigger:           trigger,
		Initiator:         initiator,
		InitiatorID:       initiatorID,
		Priority:          priority,
		Resource:          resource,
		Lease:             s.backgroundOwnerLeaseProvider(kindName, cancelEpoch),
		HeartbeatInterval: backgroundOwnerLeaseHeartbeatInterval,
		Run: func(taskCtx context.Context) error {
			if err := s.prepareBackgroundRuntimeGeneration(
				taskCtx,
				key.OwnerID,
				kindName,
				cancelEpoch,
			); err != nil {
				s.finishPhotoIntelligenceOwner(
					key,
					generation,
					0,
					err,
				)
				return err
			}
			if _, err := s.consumePhotoIntelligenceReanalyzeIntent(
				taskCtx,
				key.Kind,
				key.OwnerID,
			); err != nil {
				s.finishPhotoIntelligenceOwner(
					key,
					generation,
					0,
					err,
				)
				return err
			}

			background.ReportProgress(taskCtx, background.TaskProgress{
				Phase: "processing",
				Unit:  "item",
			})
			processed, runErr := s.runPhotoIntelligenceOwnerBatch(
				taskCtx,
				key.Kind,
				key.OwnerID,
			)
			runErr = backgroundRuntimeRunError(taskCtx, runErr)
			if errors.Is(runErr, background.ErrCancelRequested) {
				if err := s.finalizeBackgroundRuntimeCancellationAfterRun(
					key.OwnerID,
					kindName,
				); err != nil {
					runErr = err
				}
			}
			if processed > 0 {
				background.ReportProgress(taskCtx, background.TaskProgress{
					Phase:   "processing",
					Current: int64(processed),
					Unit:    "item",
				})
			}
			s.finishPhotoIntelligenceOwner(
				key,
				generation,
				processed,
				runErr,
			)
			if key.Kind == photoIntelligenceFace &&
				processed > 0 &&
				!errors.Is(runErr, background.ErrCancelRequested) {
				_ = s.requestPhotoIntelligenceOwner(
					photoIntelligencePersonCluster,
					key.OwnerID,
					background.PriorityP3,
					background.TriggerSystemEvent,
					background.InitiatorSystem,
					0,
				)
			}
			return runErr
		},
	})
	return err
}

func (s *Server) runPhotoIntelligenceOwnerBatch(
	ctx context.Context,
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) (int, error) {
	switch kind {
	case photoIntelligenceFace:
		if s.photoFaceRunner == nil {
			return 0, errPhotoIntelligenceUnavailable
		}
		return s.photoFaceRunner.RunOwnerBatch(ctx, ownerID, photoFaceBatchSize)
	case photoIntelligencePlace:
		if s.photoPlaceRunner == nil {
			return 0, errPhotoIntelligenceUnavailable
		}
		return s.photoPlaceRunner.RunOwnerBatch(ctx, ownerID, photoPlaceBatchSize)
	case photoIntelligencePersonCluster:
		if s.photoPersonRunner == nil {
			return 0, errPhotoIntelligenceUnavailable
		}
		if err := s.photoPersonRunner.RunOwner(ctx, ownerID); err != nil {
			return 0, err
		}
		return 1, nil
	default:
		return 0, errPhotoIntelligenceUnavailable
	}
}

func (s *Server) finishPhotoIntelligenceOwner(
	key photoIntelligenceOwnerKey,
	generation uint64,
	processed int,
	runErr error,
) {
	s.photoIntelligenceMu.Lock()
	state := s.photoIntelligenceOwners[key]
	if state == nil || state.generation != generation {
		s.photoIntelligenceMu.Unlock()
		return
	}
	state.running = false
	state.currentKey = ""

	if errors.Is(runErr, background.ErrCancelRequested) {
		delete(s.photoIntelligenceOwners, key)
		s.photoIntelligenceMu.Unlock()
		return
	}

	if runErr != nil {
		if !state.pending {
			delete(s.photoIntelligenceOwners, key)
			s.photoIntelligenceMu.Unlock()
			if !errors.Is(runErr, context.Canceled) {
				slog.Warn(
					"photo_intelligence_owner_batch_failed",
					"owner_id", key.OwnerID,
					"kind", key.Kind,
					"error", runErr,
				)
			}
			return
		}
		priority := state.nextPriority
		trigger := state.nextTrigger
		initiator := state.nextInitiator
		initiatorID := state.nextInitiatorID
		state.pending = false
		s.photoIntelligenceMu.Unlock()
		if !errors.Is(runErr, context.Canceled) {
			slog.Warn(
				"photo_intelligence_owner_batch_failed_with_pending",
				"owner_id", key.OwnerID,
				"kind", key.Kind,
				"error", runErr,
			)
		}
		_ = s.requestPhotoIntelligenceOwner(
			key.Kind,
			key.OwnerID,
			priority,
			trigger,
			initiator,
			initiatorID,
		)
		return
	}

	batchSize := 1
	switch key.Kind {
	case photoIntelligenceFace:
		batchSize = photoFaceBatchSize
	case photoIntelligencePlace:
		batchSize = photoPlaceBatchSize
	}
	if processed >= batchSize && key.Kind != photoIntelligencePersonCluster {
		s.mergePendingPhotoIntelligenceRequest(
			state,
			state.currentPriority,
			state.currentTrigger,
			state.currentInitiator,
			state.currentInitiatorID,
		)
	}

	if !state.pending {
		delete(s.photoIntelligenceOwners, key)
		s.photoIntelligenceMu.Unlock()
		return
	}
	priority := state.nextPriority
	trigger := state.nextTrigger
	initiator := state.nextInitiator
	initiatorID := state.nextInitiatorID
	state.pending = false
	s.photoIntelligenceMu.Unlock()

	_ = s.requestPhotoIntelligenceOwner(
		key.Kind,
		key.OwnerID,
		priority,
		trigger,
		initiator,
		initiatorID,
	)
}

func (s *Server) mergePendingPhotoIntelligenceRequest(
	state *photoIntelligenceOwnerState,
	priority background.Priority,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
) {
	if state == nil {
		return
	}
	if !state.pending {
		state.pending = true
		state.nextPriority = priority
		state.nextTrigger = trigger
		state.nextInitiator = initiator
		state.nextInitiatorID = initiatorID
		return
	}
	if priority < state.nextPriority ||
		(priority == state.nextPriority &&
			photoIntelligenceTriggerRank(trigger) >
				photoIntelligenceTriggerRank(state.nextTrigger)) {
		state.nextPriority = priority
		state.nextTrigger = trigger
		state.nextInitiator = initiator
		state.nextInitiatorID = initiatorID
	}
}

func photoIntelligenceTriggerRank(trigger background.Trigger) int {
	switch trigger {
	case background.TriggerUserAction, background.TriggerAdminAction:
		return 4
	case background.TriggerSystemEvent:
		return 3
	case background.TriggerSchedule:
		return 2
	case background.TriggerReconcile:
		return 1
	default:
		return 0
	}
}

func (s *Server) photoIntelligenceAvailable(
	kind photoIntelligenceTaskKind,
) bool {
	switch kind {
	case photoIntelligenceFace:
		return s.photoFaceRunner != nil
	case photoIntelligencePlace:
		return s.photoPlaceRunner != nil
	case photoIntelligencePersonCluster:
		return s.photoPersonRunner != nil
	default:
		return false
	}
}

func (s *Server) invalidatePhotoIntelligenceOwner(
	ctx context.Context,
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) error {
	now := time.Now().UTC()
	switch kind {
	case photoIntelligenceFace:
		assetIDs := s.DB.WithContext(ctx).
			Model(&meta.PhotoAsset{}).
			Select("id").
			Where("owner_id = ?", ownerID)
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where(
				"asset_id IN (?) AND kind IN ?",
				assetIDs,
				[]string{
					meta.PhotoAnalysisKindFaceDetection,
					meta.PhotoAnalysisKindFaceEmbedding,
				},
			).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePlace:
		assetIDs := s.DB.WithContext(ctx).
			Model(&meta.PhotoAsset{}).
			Select("id").
			Where("owner_id = ?", ownerID)
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where(
				"asset_id IN (?) AND kind = ?",
				assetIDs,
				meta.PhotoAnalysisKindPlaceLabel,
			).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePersonCluster:
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoPersonClusterState{}).
			Where("owner_id = ?", ownerID).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	default:
		return errPhotoIntelligenceUnavailable
	}
}

func (s *Server) reanalyzePhotoIntelligence(c *gin.Context) {
	s.reanalyzePhotoIntelligenceOwner(c, userID(c), background.InitiatorUser)
}

func (s *Server) adminReanalyzePhotoIntelligence(c *gin.Context) {
	ownerID, err := strconv.ParseUint(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || ownerID == 0 {
		fail(c, http.StatusBadRequest, "invalid user id")
		return
	}
	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).
		Where(
			"id = ? AND disabled_at IS NULL AND must_change_password = false",
			ownerID,
		).
		First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "user not found")
		} else {
			fail(c, http.StatusInternalServerError, "load user failed")
		}
		return
	}
	s.reanalyzePhotoIntelligenceOwner(
		c,
		ownerID,
		background.InitiatorAdmin,
	)
}

func (s *Server) reanalyzePhotoIntelligenceOwner(
	c *gin.Context,
	ownerID uint64,
	initiator background.Initiator,
) {
	var req photoIntelligenceReanalyzeRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, "invalid request")
			return
		}
	}
	kinds, err := s.normalizePhotoIntelligenceKinds(req.Kinds)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	initiatorID := userID(c)
	trigger := background.TriggerUserAction
	if initiator == background.InitiatorAdmin {
		trigger = background.TriggerAdminAction
	}
	if err := s.enqueuePhotoIntelligenceReanalysis(
		c.Request.Context(),
		ownerID,
		kinds,
		trigger,
		initiator,
		initiatorID,
	); err != nil {
		if errors.Is(err, errPhotoIntelligenceUnavailable) {
			fail(c, http.StatusConflict, err.Error())
		} else {
			fail(c, http.StatusInternalServerError, "record photo intelligence reanalysis failed")
		}
		return
	}

	accepted := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		accepted = append(accepted, string(kind))
	}
	c.JSON(http.StatusAccepted, photoIntelligenceReanalyzeResponse{
		OwnerID:  ownerID,
		Accepted: accepted,
	})
}

func (s *Server) normalizePhotoIntelligenceKinds(
	raw []string,
) ([]photoIntelligenceTaskKind, error) {
	requested := raw
	if len(requested) == 0 {
		requested = []string{
			string(photoIntelligenceFace),
			string(photoIntelligencePlace),
			string(photoIntelligencePersonCluster),
		}
	}
	seen := make(map[photoIntelligenceTaskKind]struct{}, len(requested))
	out := make([]photoIntelligenceTaskKind, 0, len(requested))
	for _, value := range requested {
		kind := photoIntelligenceTaskKind(strings.TrimSpace(value))
		switch kind {
		case photoIntelligenceFace,
			photoIntelligencePlace,
			photoIntelligencePersonCluster:
		default:
			return nil, fmt.Errorf("unsupported photo intelligence kind %q", value)
		}
		if !s.photoIntelligenceAvailable(kind) {
			if len(raw) == 0 {
				continue
			}
			return nil, fmt.Errorf("photo intelligence kind %q is unavailable", value)
		}
		if _, exists := seen[kind]; exists {
			continue
		}
		seen[kind] = struct{}{}
		out = append(out, kind)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("photo intelligence is unavailable")
	}
	return out, nil
}
