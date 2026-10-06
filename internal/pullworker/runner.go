package pullworker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"gorm.io/gorm"
)

const (
	DefaultRunInterval    = 6 * time.Hour
	DefaultMaxConcurrency = 2
	MaxSourceConcurrency  = 8
)

type SourceHandler interface {
	RunPullSource(context.Context, meta.Source) (client.SyncRun, error)
}

// SourceConcurrencyKeyer lets a connector serialize Sources that share one
// upstream account/session budget without disabling concurrency for unrelated
// accounts. Keys are process-local coordination values and must never contain
// plaintext credentials.
type SourceConcurrencyKeyer interface {
	PullSourceConcurrencyKey(context.Context, meta.Source) string
}

type SourceHandlerFunc func(context.Context, meta.Source) (client.SyncRun, error)

func (f SourceHandlerFunc) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	return f(ctx, source)
}

type Runner struct {
	DB             *gorm.DB
	Handlers       map[string]SourceHandler
	Logger         *slog.Logger
	Scheduler      *background.Scheduler
	MaxConcurrency int
}

type RunAllReport struct {
	Eligible  int
	Completed int
	Skipped   int
	Failed    int
}

func (r *Runner) RunAll(ctx context.Context) (RunAllReport, error) {
	sources, err := r.loadSources(ctx, false, time.Time{}, 0)
	if err != nil {
		return RunAllReport{}, err
	}
	return r.runSources(ctx, sources, time.Now().UTC())
}

func (r *Runner) RunDue(ctx context.Context, now time.Time, interval time.Duration) (RunAllReport, error) {
	if interval <= 0 {
		interval = DefaultRunInterval
	}
	sources, err := r.loadSources(ctx, true, now.UTC(), interval)
	if err != nil {
		return RunAllReport{}, err
	}
	sources, err = prioritizeDueSources(sources, now.UTC(), interval)
	if err != nil {
		return RunAllReport{}, err
	}
	return r.runSources(ctx, sources, now.UTC())
}

func (r *Runner) loadSources(ctx context.Context, dueOnly bool, now time.Time, interval time.Duration) ([]meta.Source, error) {
	if r == nil || r.DB == nil {
		return nil, fmt.Errorf("pull worker database is unavailable")
	}
	query := r.DB.WithContext(ctx).
		Model(&meta.Source{}).
		Where("xd_sources.direction = ? AND xd_sources.status = ? AND xd_sources.sync_mode = ?",
			meta.SourceDirectionPull, meta.SourceStatusActive, meta.SourceSyncModeBackup)
	var sources []meta.Source
	if err := query.Order("xd_sources.id ASC").Find(&sources).Error; err != nil {
		return nil, err
	}
	if !dueOnly {
		return sources, nil
	}
	due := make([]meta.Source, 0, len(sources))
	for _, source := range sources {
		if r.handler(source.Kind) == nil {
			continue
		}
		isDue, err := sourceschedule.Due(source, now, interval)
		if err != nil {
			return nil, fmt.Errorf("source %d schedule: %w", source.ID, err)
		}
		if isDue {
			due = append(due, source)
		}
	}
	return due, nil
}

type rankedSource struct {
	source meta.Source
	manual bool
	retry  bool
	dueAt  time.Time
}

func prioritizeDueSources(sources []meta.Source, now time.Time, interval time.Duration) ([]meta.Source, error) {
	if len(sources) < 2 {
		return sources, nil
	}
	ranked := make([]rankedSource, 0, len(sources))
	for _, source := range sources {
		entry := rankedSource{source: source}
		if source.RunRequestedAt != nil {
			entry.manual = true
			entry.dueAt = source.RunRequestedAt.UTC()
		} else if source.RetryAt != nil {
			entry.retry = true
			entry.dueAt = source.RetryAt.UTC()
		} else {
			next, err := sourceschedule.NextRunAt(source, now, interval)
			if err != nil {
				return nil, fmt.Errorf("source %d schedule priority: %w", source.ID, err)
			}
			entry.dueAt = next
		}
		ranked = append(ranked, entry)
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		left, right := ranked[i], ranked[j]
		if left.manual != right.manual {
			return left.manual
		}
		if left.retry != right.retry {
			return left.retry
		}
		if !left.dueAt.Equal(right.dueAt) {
			return left.dueAt.Before(right.dueAt)
		}
		return left.source.ID < right.source.ID
	})
	ordered := make([]meta.Source, 0, len(ranked))
	for _, entry := range ranked {
		ordered = append(ordered, entry.source)
	}
	return ordered, nil
}

type sourceJob struct {
	source         meta.Source
	handler        SourceHandler
	concurrencyKey string
}

type sourceResult struct {
	index          int
	run            client.SyncRun
	err            error
	concurrencyKey string
}

