package pullworker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"gorm.io/gorm"
)

const DefaultRunInterval = 6 * time.Hour

type SourceHandler interface {
	RunPullSource(context.Context, meta.Source) (client.SyncRun, error)
}

type SourceHandlerFunc func(context.Context, meta.Source) (client.SyncRun, error)

func (f SourceHandlerFunc) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	return f(ctx, source)
}

type Runner struct {
	DB       *gorm.DB
	Handlers map[string]SourceHandler
	Logger   *slog.Logger
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

func (r *Runner) runSources(ctx context.Context, sources []meta.Source, now time.Time) (RunAllReport, error) {
	report := RunAllReport{}
	var errs []error
	for _, source := range sources {
		handler := r.handler(source.Kind)
		if handler == nil {
			continue
		}
		report.Eligible++
		if err := ctx.Err(); err != nil {
			return report, err
		}
		run, err := handler.RunPullSource(ctx, source)
		if err != nil {
			if IsActiveRun(err) {
				report.Skipped++
				r.logger().Info("pull_source_skipped_active_run",
					"source_id", source.ID, "source_name", source.Name, "source_kind", source.Kind)
				continue
			}
			if run.ID == "" && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
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
			"run_id", run.ID, "status", run.Status,
			"scanned_items", run.ScannedItems,
			"planned_transfer_items", run.PlannedTransferItems,
			"planned_transfer_bytes", run.PlannedTransferBytes,
			"transferred_items", run.TransferredItems,
			"transferred_bytes", run.TransferredBytes,
			"missing_items", run.MissingItems)
	}
	return report, errors.Join(errs...)
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
