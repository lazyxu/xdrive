package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const (
	systemMaintenanceReconcileInterval        = 30 * time.Second
	systemMaintenanceDefaultHeartbeatInterval = 5 * time.Second
	maintenanceLeaderSourceIntegrity          = "system-maintenance:source-integrity"
	maintenanceLeaderMediaIntegrity           = "system-maintenance:media-integrity"
)

var errSystemMaintenanceUnsupported = errors.New("system maintenance task is unsupported")

type systemMaintenanceSourceVerifyRunner interface {
	VerifySources(context.Context) (maintenance.SourceVerifyReport, error)
}

type systemMaintenanceSourceRepairRunner interface {
	RepairSources(context.Context) (maintenance.SourceRepairReport, error)
}

type systemMaintenanceMediaVerifyRunner interface {
	VerifyMedia(context.Context) (maintenance.MediaVerifyReport, error)
}

func systemMaintenanceInteractiveKinds() []string {
	return []string{
		meta.SystemMaintenanceKindSourceVerify,
		meta.SystemMaintenanceKindSourceRepair,
		meta.SystemMaintenanceKindMediaVerify,
	}
}

func systemMaintenanceInteractiveKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case meta.SystemMaintenanceKindSourceVerify,
		meta.SystemMaintenanceKindSourceRepair,
		meta.SystemMaintenanceKindMediaVerify:
		return true
	default:
		return false
	}
}

func systemMaintenancePhase(kind string) string {
	switch strings.TrimSpace(kind) {
	case meta.SystemMaintenanceKindSourceVerify:
		return meta.SystemMaintenancePhaseSourceVerify
	case meta.SystemMaintenanceKindSourceRepair:
		return meta.SystemMaintenancePhaseSourceRepair
	case meta.SystemMaintenanceKindMediaVerify:
		return meta.SystemMaintenancePhaseMediaVerify
	default:
		return ""
	}
}

func systemMaintenanceTaskCenterID(kind string) string {
	return "system-maintenance:" + strings.TrimSpace(kind)
}

func systemMaintenanceLeaderKey(kind string) string {
	switch strings.TrimSpace(kind) {
	case meta.SystemMaintenanceKindJanitor:
		return maintenanceLeaderJanitor
	case meta.SystemMaintenanceKindStorageSampler:
		return maintenanceLeaderStorageSampler
	case meta.SystemMaintenanceKindSourceVerify,
		meta.SystemMaintenanceKindSourceRepair:
		return maintenanceLeaderSourceIntegrity
	case meta.SystemMaintenanceKindMediaVerify:
		return maintenanceLeaderMediaIntegrity
	default:
		return ""
	}
}

func systemMaintenanceControlActions(kind, status string) []string {
	if !systemMaintenanceInteractiveKind(kind) {
		return nil
	}
	switch status {
	case "",
		meta.SystemMaintenanceStatusSuccess,
		meta.SystemMaintenanceStatusIssues,
		meta.SystemMaintenanceStatusPartial,
		meta.SystemMaintenanceStatusFailed,
		meta.SystemMaintenanceStatusCancelled:
		return []string{backgroundTaskActionRun}
	case meta.SystemMaintenanceStatusQueued,
		meta.SystemMaintenanceStatusRunning:
		return []string{backgroundTaskActionCancel}
	default:
		return nil
	}
}

func systemMaintenanceTrigger(run meta.SystemMaintenanceRun) background.Trigger {
	value := background.Trigger(strings.TrimSpace(run.Trigger))
	switch value {
	case background.TriggerUserAction,
		background.TriggerSystemEvent,
		background.TriggerSchedule,
		background.TriggerReconcile,
		background.TriggerAdminAction:
		return value
	default:
		return background.TriggerSchedule
	}
}

func systemMaintenanceInitiator(run meta.SystemMaintenanceRun) background.Initiator {
	value := background.Initiator(strings.TrimSpace(run.Initiator))
	switch value {
	case background.InitiatorSystem,
		background.InitiatorUser,
		background.InitiatorAdmin,
		background.InitiatorService:
		return value
	default:
		return background.InitiatorSystem
	}
}

