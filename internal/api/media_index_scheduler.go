package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
)

const (
	mediaIndexOwnerBatchSize      = 16
	mediaIndexReconcileOwnerLimit = 64
	mediaIndexReconcileInterval   = 30 * time.Second
)

type mediaIndexOwnerState struct {
	running         bool
	pending         bool
	generation      uint64
	currentKey      string
	currentPriority background.Priority
	currentTrigger  background.Trigger
	nextPriority    background.Priority
	nextTrigger     background.Trigger
}

func (s *Server) StartMediaIndexer(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	if s.BackgroundScheduler == nil {
		slog.Warn("media_indexer_not_started", "reason", "background scheduler is unavailable")
		return
	}

	s.mediaIndexMu.Lock()
	if s.mediaIndexOwners == nil {
		s.mediaIndexOwners = make(map[uint64]*mediaIndexOwnerState)
	}
	s.mediaIndexMu.Unlock()

	// Reconcile once before the event loop starts. This submits stale owners to
	// the shared scheduler but does not block startup waiting for their work.
	s.scheduleStaleMediaOwners(ctx)

	go s.runMediaIndexEventLoop(ctx)
}

func (s *Server) runMediaIndexEventLoop(ctx context.Context) {
	ticker := time.NewTicker(mediaIndexReconcileInterval)
	defer ticker.Stop()

	wakeups := s.MediaIndexWakeups
	for {
		select {
		case <-ctx.Done():
			return
		case ownerID, ok := <-wakeups:
			if !ok {
				wakeups = nil
				continue
			}
			if ownerID == 0 {
				continue
			}
			s.requestMediaIndexOwner(
				ownerID,
				background.PriorityP1,
				background.TriggerSystemEvent,
			)
		case <-ticker.C:
			s.scheduleStaleMediaOwners(ctx)
		}
	}
}

func (s *Server) scheduleStaleMediaOwners(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	owners, err := s.staleMediaOwnerIDs(
		ctx,
		mediaIndexReconcileOwnerLimit,
	)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			slog.Warn("media_index_reconcile_scan_failed", "error", err)
		}
		return
	}
	for _, ownerID := range owners {
		s.requestMediaIndexOwner(
			ownerID,
			background.PriorityP2,
			background.TriggerReconcile,
		)
	}
}

func (s *Server) requestMediaIndexOwner(
	ownerID uint64,
	priority background.Priority,
	trigger background.Trigger,
) {
	if ownerID == 0 || s.BackgroundScheduler == nil {
		return
	}

	s.mediaIndexMu.Lock()
	if s.mediaIndexOwners == nil {
		s.mediaIndexOwners = make(map[uint64]*mediaIndexOwnerState)
	}
	state := s.mediaIndexOwners[ownerID]
	if state == nil {
		state = &mediaIndexOwnerState{}
		s.mediaIndexOwners[ownerID] = state
	}
	if state.running {
		s.mergePendingMediaIndexRequest(state, priority, trigger)
		taskKey := state.currentKey
		generation := state.generation
		promote := priority < state.currentPriority
		if promote {
			state.currentPriority = priority
			state.currentTrigger = trigger
		}
		s.mediaIndexMu.Unlock()

		if promote && taskKey != "" {
			// Submitting the same owner/generation key lets the shared
			// scheduler promote a queued P2 reconcile task to P1 when a real
			// file-commit event arrives. If the task is already running, the
			// pending P1 request below still drives the next generation.
			_ = s.submitMediaIndexOwnerTask(
				ownerID,
				generation,
				taskKey,
				priority,
				trigger,
			)
		}
		return
	}

	state.running = true
	state.generation++
	generation := state.generation
	taskKey := fmt.Sprintf(
		"media-index:owner:%d:generation:%d",
		ownerID,
		generation,
	)
	state.currentKey = taskKey
	state.currentPriority = priority
	state.currentTrigger = trigger
	s.mediaIndexMu.Unlock()

	err := s.submitMediaIndexOwnerTask(
		ownerID,
		generation,
		taskKey,
		priority,
		trigger,
	)
	if err == nil {
		return
	}

	s.mediaIndexMu.Lock()
	if current := s.mediaIndexOwners[ownerID]; current != nil &&
		current.generation == generation {
		current.running = false
		delete(s.mediaIndexOwners, ownerID)
	}
	s.mediaIndexMu.Unlock()

	if !errors.Is(err, background.ErrClosed) {
		slog.Warn(
			"media_index_schedule_failed",
			"owner_id", ownerID,
			"trigger", trigger,
			"priority", priority,
			"error", err,
		)
	}
}

