package pullworker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

type retryClassifyingHandler struct {
	class RetryClass
}

func (h retryClassifyingHandler) RunPullSource(_ context.Context, _ meta.Source) (client.SyncRun, error) {
	return client.SyncRun{}, errors.New("unused")
}

func (h retryClassifyingHandler) ClassifyPullRetry(error) RetryClass {
	return h.class
}

func TestRetryDelayIsBoundedAndJittered(t *testing.T) {
	for _, tc := range []struct {
		class   RetryClass
		base    time.Duration
		maximum time.Duration
	}{
		{RetryTransient, transientRetryBase, transientRetryMax},
		{RetryRateLimited, rateLimitedRetryBase, rateLimitedRetryMax},
	} {
		for attempt := 1; attempt <= maxPersistedRetryAttempt; attempt++ {
			got := retryDelay(tc.class, attempt, 42)
			if got < tc.base/2 || got > tc.maximum {
				t.Fatalf("class=%s attempt=%d delay=%s outside [%s,%s]", tc.class, attempt, got, tc.base/2, tc.maximum)
			}
		}
	}
	if retryDelay(RetryTransient, 3, 1) == retryDelay(RetryTransient, 3, 2) {
		t.Fatal("different Sources should not always receive identical retry jitter")
	}
}

func TestNextRetryStatePersistsAttemptAndDeadline(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	source := meta.Source{ID: 7, RetryAttempt: 2}
	attempt, at := nextRetryState(source, RetryTransient, now)
	if attempt != 3 {
		t.Fatalf("attempt=%d want=3", attempt)
	}
	if !at.After(now) || at.Sub(now) > transientRetryMax {
		t.Fatalf("retry deadline=%v now=%v", at, now)
	}
}

func TestClassifyPullRetryRequiresExplicitClassifier(t *testing.T) {
	err := errors.New("failure")
	if got := classifyPullRetry(SourceHandlerFunc(func(context.Context, meta.Source) (client.SyncRun, error) {
		return client.SyncRun{}, err
	}), err); got != RetryNone {
		t.Fatalf("unclassified handler retry=%q want none", got)
	}
	handler := retryClassifyingHandler{class: RetryTransient}
	if got := classifyPullRetry(handler, err); got != RetryTransient {
		t.Fatalf("classified retry=%q want transient", got)
	}
	handler.class = RetryClass("unknown")
	if got := classifyPullRetry(handler, err); got != RetryNone {
		t.Fatalf("invalid retry class=%q want none", got)
	}
}