func systemMaintenanceSchedulerKey(run meta.SystemMaintenanceRun) string {
	return fmt.Sprintf("system-maintenance:%s:%d", run.Kind, run.ID)
}

func systemMaintenanceSchedulerIdentity(run meta.SystemMaintenanceRun) background.Identity {
	return background.Identity{
		Scope: background.ScopeSystem,
		Key:   systemMaintenanceSchedulerKey(run),
	}
}

func (s *Server) systemMaintenanceHeartbeatInterval() time.Duration {
	if s != nil && s.systemMaintenanceHeartbeat > 0 {
		return s.systemMaintenanceHeartbeat
	}
	return systemMaintenanceDefaultHeartbeatInterval
}

func (s *Server) StartSystemMaintenanceTasks(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil {
		return
	}
	go func() {
		s.reconcileSystemMaintenanceTasks(ctx)
		ticker := time.NewTicker(systemMaintenanceReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.reconcileSystemMaintenanceTasks(ctx)
			}
		}
	}()
}

func (s *Server) reconcileSystemMaintenanceTasks(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil || ctx.Err() != nil {
		return
	}
	var runs []meta.SystemMaintenanceRun
	if err := s.DB.WithContext(ctx).
		Where(
			"kind IN ? AND status IN ?",
			systemMaintenanceInteractiveKinds(),
			[]string{
				meta.SystemMaintenanceStatusQueued,
				meta.SystemMaintenanceStatusRunning,
				meta.SystemMaintenanceStatusCancelRequested,
			},
		).
		Order("id ASC").
		Find(&runs).Error; err != nil {
		s.ensureObservability()
		s.obs.logger.Warn("system_maintenance_reconcile_failed", "error", err)
		return
	}
	for index := range runs {
		run := runs[index]
		if run.Status == meta.SystemMaintenanceStatusCancelRequested {
			held, err := sourceaccount.IsHeld(ctx, s.DB, systemMaintenanceLeaderKey(run.Kind))
			if err != nil {
				s.ensureObservability()
				s.obs.logger.Warn(
					"system_maintenance_cancel_reconcile_failed",
					"run_id", run.ID,
					"kind", run.Kind,
					"error", err,
				)
				continue
			}
			if !held {
				s.finishSystemMaintenanceCancelled(run.ID)
			}
			continue
		}
		if run.Status == meta.SystemMaintenanceStatusRunning {
			held, err := sourceaccount.IsHeld(ctx, s.DB, systemMaintenanceLeaderKey(run.Kind))
			if err != nil {
				s.ensureObservability()
				s.obs.logger.Warn(
					"system_maintenance_recovery_check_failed",
					"run_id", run.ID,
					"kind", run.Kind,
					"error", err,
				)
				continue
			}
			if held {
				continue
			}
			now := time.Now().UTC()
			if err := s.DB.WithContext(ctx).
				Model(&meta.SystemMaintenanceRun{}).
				Where("id = ? AND status = ?", run.ID, meta.SystemMaintenanceStatusRunning).
				Updates(map[string]any{
					"status":     meta.SystemMaintenanceStatusQueued,
					"phase":      meta.SystemMaintenancePhaseQueued,
					"error":      "",
					"updated_at": now,
				}).Error; err != nil {
				s.ensureObservability()
				s.obs.logger.Warn(
					"system_maintenance_recovery_queue_failed",
					"run_id", run.ID,
					"kind", run.Kind,
					"error", err,
				)
				continue
			}
			run.Status = meta.SystemMaintenanceStatusQueued
			run.Phase = meta.SystemMaintenancePhaseQueued
			run.UpdatedAt = now
		}
		if err := s.submitSystemMaintenanceRun(run); err != nil {
			s.ensureObservability()
			s.obs.logger.Warn(
				"system_maintenance_submit_failed",
				"run_id", run.ID,
				"kind", run.Kind,
				"error", err,
			)
		}
	}
}