func (s *Server) submitMediaIndexOwnerTask(
	ownerID, generation uint64,
	taskKey string,
	priority background.Priority,
	trigger background.Trigger,
) error {
	_, err := s.BackgroundScheduler.Submit(background.Task{
		Key:       taskKey,
		Kind:      "media.index",
		GroupKey:  "media.index",
		Scope:     background.ScopeUser,
		OwnerID:   ownerID,
		Trigger:   trigger,
		Initiator: background.InitiatorSystem,
		Priority:  priority,
		Resource:  background.ResourceMediaCPU,
		Run: func(taskCtx context.Context) error {
			seen, indexed, runErr := s.refreshMediaIndexOwnerBatch(
				taskCtx,
				ownerID,
				mediaIndexOwnerBatchSize,
			)
			s.finishMediaIndexOwner(
				ownerID,
				generation,
				seen,
				indexed,
				runErr,
			)
			return runErr
		},
	})
	return err
}

func (s *Server) mergePendingMediaIndexRequest(
	state *mediaIndexOwnerState,
	priority background.Priority,
	trigger background.Trigger,
) {
	if state == nil {
		return
	}
	if !state.pending {
		state.pending = true
		state.nextPriority = priority
		state.nextTrigger = trigger
		return
	}
	if priority < state.nextPriority ||
		(priority == state.nextPriority &&
			state.nextTrigger == background.TriggerReconcile &&
			trigger == background.TriggerSystemEvent) {
		state.nextPriority = priority
		state.nextTrigger = trigger
	}
}

func (s *Server) finishMediaIndexOwner(
	ownerID, generation uint64,
	seen, indexed int,
	runErr error,
) {
	s.mediaIndexMu.Lock()
	state := s.mediaIndexOwners[ownerID]
	if state == nil || state.generation != generation {
		s.mediaIndexMu.Unlock()
		return
	}
	state.running = false
	state.currentKey = ""
	priority := state.currentPriority
	trigger := state.currentTrigger

	if runErr != nil {
		delete(s.mediaIndexOwners, ownerID)
		s.mediaIndexMu.Unlock()
		if !errors.Is(runErr, context.Canceled) {
			slog.Warn(
				"media_index_owner_batch_failed",
				"owner_id", ownerID,
				"error", runErr,
			)
		}
		return
	}

	if seen >= mediaIndexOwnerBatchSize && indexed > 0 {
		s.mergePendingMediaIndexRequest(state, priority, trigger)
	}
	if seen >= mediaIndexOwnerBatchSize && indexed == 0 {
		slog.Warn(
			"media_index_owner_batch_stalled",
			"owner_id", ownerID,
			"stale_items", seen,
		)
	}
	if !state.pending {
		delete(s.mediaIndexOwners, ownerID)
		s.mediaIndexMu.Unlock()
		return
	}

	nextPriority := state.nextPriority
	nextTrigger := state.nextTrigger
	state.pending = false
	s.mediaIndexMu.Unlock()

	// Each generation processes only one bounded batch. Re-submitting with a
	// fresh key gives other owners and P0 derivative work a chance to run.
	s.requestMediaIndexOwner(ownerID, nextPriority, nextTrigger)
}

func (s *Server) staleMediaOwnerIDs(
	ctx context.Context,
	limit int,
) ([]uint64, error) {
	if limit <= 0 {
		limit = mediaIndexReconcileOwnerLimit
	}
	type ownerRow struct {
		OwnerID uint64 `gorm:"column:owner_id"`
	}
	var rows []ownerRow
	if err := s.staleMediaQuery(ctx).
		Select("n.owner_id AS owner_id").
		Group("n.owner_id").
		Order("MAX(n.updated_at) DESC, n.owner_id ASC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	owners := make([]uint64, 0, len(rows))
	for _, row := range rows {
		if row.OwnerID != 0 {
			owners = append(owners, row.OwnerID)
		}
	}
	return owners, nil
}
