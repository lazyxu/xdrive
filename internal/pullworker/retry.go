package pullworker

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RetryClass string

const RetryNone RetryClass = ""
const RetryTransient RetryClass = "transient"
const RetryRateLimited RetryClass = "rate_limited"
const RetryRateLimitedCooldown RetryClass = "rate_limited_cooldown"

const maxPersistedRetryAttempt = 16
const transientRetryBase = time.Minute
const transientRetryMax = 30 * time.Minute
const rateLimitedRetryBase = 2 * time.Minute
const rateLimitedRetryMax = time.Hour
const rateLimitedCooldownBase = 12 * time.Minute
const rateLimitedCooldownMax = time.Hour

type RetryClassifier interface {
	ClassifyPullRetry(error) RetryClass
}

func ValidRetryClass(class RetryClass) bool {
	switch class {
	case RetryNone, RetryTransient, RetryRateLimited, RetryRateLimitedCooldown:
		return true
	default:
		return false
	}
}

func classifyPullRetry(handler SourceHandler, err error) RetryClass {
	if err == nil || errors.Is(err, context.Canceled) {
		return RetryNone
	}
	classifier, ok := handler.(RetryClassifier)
	if !ok {
		return RetryNone
	}
	class := classifier.ClassifyPullRetry(err)
	if !ValidRetryClass(class) {
		return RetryNone
	}
	return class
}

func nextRetryState(source meta.Source, class RetryClass, now time.Time) (int, time.Time) {
	attempt := source.RetryAttempt + 1
	if attempt < 1 {
		attempt = 1
	}
	if attempt > maxPersistedRetryAttempt {
		attempt = maxPersistedRetryAttempt
	}
	return attempt, now.UTC().Add(retryDelay(class, attempt, source.ID))
}

func retryDelay(class RetryClass, attempt int, sourceID uint64) time.Duration {
	base, maximum := transientRetryBase, transientRetryMax
	if class == RetryRateLimited {
		base, maximum = rateLimitedRetryBase, rateLimitedRetryMax
	}
	if class == RetryRateLimitedCooldown {
		base, maximum = rateLimitedCooldownBase, rateLimitedCooldownMax
	}
	if attempt < 1 {
		attempt = 1
	}
	delay := base
	for i := 1; i < attempt && delay < maximum; i++ {
		if delay > maximum/2 {
			delay = maximum
			break
		}
		delay *= 2
	}
	if delay > maximum {
		delay = maximum
	}

	// Stable +/-20% jitter spreads retries across Sources while the chosen
	// deadline remains reproducible and persisted across worker restarts.
	seed := sourceID*1103515245 + uint64(attempt)*12345
	percent := int64(seed%41) - 20
	jittered := delay + time.Duration(int64(delay)*percent/100)
	if jittered < base/2 {
		jittered = base / 2
	}
	if jittered > maximum {
		jittered = maximum
	}
	return jittered
}

func (r *Runner) persistRetryOutcome(
	ctx context.Context,
	source meta.Source,
	handler SourceHandler,
	runErr error,
	now time.Time,
	runID string,
) error {
	class := classifyPullRetry(handler, runErr)
	if source.ScheduleType == sourceschedule.TypeManual {
		class = RetryNone
	}

	hasState := source.RetryAttempt != 0 || source.RetryAt != nil || source.RetryClass != ""
	updates := map[string]any{"updated_at": now.UTC()}
	if runErr == nil || class == RetryNone {
		if !hasState {
			return nil
		}
		updates["retry_attempt"] = 0
		updates["retry_at"] = nil
		updates["retry_class"] = ""
	} else {
		attempt, retryAt := nextRetryState(source, class, now)
		updates["retry_attempt"] = attempt
		updates["retry_at"] = retryAt
		updates["retry_class"] = string(class)
	}

	if r == nil || r.DB == nil {
		return fmt.Errorf("pull worker database is unavailable")
	}
	write := func(tx *gorm.DB) error {
		return tx.Model(&meta.Source{}).
			Where("id = ? AND revision = ? AND status = ?", source.ID, source.Revision, meta.SourceStatusActive).
			Updates(updates).Error
	}
	if runID == "" {
		// Only legacy/no-run outcomes use the existing Source revision fence.
		// A failed preflight without a SyncRun is separately fenced by
		// recordPreflightFailure.
		return write(r.DB.WithContext(ctx))
	}

	// An old durable SyncRun may have been superseded after a lost heartbeat
	// without any Source revision change. Its late retry/clear must not
	// overwrite the latest run's state. Lock Source first, matching the
	// HTTP begin/finish lock order, then inspect the latest durable run under
	// the same transaction so a new begin cannot race this decision.
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND revision = ? AND status = ?", source.ID, source.Revision, meta.SourceStatusActive).
			First(&current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var latest meta.SyncRun
		if err := tx.Where("source_id = ?", source.ID).
			Order("run_number DESC").First(&latest).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if latest.ID != runID {
			return nil
		}
		return write(tx)
	})
}