func (s *Server) requestSystemMaintenanceRun(
	ctx context.Context,
	kind string,
	initiator background.Initiator,
	initiatorID uint64,
) (meta.SystemMaintenanceRun, error) {
	var run meta.SystemMaintenanceRun
	kind = strings.TrimSpace(kind)
	if s == nil || s.DB == nil || !systemMaintenanceInteractiveKind(kind) {
		return run, errSystemMaintenanceUnsupported
	}
	if initiator != background.InitiatorAdmin || initiatorID == 0 {
		return run, errBackgroundTaskControlUnavailable
	}
	requestLease, err := sourceaccount.Acquire(ctx, s.DB, "system-maintenance-request:"+kind)
	if err != nil {
		return run, err
	}
	defer requestLease.Close()

	err = s.DB.WithContext(ctx).
		Where(
			"kind = ? AND status IN ?",
			kind,
			[]string{
				meta.SystemMaintenanceStatusQueued,
				meta.SystemMaintenanceStatusRunning,
				meta.SystemMaintenanceStatusCancelRequested,
			},
		).
		Order("id DESC").
		First(&run).Error
	if err == nil {
		return run, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return run, err
	}

	now := time.Now().UTC()
	run = meta.SystemMaintenanceRun{
		Kind:        kind,
		Status:      meta.SystemMaintenanceStatusQueued,
		Phase:       meta.SystemMaintenancePhaseQueued,
		Trigger:     string(background.TriggerAdminAction),
		Initiator:   string(initiator),
		InitiatorID: initiatorID,
		TotalSteps:  1,
		StartedAt:   now,
	}
	if err := s.DB.WithContext(ctx).Create(&run).Error; err != nil {
		return meta.SystemMaintenanceRun{}, err
	}
	if err := s.submitSystemMaintenanceRun(run); err != nil {
		s.ensureObservability()
		s.obs.logger.Warn(
			"system_maintenance_submit_deferred",
			"run_id", run.ID,
			"kind", run.Kind,
			"error", err,
		)
	}
	return run, nil
}

func (s *Server) submitSystemMaintenanceRun(run meta.SystemMaintenanceRun) error {
	if s == nil || s.BackgroundScheduler == nil {
		return errors.New("background scheduler is unavailable")
	}
	if systemMaintenanceLeaderKey(run.Kind) == "" {
		return errSystemMaintenanceUnsupported
	}
	_, err := s.BackgroundScheduler.Submit(background.Task{
		Key:               systemMaintenanceSchedulerKey(run),
		Kind:              "system.maintenance." + run.Kind,
		GroupKey:          "system.maintenance." + run.Kind,
		Scope:             background.ScopeSystem,
		Trigger:           systemMaintenanceTrigger(run),
		Initiator:         systemMaintenanceInitiator(run),
		InitiatorID:       run.InitiatorID,
		Priority:          background.PriorityP4,
		Resource:          background.ResourceMaintenanceIO,
		Lease:             s.systemMaintenanceLeaseProvider(run.Kind, run.ID),
		HeartbeatInterval: s.systemMaintenanceHeartbeatInterval(),
		Run: func(taskCtx context.Context) error {
			return s.runSystemMaintenanceTask(taskCtx, run.ID)
		},
	})
	return err
}

func (s *Server) systemMaintenanceLeaseProvider(
	kind string,
	runID uint64,
) background.LeaseProvider {
	return func(
		ctx context.Context,
		descriptor background.Descriptor,
	) (background.Lease, bool, error) {
		if s == nil || s.DB == nil ||
			descriptor.Scope != background.ScopeSystem ||
			runID == 0 {
			return background.Lease{}, false, errors.New("system maintenance lease is not configured")
		}
		lease, acquired, err := sourceaccount.TryAcquire(ctx, s.DB, systemMaintenanceLeaderKey(kind))
		if err != nil || !acquired {
			return background.Lease{}, acquired, err
		}
		cancelled, err := s.systemMaintenanceCancellationRequested(ctx, runID)
		if err != nil {
			lease.Close()
			return background.Lease{}, false, err
		}
		if cancelled {
			lease.Close()
			return background.Lease{}, false, context.Canceled
		}
		return background.Lease{
			Heartbeat: func(heartbeatCtx context.Context) error {
				if err := lease.Heartbeat(heartbeatCtx); err != nil {
					return err
				}
				cancelled, err := s.systemMaintenanceCancellationRequested(heartbeatCtx, runID)
				if err != nil {
					return err
				}
				if cancelled {
					return context.Canceled
				}
				return nil
			},
			Release: func(context.Context, error) error {
				lease.Close()
				return nil
			},
		}, true, nil
	}
}

