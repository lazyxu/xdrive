package synologysync

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/synology"
)

type fakeRemote struct {
	page2Seen chan struct{}
}

func (f *fakeRemote) Available(space synology.Space) bool {
	return space == synology.SpacePersonal
}

func (f *fakeRemote) ListFoldersPage(context.Context, synology.Space, int, int) (synology.FolderPage, error) {
	return synology.FolderPage{
		Offset: 0,
		Total:  1,
		List:   []synology.Folder{{ID: 10, Name: "/2026", Parent: 0}},
	}, nil
}

func (f *fakeRemote) ListItemsPage(_ context.Context, _ synology.Space, offset, _ int) (synology.ItemPage, error) {
	if offset == 0 {
		return synology.ItemPage{
			Offset: 0,
			Total:  2,
			List: []synology.Item{{
				ID: 1, Filename: "a.jpg", Filesize: 10, FolderID: 10,
				IndexedTime: 1_700_000_000_000, OwnerUserID: 7, Time: 1_600_000_000,
				Additional: synology.ItemAdditional{Thumbnail: synology.Thumbnail{CacheKey: "1_1700"}},
				Space:      synology.SpacePersonal,
			}},
		}, nil
	}
	select {
	case f.page2Seen <- struct{}{}:
	default:
	}
	return synology.ItemPage{
		Offset: 1,
		Total:  2,
		List: []synology.Item{{
			ID: 2, Filename: "b.jpg", Filesize: 20, FolderID: 10,
			IndexedTime: 1_700_000_001_000, OwnerUserID: 7, Time: 1_600_000_001,
			Space: synology.SpacePersonal,
		}},
	}, nil
}

type fakeAPI struct {
	mu      sync.Mutex
	commits int
}

func (a *fakeAPI) ObserveSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	plans := make([]client.SourcePlan, 0, len(items))
	for _, item := range items {
		plans = append(plans, client.SourcePlan{ExternalID: item.ExternalID, Action: string(sourcepkg.ActionCreate)})
	}
	return plans, nil
}

func (a *fakeAPI) CommitSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceCommit) error {
	a.mu.Lock()
	a.commits += len(items)
	a.mu.Unlock()
	return nil
}

func (a *fakeAPI) FailSourceItems(context.Context, uint64, string, []client.SourceFailure) error {
	return nil
}

func (a *fakeAPI) UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error {
	return nil
}

func (a *fakeAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	return nil
}

type blockingExecutor struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (e *blockingExecutor) Execute(ctx context.Context, plan client.SourcePlan, item sourcepkg.DiscoveredItem, _ TransferRef) (client.SourceCommit, error) {
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

func TestScannerPipelinesScanAheadOfTransfer(t *testing.T) {
	remote := &fakeRemote{page2Seen: make(chan struct{}, 1)}
	api := &fakeAPI{}
	executor := &blockingExecutor{started: make(chan struct{}), release: make(chan struct{})}
	type outcome struct {
		result Result
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := (Scanner{
			Remote:            remote,
			API:               api,
			SourceID:          1,
			RunID:             "run-1",
			Mode:              meta.SourceRunModeSync,
			Spaces:            []synology.Space{synology.SpacePersonal},
			Executor:          executor,
			BatchSize:         1,
			TransferQueueSize: 1,
		}).Scan(context.Background())
		done <- outcome{result: result, err: err}
	}()

	select {
	case <-executor.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first transfer did not start")
	}
	select {
	case <-remote.page2Seen:
	case <-time.After(2 * time.Second):
		t.Fatal("scanner did not reach next page while transfer was blocked")
	}
	close(executor.release)

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.result.PersonalItems != 2 || got.result.SharedItems != 0 ||
			got.result.Summary.NewItems != 2 || got.result.Summary.FailedItems != 0 {
			t.Fatalf("unexpected result: %+v", got.result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("scan did not finish")
	}
	api.mu.Lock()
	commits := api.commits
	api.mu.Unlock()
	if commits != 2 {
		t.Fatalf("commits=%d want=2", commits)
	}
}

func TestFolderPathsAndStableItemIdentity(t *testing.T) {
	folders := map[int64]synology.Folder{
		10: {ID: 10, Name: "/Trips", Parent: 0},
		11: {ID: 11, Name: "Paris", Parent: 10},
	}
	paths := buildFolderPaths(folders)
	if paths[11] != "Trips/Paris" {
		t.Fatalf("path=%q", paths[11])
	}
	item, err := discoveredItem(synology.SpaceShared, paths, synology.Item{
		ID: 99, Filename: "IMG.JPG", Filesize: 12, FolderID: 11,
		IndexedTime: 1_700_000_000_000,
		Additional:  synology.ItemAdditional{Thumbnail: synology.Thumbnail{CacheKey: "99_1700"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.ExternalID != "synology:shared:99" ||
		item.Path != "Shared/Trips/Paris/IMG.JPG [99]" ||
		item.RemoteRevision != "cache:99_1700:size:12" {
		t.Fatalf("item=%+v", item)
	}
}

func TestScannerRejectsSelectedUnavailableSpace(t *testing.T) {
	_, err := (Scanner{
		Remote:   &fakeRemote{},
		API:      &fakeAPI{},
		SourceID: 1,
		RunID:    "run-unavailable",
		Mode:     meta.SourceRunModeScan,
		Spaces:   []synology.Space{synology.SpaceShared},
	}).Scan(context.Background())
	if err == nil || !strings.Contains(err.Error(), "selected but unavailable") {
		t.Fatalf("err=%v", err)
	}
}

func TestNormalizeSpacesDefaultsAndDeduplicates(t *testing.T) {
	got, err := normalizeSpaces(nil)
	if err != nil || len(got) != 2 || got[0] != synology.SpacePersonal || got[1] != synology.SpaceShared {
		t.Fatalf("default spaces=%v err=%v", got, err)
	}
	got, err = normalizeSpaces([]synology.Space{synology.SpaceShared, synology.SpacePersonal, synology.SpaceShared})
	if err != nil || len(got) != 2 || got[0] != synology.SpacePersonal || got[1] != synology.SpaceShared {
		t.Fatalf("normalized spaces=%v err=%v", got, err)
	}
	if _, err := normalizeSpaces([]synology.Space{"other"}); err == nil {
		t.Fatal("unknown Synology space was accepted")
	}
}
