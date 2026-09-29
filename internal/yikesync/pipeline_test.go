package yikesync

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/yike"
)

type pipelineTestRemote struct {
	page2Seen chan struct{}
}

func (r *pipelineTestRemote) UserInfo(context.Context) (yike.UserInfo, error) {
	return yike.UserInfo{YouaID: "123"}, nil
}

func (r *pipelineTestRemote) ListFilesPage(_ context.Context, cursor string) (yike.FileList, error) {
	if cursor == "" {
		return yike.FileList{
			Page: yike.Page{HasMore: 1, Cursor: "next"},
			List: []yike.File{{FSID: 1, Path: "/first.jpg", Size: 10, MTime: 100}},
		}, nil
	}
	select {
	case r.page2Seen <- struct{}{}:
	default:
	}
	return yike.FileList{
		Page: yike.Page{HasMore: 0},
		List: []yike.File{{FSID: 2, Path: "/second.jpg", Size: 20, MTime: 200}},
	}, nil
}

func (r *pipelineTestRemote) ListAlbumsPage(context.Context, string) (yike.AlbumList, error) {
	return yike.AlbumList{Page: yike.Page{HasMore: 0}}, nil
}

func (r *pipelineTestRemote) ListAlbumFilesPage(context.Context, string, string) (yike.AlbumFileList, error) {
	return yike.AlbumFileList{Page: yike.Page{HasMore: 0}}, nil
}

type pipelineTestAPI struct {
	mu      sync.Mutex
	commits int
}

func (a *pipelineTestAPI) ObserveSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	plans := make([]client.SourcePlan, 0, len(items))
	for _, item := range items {
		plans = append(plans, client.SourcePlan{ExternalID: item.ExternalID, Action: string(sourcepkg.ActionCreate)})
	}
	return plans, nil
}

func (a *pipelineTestAPI) CommitSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceCommit) error {
	a.mu.Lock()
	a.commits += len(items)
	a.mu.Unlock()
	return nil
}

func (a *pipelineTestAPI) FailSourceItems(context.Context, uint64, string, []client.SourceFailure) error {
	return nil
}

func (a *pipelineTestAPI) UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error {
	return nil
}

func (a *pipelineTestAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	return nil
}

type blockingPipelineExecutor struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (e *blockingPipelineExecutor) Execute(ctx context.Context, plan client.SourcePlan, item sourcepkg.DiscoveredItem, _ TransferRef) (client.SourceCommit, error) {
	block := false
	e.once.Do(func() {
		block = true
		close(e.started)
	})
	if block {
		select {
		case <-e.release:
		case <-ctx.Done():
			return client.SourceCommit{}, ctx.Err()
		}
	}
	return client.SourceCommit{
		ExternalID:       item.ExternalID,
		Action:           plan.Action,
		NodeID:           100,
		NodeRevision:     1,
		Kind:             item.Kind,
		Path:             item.Path,
		Size:             item.Size,
		ModifiedAt:       item.ModifiedAt,
		SHA256:           strings.Repeat("a", 64),
		RemoteRevision:   item.RemoteRevision,
		Transferred:      true,
		TransferredBytes: item.Size,
	}, nil
}

func TestScannerSyncPipelinesScanAheadOfTransfer(t *testing.T) {
	remote := &pipelineTestRemote{page2Seen: make(chan struct{}, 1)}
	api := &pipelineTestAPI{}
	executor := &blockingPipelineExecutor{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}

	type scanOutcome struct {
		result Result
		err    error
	}
	done := make(chan scanOutcome, 1)
	go func() {
		result, err := (Scanner{
			Remote:            remote,
			API:               api,
			SourceID:          1,
			RunID:             "run-pipeline",
			Mode:              meta.SourceRunModeSync,
			Executor:          executor,
			BatchSize:         1,
			TransferQueueSize: 1,
		}).Scan(context.Background())
		done <- scanOutcome{result: result, err: err}
	}()

	select {
	case <-executor.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first transfer did not start")
	}

	select {
	case <-remote.page2Seen:
		// The scanner reached page 2 while the first transfer was still blocked.
	case <-time.After(2 * time.Second):
		t.Fatal("scanner did not continue while the transfer worker was busy")
	}

	close(executor.release)

	var outcome scanOutcome
	select {
	case outcome = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("pipeline scan did not finish")
	}
	if outcome.err != nil {
		t.Fatal(outcome.err)
	}
	if outcome.result.RootItems != 2 || outcome.result.Summary.NewItems != 2 || outcome.result.Summary.FailedItems != 0 {
		t.Fatalf("unexpected result: %+v", outcome.result)
	}
	api.mu.Lock()
	commits := api.commits
	api.mu.Unlock()
	if commits != 2 {
		t.Fatalf("commits=%d want=2", commits)
	}
}