func (s *Server) systemMaintenanceCancellationRequested(
	ctx context.Context,
	runID uint64,
) (bool, error) {
	var row struct {
		Status string
	}
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Select("status").
		Where("id = ?", runID).
		Scan(&row).Error; err != nil {
		return false, err
	}
	return row.Status == meta.SystemMaintenanceStatusCancelRequested ||
		row.Status == meta.SystemMaintenanceStatusCancelled, nil
}

func (s *Server) runSystemMaintenanceTask(ctx context.Context, runID uint64) error {
	var run meta.SystemMaintenanceRun
	if err := s.DB.WithContext(ctx).First(&run, runID).Error; err != nil {
		return err
	}
	switch run.Status {
	case meta.SystemMaintenanceStatusCancelled:
		return context.Canceled
	case meta.SystemMaintenanceStatusCancelRequested:
		s.finishSystemMaintenanceCancelled(run.ID)
		return context.Canceled
	case meta.SystemMaintenanceStatusQueued, meta.SystemMaintenanceStatusRunning:
	default:
		return nil
	}
	phase := systemMaintenancePhase(run.Kind)
	if phase == "" {
		return errSystemMaintenanceUnsupported
	}

	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"id = ? AND status IN ?",
			run.ID,
			[]string{
				meta.SystemMaintenanceStatusQueued,
				meta.SystemMaintenanceStatusRunning,
			},
		).
		Updates(map[string]any{
			"status":      meta.SystemMaintenanceStatusRunning,
			"phase":       phase,
			"started_at":  now,
			"finished_at": nil,
			"error":       "",
			"summary":     "",
			"updated_at":  now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		cancelled, err := s.systemMaintenanceCancellationRequested(ctx, run.ID)
		if err != nil {
			return err
		}
		if cancelled {
			s.finishSystemMaintenanceCancelled(run.ID)
			return context.Canceled
		}
		return nil
	}

	background.ReportProgress(ctx, background.TaskProgress{
		Phase: phase,
		Total: 1,
		Unit:  "step",
	})
	summary, state, err := s.executeSystemMaintenanceTask(ctx, run.Kind)
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.Canceled) {
			s.finishSystemMaintenanceCancelled(run.ID)
			return context.Canceled
		}
		s.finishSystemMaintenanceState(
			run.ID,
			meta.SystemMaintenanceStatusFailed,
			0,
			1,
			"",
			err.Error(),
		)
		return err
	}
	if !s.finishSystemMaintenanceState(run.ID, state, 1, 1, summary, "") {
		s.finishSystemMaintenanceCancelled(run.ID)
		return context.Canceled
	}
	background.ReportProgress(ctx, background.TaskProgress{
		Phase:   meta.SystemMaintenancePhaseFinished,
		Current: 1,
		Total:   1,
		Unit:    "step",
		Message: summary,
	})
	return nil
}

