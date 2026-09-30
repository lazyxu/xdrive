package pullworker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
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

type SourceHandlerFunc func(context.Context, meta.Source) (client.SyncRun, error)

func (f SourceHandlerFunc) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	return f(ctx, source)
}

type Runner struct {
	DB             *gorm.DB
	Handlers       map[string]SourceHandler
	Logger         *slog.Logger
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
	source  meta.Source
	handler SourceHandler
}

type sourceResult struct {
	index int
	run   client.SyncRun
	err   error
}

func (r *Runner) runSources(ctx context.Context, sources []meta.Source, now time.Time) (RunAllReport, error) {
	jobs := make([]sourceJob, 0, len(sources))
	for _, source := range sources {
		handler := r.handler(source.Kind)
		if handler == nil {
			continue
		}
		jobs = append(jobs, sourceJob{source: source, handler: handler})
	}

	report := RunAllReport{Eligible: len(jobs)}
	if len(jobs) == 0 {
		return report, nil
	}
	if err := ctx.Err(); err != nil {
		return report, err
	}

	concurrency := r.effectiveConcurrency(len(jobs))
	semaphore := make(chan struct{}, concurrency)
	results := make(chan sourceResult, len(jobs))
	scheduled := 0

scheduleLoop:
	for index, job := range jobs {
		select {
		case <-ctx.Done():
			break scheduleLoop
		case semaphore <- struct{}{}:
		}
		scheduled++
		go func(index int, job sourceJob) {
			defer func() { <-semaphore }()
			if err := ctx.Err(); err != nil {
				results <- sourceResult{index: index, err: err}
				return
			}
			run, err := job.handler.RunPullSource(ctx, job.source)
			results <- sourceResult{index: index, run: run, err: err}
		}(index, job)
	}

	ordered := make([]sourceResult, len(jobs))
	received := make([]bool, len(jobs))
	for i := 0; i < scheduled; i++ {
		result := <-results
		ordered[result.index] = result
		received[result.index] = true
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
			report.Failed++
			errs = append(errs, fmt.Errorf("source %d (%s): %w", source.ID, source.Name, err))
			r.logger().Error("pull_source_failed",
				"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind, "error", err)
			continue
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
