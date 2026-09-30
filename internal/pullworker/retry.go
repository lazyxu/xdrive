package pullworker

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

type RetryClass string

const RetryNone RetryClass = ""
const RetryTransient RetryClass = "transient"
const RetryRateLimited RetryClass = "rate_limited"

const maxPersistedRetryAttempt = 16
const transientRetryBase = time.Minute
const transientRetryMax = 30 * time.Minute
const rateLimitedRetryBase = 2 * time.Minute
const rateLimitedRetryMax = time.Hour

type RetryClassifier interface {
	ClassifyPullRetry(error) RetryClass
}

func ValidRetryClass(class RetryClass) bool {
	switch class {
	case RetryNone, RetryTransient, RetryRateLimited:
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
) error {
	class := classifyPullRetry(handler, runErr)
	if source.ScheduleType == sourceschedule.TypeManual {
		class = RetryNone
	}

	hasState := source.RetryAttempt != 0 || source.RetryAt != nil || source.RetryClass != ""
	if runErr == nil || class == RetryNone {
		if !hasState {
			return nil
		}
		if r == nil || r.DB == nil {
			return fmt.Errorf("pull worker database is unavailable")
		}
		return r.DB.WithContext(ctx).Model(&meta.Source{}).Where("id = ?", source.ID).Updates(map[string]any{
			"retry_attempt": 0,
			"retry_at":      nil,
			"retry_class":   "",
			"updated_at":    now.UTC(),
		}).Error
	}

	if r == nil || r.DB == nil {
		return fmt.Errorf("pull worker database is unavailable")
	}
	attempt, retryAt := nextRetryState(source, class, now)
	return r.DB.WithContext(ctx).Model(&meta.Source{}).Where("id = ?", source.ID).Updates(map[string]any{
		"retry_attempt": attempt,
		"retry_at":      retryAt,
		"retry_class":   string(class),
		"updated_at":    now.UTC(),
	}).Error
}