func (s *Server) executeSystemMaintenanceTask(
	ctx context.Context,
	kind string,
) (string, string, error) {
	switch kind {
	case meta.SystemMaintenanceKindSourceVerify:
		report, err := s.verifySourcesForSystemMaintenance(ctx)
		if err != nil {
			return "", "", err
		}
		summary := fmt.Sprintf(
			"%d 个同步文件夹 · %d 项 · 发现 %d 个一致性问题",
			report.Sources,
			report.Items,
			len(report.Issues),
		)
		state := meta.SystemMaintenanceStatusSuccess
		if len(report.Issues) != 0 {
			state = meta.SystemMaintenanceStatusIssues
		}
		return summary, state, nil
	case meta.SystemMaintenanceKindSourceRepair:
		report, err := s.repairSourcesForSystemMaintenance(ctx)
		if err != nil {
			return "", "", err
		}
		summary := fmt.Sprintf(
			"修复 %d 个绑定 · 处理 %d 个过期同步任务 · 跳过 %d 项 · 剩余 %d 个一致性问题",
			len(report.Actions),
			len(report.RunActions),
			len(report.Skipped),
			len(report.After.Issues),
		)
		state := meta.SystemMaintenanceStatusSuccess
		if len(report.After.Issues) != 0 {
			state = meta.SystemMaintenanceStatusIssues
		}
		return summary, state, nil
	case meta.SystemMaintenanceKindMediaVerify:
		report, err := s.verifyMediaForSystemMaintenance(ctx)
		if err != nil {
			return "", "", err
		}
		summary := fmt.Sprintf(
			"%d 个媒体元数据 · %d 个分组 · %d 个派生资源 · %d 个缩略图 · 发现 %d 个一致性问题",
			report.Metadata,
			report.Groups,
			report.DerivedResources,
			report.Thumbnails,
			len(report.Issues),
		)
		state := meta.SystemMaintenanceStatusSuccess
		if len(report.Issues) != 0 {
			state = meta.SystemMaintenanceStatusIssues
		}
		return summary, state, nil
	default:
		return "", "", errSystemMaintenanceUnsupported
	}
}

func (s *Server) verifySourcesForSystemMaintenance(
	ctx context.Context,
) (maintenance.SourceVerifyReport, error) {
	if s.systemMaintenanceSourceVerify != nil {
		return s.systemMaintenanceSourceVerify.VerifySources(ctx)
	}
	return maintenance.VerifySources(s.DB.WithContext(ctx))
}

func (s *Server) repairSourcesForSystemMaintenance(
	ctx context.Context,
) (maintenance.SourceRepairReport, error) {
	if s.systemMaintenanceSourceRepair != nil {
		return s.systemMaintenanceSourceRepair.RepairSources(ctx)
	}
	return maintenance.RepairSources(ctx, s.DB, false)
}

func (s *Server) verifyMediaForSystemMaintenance(
	ctx context.Context,
) (maintenance.MediaVerifyReport, error) {
	if s.systemMaintenanceMediaVerify != nil {
		return s.systemMaintenanceMediaVerify.VerifyMedia(ctx)
	}
	root, err := s.systemMaintenanceFilesystemRoot()
	if err != nil {
		return maintenance.MediaVerifyReport{}, err
	}
	return maintenance.VerifyMediaWithStorageRoot(
		s.DB.WithContext(ctx),
		root,
	)
}

func (s *Server) systemMaintenanceFilesystemRoot() (string, error) {
	if s == nil || s.Store == nil {
		return "", errors.New("system maintenance storage is unavailable")
	}
	provider, ok := s.Store.(storage.FilesystemRootProvider)
	if !ok {
		return "", errors.New(
			"system maintenance requires a filesystem-backed storage root",
		)
	}
	root := strings.TrimSpace(provider.FilesystemRoot())
	if root == "" {
		return "", errors.New("system maintenance filesystem root is unavailable")
	}
	return root, nil
}

func (s *Server) finishSystemMaintenanceState(
	runID uint64,
	status string,
	completedSteps, totalSteps int,
	summary, errorText string,
) bool {
	if s == nil || s.DB == nil || runID == 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where("id = ? AND status = ?", runID, meta.SystemMaintenanceStatusRunning).
		Updates(map[string]any{
			"status":          status,
			"phase":           meta.SystemMaintenancePhaseFinished,
			"completed_steps": completedSteps,
			"total_steps":     totalSteps,
			"summary":         summary,
			"error":           errorText,
			"finished_at":     now,
			"updated_at":      now,
		})
	if result.Error != nil {
		s.logSystemMaintenanceStatusError("finish", fmt.Sprintf("%d", runID), result.Error)
		return false
	}
	return result.RowsAffected > 0
}

