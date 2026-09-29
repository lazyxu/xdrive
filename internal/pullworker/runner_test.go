package pullworker

import (
	"context"
	"errors"
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
