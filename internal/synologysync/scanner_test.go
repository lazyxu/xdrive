package synologysync

import (
	"context"
	"errors"
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
	page2Seen  chan struct{}
	albums     map[synology.Space][]synology.Album
	albumItems map[synology.Space]map[int64][]synology.Item
}

func (f *fakeRemote) Available(space synology.Space) bool {
	return space == synology.SpacePersonal
}

func (f *fakeRemote) AlbumsAvailable(space synology.Space) bool {
	_, ok := f.albums[space]
	return ok
}

func (f *fakeRemote) ListAlbumsPage(_ context.Context, space synology.Space, offset, limit int) (synology.AlbumPage, error) {
	list := f.albums[space]
	if offset >= len(list) {
		return synology.AlbumPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	page := append([]synology.Album(nil), list[offset:end]...)
	for i := range page {
		page[i].Space = space
	}
	return synology.AlbumPage{Offset: offset, Total: len(list), List: page}, nil
}

func (f *fakeRemote) ListAlbumItemsPage(_ context.Context, space synology.Space, albumID int64, offset, limit int) (synology.ItemPage, error) {
	list := f.albumItems[space][albumID]
	if offset >= len(list) {
		return synology.ItemPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	page := append([]synology.Item(nil), list[offset:end]...)
	for i := range page {
		page[i].Space = space
	}
	return synology.ItemPage{Offset: offset, Total: len(list), List: page}, nil
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

type albumListErrorRemote struct {
	*fakeRemote
	err error
}

func (r *albumListErrorRemote) ListAlbumsPage(context.Context, synology.Space, int, int) (synology.AlbumPage, error) {
	if r.err != nil {
		return synology.AlbumPage{}, r.err
	}
	return synology.AlbumPage{}, synology.ErrUnavailable
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
		10: {ID: 10, Name: "Trips", Parent: 0},
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
		item.Path != "Shared/Trips/Paris/IMG.JPG" ||
		item.RemoteRevision != "cache:99_1700:size:12" {
		t.Fatalf("item=%+v", item)
	}
}

type seededSourceItemLister struct {
	items []client.SourceItem
}

func (l seededSourceItemLister) SourceItems(_ context.Context, _ uint64, _ string, limit, offset int) ([]client.SourceItem, error) {
	if offset >= len(l.items) {
		return nil, nil
	}
	end := offset + limit
	if end > len(l.items) {
		end = len(l.items)
	}
	return append([]client.SourceItem(nil), l.items[offset:end]...), nil
}

func TestReserveSynologyPathOnlyAddsSuffixOnConflict(t *testing.T) {
	owners := map[string]string{}
	first := reserveSynologyPath("Personal/Trips/IMG_0001.JPG", 1, "synology:personal:1", owners)
	if first != "Personal/Trips/IMG_0001.JPG" {
		t.Fatalf("first path=%q", first)
	}
	second := reserveSynologyPath("Personal/Trips/img_0001.jpg", 2, "synology:personal:2", owners)
	if second != "Personal/Trips/img_0001 (2).jpg" {
		t.Fatalf("case-insensitive collision path=%q", second)
	}
	otherFolder := reserveSynologyPath("Personal/Other/IMG_0001.JPG", 3, "synology:personal:3", owners)
	if otherFolder != "Personal/Other/IMG_0001.JPG" {
		t.Fatalf("other-folder path=%q", otherFolder)
	}
}

func TestSeedSynologyPathOwnersKeepsExistingOwner(t *testing.T) {
	nodeID := uint64(9)
	owners := map[string]string{}
	err := seedSynologyPathOwners(context.Background(), seededSourceItemLister{items: []client.SourceItem{{
		ExternalID: "synology:personal:1",
		NodeID:     &nodeID,
		Path:       "Personal/Trips/IMG_0001.jpg",
	}}}, 1, owners)
	if err != nil {
		t.Fatal(err)
	}
	got := reserveSynologyPath("Personal/Trips/IMG_0001.jpg", 2, "synology:personal:2", owners)
	if got != "Personal/Trips/IMG_0001 (2).jpg" {
		t.Fatalf("new collision took existing path: %q", got)
	}
	got = reserveSynologyPath("Personal/Trips/IMG_0001.jpg", 1, "synology:personal:1", owners)
	if got != "Personal/Trips/IMG_0001.jpg" {
		t.Fatalf("existing owner lost canonical path: %q", got)
	}
}

func TestSynologyVisibleNameNormalizationPreservesRepresentableDetails(t *testing.T) {
	cases := []struct {
		in   string
		id   int64
		want string
	}{
		{"  leading-space.jpg", 1, "  leading-space.jpg"},
		{"trailing-space.jpg   ", 2, "trailing-space.jpg"},
		{"CON.jpg", 3, "_CON.jpg"},
		{"bad<>:\"name?.jpg", 4, "bad____name_.jpg"},
		{"/Trips", 5, "_Trips"},
	}
	for _, tt := range cases {
		got := sanitizeSegment(tt.in, tt.id, false)
		if got != tt.want {
			t.Fatalf("sanitizeSegment(%q)=%q want=%q", tt.in, got, tt.want)
		}
		if err := meta.ValidateName(got); err != nil {
			t.Fatalf("normalized filename %q invalid: %v", got, err)
		}
	}

	long := strings.Repeat("长", 100) + ".jpg"
	got := sanitizeSegment(long, 6, false)
	if len([]byte(got)) > 255 {
		t.Fatalf("long filename bytes=%d", len([]byte(got)))
	}
	if !strings.HasSuffix(got, ".jpg") {
		t.Fatalf("long filename lost extension: %q", got)
	}
}

func TestSynologyMetadataKeepsOriginalVisibleFilename(t *testing.T) {
	snapshot := metadataSnapshot(synology.SpacePersonal, map[int64]string{10: "Trips"}, synology.Item{
		ID: 7, FolderID: 10, Filename: "  original name.jpg  ", OwnerUserID: 42, Time: 1_700_000_000,
	})
	if snapshot.OriginalPath != "Trips/  original name.jpg  " {
		t.Fatalf("original path=%q", snapshot.OriginalPath)
	}
	if snapshot.OwnerExternalID != "42" {
		t.Fatalf("owner=%q", snapshot.OwnerExternalID)
	}
}

func TestScannerBuildsAlbumCollectionSnapshotsWithoutDuplicatingMedia(t *testing.T) {
	remote := &fakeRemote{
		albums: map[synology.Space][]synology.Album{
			synology.SpacePersonal: {{
				ID: 101, Name: "Trips", Type: "normal", ItemCount: 4, CreateTime: 1_600_000_000,
			}},
		},
		albumItems: map[synology.Space]map[int64][]synology.Item{
			synology.SpacePersonal: {
				101: {
					{ID: 1},
					{ID: 2},
					{ID: 2},
					{ID: 999},
				},
			},
		},
	}
	result, err := (Scanner{
		Remote: remote, API: &fakeAPI{}, SourceID: 1, RunID: "run-albums",
		Mode: meta.SourceRunModeScan, Spaces: []synology.Space{synology.SpacePersonal},
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.CollectionsComplete || result.Albums != 1 || result.AlbumMemberships != 4 || result.DuplicateMemberships != 1 {
		t.Fatalf("unexpected album result: %+v", result)
	}
	if len(result.Collections) != 1 {
		t.Fatalf("collections=%d", len(result.Collections))
	}
	collection := result.Collections[0]
	if collection.ExternalID != "synology:album:personal:101" || collection.Kind != "album" ||
		collection.Name != "Trips" || len(collection.Members) != 2 {
		t.Fatalf("collection=%+v", collection)
	}
	if collection.Members[0].ItemExternalID != "synology:personal:1" || collection.Members[0].Position != 0 ||
		collection.Members[1].ItemExternalID != "synology:personal:2" || collection.Members[1].Position != 1 {
		t.Fatalf("members=%+v", collection.Members)
	}
	if !strings.Contains(collection.RemoteRevision, "count:4") {
		t.Fatalf("revision=%q", collection.RemoteRevision)
	}
}

func TestScannerKeepsFileInventoryWhenAlbumListingFails(t *testing.T) {
	remote := &albumListErrorRemote{fakeRemote: &fakeRemote{
		albums: map[synology.Space][]synology.Album{
			synology.SpacePersonal: {{ID: 101, Name: "Trips"}},
		},
	}}
	result, err := (Scanner{
		Remote: remote, API: &fakeAPI{}, SourceID: 1, RunID: "run-album-error",
		Mode: meta.SourceRunModeScan, Spaces: []synology.Space{synology.SpacePersonal},
	}).Scan(context.Background())
	if err != nil {
		t.Fatalf("album metadata failure must not fail an otherwise complete file scan: %v", err)
	}
	if result.CollectionsComplete || len(result.Collections) != 0 {
		t.Fatalf("partial album snapshot must not be applied: %+v", result)
	}
	if result.Summary.ScannedItems != 2 || result.PersonalItems != 2 {
		t.Fatalf("file inventory was not preserved: %+v", result)
	}
	if len(result.Errors) != 1 || !strings.Contains(result.Errors[0], "相册元数据本轮未更新") {
		t.Fatalf("album warning=%v", result.Errors)
	}
}

func TestScannerKeepsAlbumAuthenticationFailureFatal(t *testing.T) {
	remote := &albumListErrorRemote{
		fakeRemote: &fakeRemote{
			albums: map[synology.Space][]synology.Album{
				synology.SpacePersonal: {{ID: 101, Name: "Trips"}},
			},
		},
		err: synology.ErrAuthentication,
	}
	_, err := (Scanner{
		Remote: remote, API: &fakeAPI{}, SourceID: 1, RunID: "run-album-auth",
		Mode: meta.SourceRunModeScan, Spaces: []synology.Space{synology.SpacePersonal},
	}).Scan(context.Background())
	if !errors.Is(err, synology.ErrAuthentication) {
		t.Fatalf("album authentication err=%v want ErrAuthentication", err)
	}
}

func TestCollectAlbumsKeepsHeartbeatFailureFatal(t *testing.T) {
	remote := &fakeRemote{
		albums: map[synology.Space][]synology.Album{
			synology.SpacePersonal: {{ID: 101, Name: "Trips"}},
		},
	}
	_, err := collectAlbums(context.Background(), remote, synology.SpacePersonal, func() error {
		return synology.ErrUnavailable
	})
	if err != synology.ErrUnavailable {
		t.Fatalf("heartbeat err=%v want direct fatal control-plane error", err)
	}
}

func TestScannerLeavesCollectionsUntouchedWhenAlbumAPIUnavailable(t *testing.T) {
	result, err := (Scanner{
		Remote: &fakeRemote{}, API: &fakeAPI{}, SourceID: 1, RunID: "run-no-albums",
		Mode: meta.SourceRunModeScan, Spaces: []synology.Space{synology.SpacePersonal},
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.CollectionsComplete || len(result.Collections) != 0 {
		t.Fatalf("unexpected collection snapshot: %+v", result)
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

func TestNextOffsetRejectsGapsAndOverlaps(t *testing.T) {
	for _, tc := range []struct {
		name      string
		requested int
		returned  int
		total     int
		count     int
	}{
		{name: "provider skipped ahead", requested: 100, returned: 200, total: 500, count: 100},
		{name: "provider overlapped prior page", requested: 100, returned: 99, total: 500, count: 100},
		{name: "page exceeds total", requested: 400, returned: 400, total: 450, count: 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := nextOffset(tc.requested, tc.returned, tc.total, tc.count); err == nil {
				t.Fatalf("nextOffset(%d,%d,%d,%d) accepted inconsistent pagination",
					tc.requested, tc.returned, tc.total, tc.count)
			}
		})
	}
	if next, done, err := nextOffset(100, 100, 150, 50); err != nil || !done || next != 150 {
		t.Fatalf("valid final page next=%d done=%t err=%v", next, done, err)
	}
}

type duplicateItemRemote struct {
	*fakeRemote
}

func (r *duplicateItemRemote) ListItemsPage(_ context.Context, _ synology.Space, offset, _ int) (synology.ItemPage, error) {
	return synology.ItemPage{
		Offset: offset,
		Total:  2,
		List: []synology.Item{{
			ID: 1, Filename: "a.jpg", Filesize: 10, FolderID: 10,
			IndexedTime: 1_700_000_000_000, Space: synology.SpacePersonal,
		}},
	}, nil
}

func TestScannerRejectsDuplicateItemIdentityAcrossPages(t *testing.T) {
	remote := &duplicateItemRemote{fakeRemote: &fakeRemote{}}
	_, err := (Scanner{
		Remote: remote, API: &fakeAPI{}, SourceID: 1, RunID: "run-duplicate",
		Mode: meta.SourceRunModeScan, Spaces: []synology.Space{synology.SpacePersonal},
	}).Scan(context.Background())
	if err == nil || !strings.Contains(err.Error(), "identity repeated") {
		t.Fatalf("duplicate item err=%v", err)
	}
}