func (s *Server) finishSystemMaintenanceCancelled(runID uint64) {
	if s == nil || s.DB == nil || runID == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	now := time.Now().UTC()
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"id = ? AND status IN ?",
			runID,
			[]string{
				meta.SystemMaintenanceStatusQueued,
				meta.SystemMaintenanceStatusRunning,
				meta.SystemMaintenanceStatusCancelRequested,
			},
		).
		Updates(map[string]any{
			"status":      meta.SystemMaintenanceStatusCancelled,
			"phase":       meta.SystemMaintenancePhaseFinished,
			"summary":     "已取消",
			"finished_at": now,
			"updated_at":  now,
		}).Error; err != nil {
		s.logSystemMaintenanceStatusError("cancel", fmt.Sprintf("%d", runID), err)
	}
}

func (s *Server) requestSystemMaintenanceCancel(
	ctx context.Context,
	kind string,
) (meta.SystemMaintenanceRun, error) {
	var run meta.SystemMaintenanceRun
	kind = strings.TrimSpace(kind)
	if s == nil || s.DB == nil || !systemMaintenanceInteractiveKind(kind) {
		return run, errSystemMaintenanceUnsupported
	}
	requestLease, err := sourceaccount.Acquire(ctx, s.DB, "system-maintenance-request:"+kind)
	if err != nil {
		return run, err
	}
	defer requestLease.Close()

	if err := s.DB.WithContext(ctx).
		Where(
			"kind = ? AND status IN ?",
			kind,
			[]string{
				meta.SystemMaintenanceStatusQueued,
				meta.SystemMaintenanceStatusRunning,
			},
		).
		Order("id DESC").
		First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return run, errBackgroundTaskControlUnavailable
		}
		return run, err
	}
	now := time.Now().UTC()
	if run.Status == meta.SystemMaintenanceStatusQueued {
		if err := s.DB.WithContext(ctx).
			Model(&meta.SystemMaintenanceRun{}).
			Where("id = ? AND status = ?", run.ID, meta.SystemMaintenanceStatusQueued).
			Updates(map[string]any{
				"status":              meta.SystemMaintenanceStatusCancelled,
				"phase":               meta.SystemMaintenancePhaseFinished,
				"summary":             "已取消",
				"cancel_requested_at": now,
				"finished_at":         now,
				"updated_at":          now,
			}).Error; err != nil {
			return run, err
		}
		run.Status = meta.SystemMaintenanceStatusCancelled
		run.CancelRequestedAt = &now
		run.FinishedAt = &now
	} else {
		if err := s.DB.WithContext(ctx).
			Model(&meta.SystemMaintenanceRun{}).
			Where("id = ? AND status = ?", run.ID, meta.SystemMaintenanceStatusRunning).
			Updates(map[string]any{
				"status":              meta.SystemMaintenanceStatusCancelRequested,
				"cancel_requested_at": now,
				"updated_at":          now,
			}).Error; err != nil {
			return run, err
		}
		run.Status = meta.SystemMaintenanceStatusCancelRequested
		run.CancelRequestedAt = &now
	}
	if s.BackgroundScheduler != nil {
		_ = s.BackgroundScheduler.Cancel(systemMaintenanceSchedulerIdentity(run))
	}
	return run, nil
}

func (s *Server) controlBackgroundSystemMaintenance(
	ctx context.Context,
	ref backgroundTaskRef,
	action string,
	viewerID uint64,
	admin bool,
) (backgroundTaskControlOutcome, error) {
	outcome := backgroundTaskControlOutcome{
		Kind: "system.maintenance." + ref.kind,
	}
	if !admin || ref.scope != background.ScopeSystem {
		return outcome, errBackgroundTaskControlUnavailable
	}
	switch action {
	case backgroundTaskActionRun:
		run, err := s.requestSystemMaintenanceRun(
			ctx,
			ref.kind,
			background.InitiatorAdmin,
			viewerID,
		)
		if err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = systemMaintenanceTaskCenterID(run.Kind)
		return outcome, nil
	case backgroundTaskActionCancel:
		run, err := s.requestSystemMaintenanceCancel(ctx, ref.kind)
		if err != nil {
			return outcome, err
		}
		outcome.ResultTaskID = systemMaintenanceTaskCenterID(run.Kind)
		return outcome, nil
	default:
		return outcome, errBackgroundTaskControlUnavailable
	}
}