func (r *Runner) runSources(ctx context.Context, sources []meta.Source, now time.Time) (RunAllReport, error) {
	jobs := make([]sourceJob, 0, len(sources))
	for _, source := range sources {
		handler := r.handler(source.Kind)
		if handler == nil {
			continue
		}
		key := ""
		if keyer, ok := handler.(SourceConcurrencyKeyer); ok {
			key = strings.TrimSpace(keyer.PullSourceConcurrencyKey(ctx, source))
		}
		jobs = append(jobs, sourceJob{source: source, handler: handler, concurrencyKey: key})
	}

	report := RunAllReport{Eligible: len(jobs)}
	if len(jobs) == 0 {
		return report, nil
	}
	if err := ctx.Err(); err != nil {
		return report, err
	}

	concurrency := r.effectiveConcurrency(len(jobs))
	scheduler := r.Scheduler
	ownsScheduler := false
	if scheduler == nil {
		config := background.DefaultConfig()
		queueCapacity := len(jobs)
		if queueCapacity < concurrency {
			queueCapacity = concurrency
		}
		config.Capacity = map[background.ResourceClass]int{
			background.ResourceNetwork: concurrency,
		}
		config.QueueCapacity = map[background.ResourceClass]int{
			background.ResourceNetwork: queueCapacity,
		}
		scheduler = background.NewScheduler(ctx, config)
		ownsScheduler = true
	}
	if ownsScheduler {
		defer scheduler.Close()
	}

	type scheduledSourceJob struct {
		task      background.Task
		handle    *background.Handle
		run       client.SyncRun
		submitErr error
	}
	scheduled := make([]scheduledSourceJob, len(jobs))

	var accountMu sync.Mutex
	accountWaiters := make(map[string][]int)
	for index, job := range jobs {
		if job.concurrencyKey != "" {
			accountWaiters[job.concurrencyKey] = append(
				accountWaiters[job.concurrencyKey],
				index,
			)
		}
	}
	removeAccountWaiterLocked := func(accountKey string, jobIndex int) {
		waiters := accountWaiters[accountKey]
		for index, queuedJobIndex := range waiters {
			if queuedJobIndex != jobIndex {
				continue
			}
			waiters = append(waiters[:index], waiters[index+1:]...)
			if len(waiters) == 0 {
				delete(accountWaiters, accountKey)
			} else {
				accountWaiters[accountKey] = waiters
			}
			return
		}
	}
	for index := range jobs {
		if err := ctx.Err(); err != nil {
			break
		}
		jobIndex := index
		job := jobs[jobIndex]
		priority, trigger, initiator, initiatorID := sourceBackgroundAttribution(job.source)
		task := background.Task{
			Key:         fmt.Sprintf("source.sync:%d:%d:%d", job.source.ID, now.UnixNano(), jobIndex),
			Kind:        "source.sync",
			GroupKey:    "source.sync",
			Scope:       background.ScopeUser,
			OwnerID:     job.source.OwnerID,
			Trigger:     trigger,
			Initiator:   initiator,
			InitiatorID: initiatorID,
			Priority:    priority,
			Resource:    background.ResourceNetwork,
		}

		if job.concurrencyKey != "" {
			accountKey := job.concurrencyKey
			task.Lease = func(leaseCtx context.Context, _ background.Descriptor) (background.Lease, bool, error) {
				accountMu.Lock()
				waiters := accountWaiters[accountKey]
				if len(waiters) == 0 || waiters[0] != jobIndex {
					accountMu.Unlock()
					return background.Lease{}, false, nil
				}
				accountMu.Unlock()

				var accountLease *sourceaccount.Lease
				if r.DB != nil {
					var acquired bool
					var err error
					accountLease, acquired, err = sourceaccount.TryAcquire(leaseCtx, r.DB, accountKey)
					if err != nil {
						accountMu.Lock()
						removeAccountWaiterLocked(accountKey, jobIndex)
						accountMu.Unlock()
						return background.Lease{}, false, fmt.Errorf("coordinate provider account: %w", err)
					}
					if !acquired {
						return background.Lease{}, false, nil
					}
				}

				return background.Lease{
					Release: func(context.Context, error) error {
						if accountLease != nil {
							accountLease.Close()
						}
						accountMu.Lock()
						removeAccountWaiterLocked(accountKey, jobIndex)
						accountMu.Unlock()
						return nil
					},
				}, true, nil
			}
		}

		task.Run = func(taskCtx context.Context) error {
			run, err := job.handler.RunPullSource(taskCtx, job.source)
			scheduled[jobIndex].run = run
			return err
		}
		scheduled[jobIndex].task = task
		handle, err := scheduler.Submit(task)
		scheduled[jobIndex].handle = handle
		scheduled[jobIndex].submitErr = err
		if err != nil && job.concurrencyKey != "" {
			accountMu.Lock()
			removeAccountWaiterLocked(job.concurrencyKey, jobIndex)
			accountMu.Unlock()
		}
	}

	ordered := make([]sourceResult, len(jobs))
	received := make([]bool, len(jobs))
	cancelled := false
	for index := range scheduled {
		entry := &scheduled[index]
		if entry.submitErr != nil {
			ordered[index] = sourceResult{index: index, err: entry.submitErr, concurrencyKey: jobs[index].concurrencyKey}
			received[index] = true
			continue
		}
		if entry.handle == nil {
			continue
		}

		waitCtx := ctx
		if cancelled {
			waitCtx = context.Background()
		}
		err := entry.handle.Wait(waitCtx)
		if ctx.Err() != nil && !cancelled {
			cancelled = true
			for cancelIndex := range scheduled {
				candidate := &scheduled[cancelIndex]
				if candidate.handle == nil {
					continue
				}
				scheduler.Cancel(background.Identity{
					Scope:   candidate.task.Scope,
					OwnerID: candidate.task.OwnerID,
					Key:     candidate.task.Key,
				})
			}
			err = entry.handle.Wait(context.Background())
		} else if cancelled {
			err = entry.handle.Wait(context.Background())
		}
		ordered[index] = sourceResult{
			index:          index,
			run:            entry.run,
			err:            err,
			concurrencyKey: jobs[index].concurrencyKey,
		}
		received[index] = true
	}

	var errs []error
	for index, job := range jobs {
		if !received[index] {
			continue
		}
		result := ordered[index]
		source := job.source
		if result.err != nil {
			if IsActiveRun(result.err) {
				report.Skipped++
				r.logger().Info("pull_source_skipped_active_run",
					"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind)
				continue
			}
			if errors.Is(result.err, background.ErrQueueFull) {
				report.Skipped++
				r.logger().Info("pull_source_deferred_scheduler_backpressure",
					"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind)
				continue
			}
			if ctx.Err() != nil && (errors.Is(result.err, context.Canceled) || errors.Is(result.err, context.DeadlineExceeded)) {
				errs = append(errs, result.err)
				continue
			}
			err := result.err
			if result.run.ID == "" && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				if recordErr := r.recordPreflightFailure(ctx, source.ID, now, err); recordErr != nil {
					err = errors.Join(err, fmt.Errorf("record source preflight failure: %w", recordErr))
				}
			}
			if retryErr := r.persistRetryOutcome(ctx, source, job.handler, result.err, now); retryErr != nil {
				err = errors.Join(err, fmt.Errorf("persist source retry state: %w", retryErr))
			}
			report.Failed++
			errs = append(errs, fmt.Errorf("source %d (%s): %w", source.ID, source.Name, err))
			r.logger().Error("pull_source_failed",
				"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind, "error", err)
			continue
		}
		if retryErr := r.persistRetryOutcome(ctx, source, job.handler, nil, now); retryErr != nil {
			errs = append(errs, fmt.Errorf("source %d (%s) clear retry state: %w", source.ID, source.Name, retryErr))
			r.logger().Error("pull_source_retry_state_clear_failed",
				"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind, "error", retryErr)
		}
		report.Completed++
		r.logger().Info("pull_source_completed",
			"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind,
			"run_id", result.run.ID, "status", result.run.Status,
			"scanned_items", result.run.ScannedItems,
			"planned_transfer_items", result.run.PlannedTransferItems,
			"planned_transfer_bytes", result.run.PlannedTransferBytes,
			"transferred_items", result.run.TransferredItems,
			"transferred_bytes", result.run.TransferredBytes,
			"missing_items", result.run.MissingItems)
	}
	if ctx.Err() != nil {
		errs = append(errs, ctx.Err())
	}
	return report, errors.Join(errs...)
}

func sourceBackgroundAttribution(source meta.Source) (background.Priority, background.Trigger, background.Initiator, uint64) {
	if source.RunRequestedAt != nil {
		return background.PriorityP0, background.TriggerUserAction, background.InitiatorUser, source.OwnerID
	}
	return background.PriorityP2, background.TriggerSchedule, background.InitiatorSystem, 0
}

func (r *Runner) effectiveConcurrency(total int) int {
	if total <= 0 {
		return 0
	}
	limit := r.MaxConcurrency
	if limit <= 0 {
		limit = DefaultMaxConcurrency
	}
	if limit > MaxSourceConcurrency {
		limit = MaxSourceConcurrency
	}
	if limit > total {
		limit = total
	}
	if limit < 1 {
		limit = 1
	}
	return limit
}

func (r *Runner) handler(kind string) SourceHandler {
	if r == nil || r.Handlers == nil {
		return nil
	}
	return r.Handlers[kind]
}

func (r *Runner) recordPreflightFailure(ctx context.Context, sourceID uint64, now time.Time, cause error) error {
	if sourceID == 0 || cause == nil {
		return nil
	}
	return r.DB.WithContext(ctx).Model(&meta.Source{}).Where("id = ?", sourceID).Updates(map[string]any{
		"last_run_at":      now,
		"last_error":       truncateError(cause),
		"run_requested_at": nil,
		"updated_at":       now,
	}).Error
}

func (r *Runner) logger() *slog.Logger {
	if r != nil && r.Logger != nil {
		return r.Logger
	}
	return slog.Default()
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) <= 4096 {
		return value
	}
	return value[:4096]
}
