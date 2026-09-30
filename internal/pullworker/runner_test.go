package pullworker

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

type fakeHandler struct {
	calls int
	err   error
}

func (h *fakeHandler) RunPullSource(_ context.Context, source meta.Source) (client.SyncRun, error) {
	h.calls++
	if h.err != nil {
		return client.SyncRun{}, h.err
	}
	return client.SyncRun{ID: "run-1", SourceID: source.ID, Status: meta.SyncRunStatusCompleted}, nil
}

func TestRunnerDispatchesOnlyRegisteredPullKinds(t *testing.T) {
	yike := &fakeHandler{}
	runner := &Runner{Handlers: map[string]SourceHandler{"yike_photos": yike}}
	report, err := runner.runSources(context.Background(), []meta.Source{
		{ID: 1, Name: "Yike", Kind: "yike_photos"},
		{ID: 2, Name: "Future", Kind: "future_pull"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if yike.calls != 1 {
		t.Fatalf("yike calls=%d want=1", yike.calls)
	}
	if report.Eligible != 1 || report.Completed != 1 || report.Skipped != 0 || report.Failed != 0 {
		t.Fatalf("report=%+v", report)
	}
}

func TestRunnerStopsOnContextCancellation(t *testing.T) {
	handler := &fakeHandler{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runner := &Runner{Handlers: map[string]SourceHandler{"yike_photos": handler}}
	report, err := runner.runSources(ctx, []meta.Source{{ID: 1, Kind: "yike_photos"}}, time.Now().UTC())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v want context.Canceled", err)
	}
	if report.Eligible != 1 || handler.calls != 0 {
		t.Fatalf("report=%+v calls=%d", report, handler.calls)
	}
}

type blockingHandler struct {
	started chan uint64
	release chan struct{}
	current atomic.Int32
	max     atomic.Int32
}

func (h *blockingHandler) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	current := h.current.Add(1)
	for {
		max := h.max.Load()
		if current <= max || h.max.CompareAndSwap(max, current) {
			break
		}
	}
	defer h.current.Add(-1)
	h.started <- source.ID
	select {
	case <-ctx.Done():
		return client.SyncRun{}, ctx.Err()
	case <-h.release:
		return client.SyncRun{ID: "run", SourceID: source.ID, Status: meta.SyncRunStatusCompleted}, nil
	}
}

func TestRunnerBoundsSourceConcurrency(t *testing.T) {
	handler := &blockingHandler{
		started: make(chan uint64, 4),
		release: make(chan struct{}, 4),
	}
	runner := &Runner{
		Handlers:       map[string]SourceHandler{"yike_photos": handler},
		MaxConcurrency: 2,
	}
	sources := []meta.Source{
		{ID: 1, Kind: "yike_photos"},
		{ID: 2, Kind: "yike_photos"},
		{ID: 3, Kind: "yike_photos"},
		{ID: 4, Kind: "yike_photos"},
	}
	type outcome struct {
		report RunAllReport
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		report, err := runner.runSources(context.Background(), sources, time.Now().UTC())
		done <- outcome{report: report, err: err}
	}()

	<-handler.started
	<-handler.started
	select {
	case id := <-handler.started:
		t.Fatalf("source %d started before a concurrency slot was released", id)
	case <-time.After(100 * time.Millisecond):
	}
	for range sources {
		handler.release <- struct{}{}
	}
	<-handler.started
	<-handler.started

	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	if result.report.Eligible != 4 || result.report.Completed != 4 || result.report.Failed != 0 {
		t.Fatalf("report=%+v", result.report)
	}
	if got := handler.max.Load(); got != 2 {
		t.Fatalf("max concurrency=%d want=2", got)
	}
}

func TestPrioritizeDueSourcesManualRetryThenMostOverdue(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	lastTwelveHours := now.Add(-12 * time.Hour)
	lastSevenHours := now.Add(-7 * time.Hour)
	manualRequested := now.Add(-time.Minute)
	retryAt := now.Add(-2 * time.Minute)
	sources := []meta.Source{
		{ID: 1, ScheduleType: "interval", ScheduleExpression: "6h"},
		{ID: 2, ScheduleType: "interval", ScheduleExpression: "6h", LastRunAt: &lastSevenHours},
		{ID: 3, ScheduleType: "interval", ScheduleExpression: "6h", LastRunAt: &lastTwelveHours},
		{ID: 4, ScheduleType: "manual", RunRequestedAt: &manualRequested},
		{ID: 5, ScheduleType: "interval", ScheduleExpression: "6h", RetryAttempt: 1, RetryAt: &retryAt, RetryClass: "transient"},
	}
	got, err := prioritizeDueSources(sources, now, 6*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	want := []uint64{4, 5, 3, 2, 1}
	for i, source := range got {
		if source.ID != want[i] {
			t.Fatalf("priority[%d]=%d want=%d; ordered=%+v", i, source.ID, want[i], got)
		}
	}
}

func TestRunnerConcurrencyDefaultsAndCaps(t *testing.T) {
	runner := &Runner{}
	if got := runner.effectiveConcurrency(10); got != DefaultMaxConcurrency {
		t.Fatalf("default concurrency=%d want=%d", got, DefaultMaxConcurrency)
	}
	runner.MaxConcurrency = MaxSourceConcurrency + 20
	if got := runner.effectiveConcurrency(20); got != MaxSourceConcurrency {
		t.Fatalf("capped concurrency=%d want=%d", got, MaxSourceConcurrency)
	}
}
