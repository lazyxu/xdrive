package yikesync

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcemetadata"
	"github.com/lazyxu/xdrive/internal/yike"
)

type fakeRemote struct {
	user        yike.UserInfo
	files       map[string]yike.FileList
	albums      map[string]yike.AlbumList
	albumFiles  map[string]map[string]yike.AlbumFileList
	queuedFSIDs []int64
}

func (f *fakeRemote) UserInfo(context.Context) (yike.UserInfo, error) {
	return f.user, nil
}

func (f *fakeRemote) ListFilesPage(_ context.Context, cursor string) (yike.FileList, error) {
	return f.files[cursor], nil
}

func (f *fakeRemote) ListAlbumsPage(_ context.Context, cursor string) (yike.AlbumList, error) {
	return f.albums[cursor], nil
}

func (f *fakeRemote) ListAlbumFilesPage(_ context.Context, albumID, cursor string) (yike.AlbumFileList, error) {
	return f.albumFiles[albumID][cursor], nil
}

func (f *fakeRemote) QueueDownloadFileLinks(fsids []int64) {
	f.queuedFSIDs = append(f.queuedFSIDs, fsids...)
}

type fakeSourceAPI struct {
	observed    [][]client.SourceObservation
	commits     [][]client.SourceCommit
	failures    [][]client.SourceFailure
	progress    []sourcepkg.Summary
	heartbeatMu sync.Mutex
	heartbeats  int
	action      string
	commitErr   error
}

func (f *fakeSourceAPI) ObserveSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	copyItems := append([]client.SourceObservation(nil), items...)
	f.observed = append(f.observed, copyItems)
	action := f.action
	if action == "" {
		action = "create"
	}
	out := make([]client.SourcePlan, 0, len(items))
	for _, item := range items {
		out = append(out, client.SourcePlan{ExternalID: item.ExternalID, Action: action})
	}
	return out, nil
}

func (f *fakeSourceAPI) CommitSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceCommit) error {
	copyItems := append([]client.SourceCommit(nil), items...)
	f.commits = append(f.commits, copyItems)
	return f.commitErr
}

func (f *fakeSourceAPI) FailSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceFailure) error {
	copyItems := append([]client.SourceFailure(nil), items...)
	f.failures = append(f.failures, copyItems)
	return nil
}

func (f *fakeSourceAPI) UpdateSourceRunSummary(_ context.Context, _ uint64, _ string, summary sourcepkg.Summary) error {
	f.progress = append(f.progress, summary)
	return nil
}

func (f *fakeSourceAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	f.heartbeatMu.Lock()
	f.heartbeats++
	f.heartbeatMu.Unlock()
	return nil
}

type seededPathAPI struct {
	*fakeSourceAPI
	items []client.SourceItem
}

func (a *seededPathAPI) SourceItems(_ context.Context, _ uint64, _ string, limit, offset int) ([]client.SourceItem, error) {
	if offset >= len(a.items) {
		return nil, nil
	}
	end := offset + limit
	if end > len(a.items) {
		end = len(a.items)
	}
	return append([]client.SourceItem(nil), a.items[offset:end]...), nil
}

func TestScannerKeepsExistingOwnerOfVisibleFilename(t *testing.T) {
	nodeID := uint64(10)
	api := &seededPathAPI{
		fakeSourceAPI: &fakeSourceAPI{},
		items: []client.SourceItem{{
			ExternalID: "yike:123:1",
			NodeID:     &nodeID,
			Path:       "IMG_0001.jpg",
		}},
	}
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{
					// Newer same-name media is intentionally observed first.
					{FSID: 2, Path: "/youa/web/200.jpg", ServerFilename: "IMG_0001.jpg", Size: 20, MTime: 200},
					{FSID: 1, Path: "/youa/web/100.jpg", ServerFilename: "IMG_0001.jpg", Size: 10, MTime: 100},
				},
			},
		},
		albums:     map[string]yike.AlbumList{"": {Page: yike.Page{HasMore: 0}}},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}

	if _, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-stable-name",
	}).Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	observed := map[string]string{}
	for _, batch := range api.observed {
		for _, item := range batch {
			observed[item.ExternalID] = item.Path
		}
	}
	if got := observed["yike:123:1"]; got != "IMG_0001.jpg" {
		t.Fatalf("existing owner path=%q", got)
	}
	if got := observed["yike:123:2"]; got != "IMG_0001 (2).jpg" {
		t.Fatalf("new collision path=%q", got)
	}
}

func TestScannerDeduplicatesRootAndAlbumMemberships(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{
					{FSID: 1, Path: "/1717120121000.png", ServerFilename: "holiday.jpg", Size: 100, MTime: 1000, MD5: "AAAA"},
					{FSID: 2, Path: "/ignored.jpg", ServerFilename: "ignored.jpg", Size: 200, MTime: 2000},
				},
			},
		},
		albums: map[string]yike.AlbumList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.Album{
					{AlbumID: "own", Title: "Own Album"},
					{AlbumID: "shared", Title: "Shared Album"},
				},
			},
		},
		albumFiles: map[string]map[string]yike.AlbumFileList{
			"own": {
				"": {
					Page: yike.Page{HasMore: 0},
					List: []yike.AlbumFile{
						{File: yike.File{FSID: 1, Path: "/holiday.jpg", ServerFilename: "holiday.jpg", Size: 100, MTime: 1000, MD5: "AAAA"}, AlbumID: "own", UK: 123},
						// The same stable media identity was ignored from the root
						// library. A different album path must not re-include it.
						{File: yike.File{FSID: 2, Path: "/visible-in-album.jpg", ServerFilename: "ignored.jpg", Size: 200, MTime: 2000}, AlbumID: "own", UK: 123},
						{File: yike.File{
							FSID: 3, Path: "/camera/1717120123000.jpg", ServerFilename: "album-only.jpg", Size: 300, CTime: 2500, MTime: 3000, ShootTime: 1500,
							MD5: strings.Repeat("a", 32), ThumbURL: []string{"", " https://thumb.example/3 "},
						}, AlbumID: "own", UK: 123},
					},
				},
			},
			"shared": {
				"": {
					Page: yike.Page{HasMore: 0},
					List: []yike.AlbumFile{
						{File: yike.File{FSID: 4, Path: "/shared/1717120124000.jpg", ServerFilename: "shared.jpg", Size: 400, MTime: 4000}, AlbumID: "shared", UK: 999},
						{File: yike.File{FSID: 4, Path: "/shared/1717120124000.jpg", ServerFilename: "shared.jpg", Size: 400, MTime: 4000}, AlbumID: "shared", UK: 999},
					},
				},
			},
		},
	}
	api := &fakeSourceAPI{}
	scanner := Scanner{
		Remote: remote, API: api, SourceID: 7, RunID: "run-7",
		IgnoreRules: "Library/ignored*\n",
		BatchSize:   2,
	}
	result, err := scanner.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.RootItems != 2 || result.Albums != 2 || result.AlbumMemberships != 5 {
		t.Fatalf("unexpected discovery counts: %+v", result)
	}
	if result.DuplicateMemberships != 3 {
		t.Fatalf("duplicate memberships=%d want=3", result.DuplicateMemberships)
	}
	if result.OwnItems != 2 || result.SharedItems != 1 {
		t.Fatalf("own/shared counts: %+v", result)
	}
	if result.Summary.ScannedItems != 4 || result.Summary.IgnoredItems != 1 ||
		result.Summary.NewItems != 3 || result.Summary.PlannedTransferItems != 3 ||
		result.Summary.PlannedTransferBytes != 800 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if len(api.progress) == 0 || api.progress[len(api.progress)-1].ScannedItems != result.Summary.ScannedItems ||
		api.progress[len(api.progress)-1].PlannedTransferBytes != result.Summary.PlannedTransferBytes {
		t.Fatalf("progress snapshots=%+v final=%+v", api.progress, result.Summary)
	}
	if len(api.observed) != 2 {
		t.Fatalf("observation batches=%d want=2", len(api.observed))
	}
	if api.heartbeats != 4 {
		t.Fatalf("heartbeats=%d want=4", api.heartbeats)
	}

	items := map[string]client.SourceObservation{}
	for _, batch := range api.observed {
		for _, item := range batch {
			if _, exists := items[item.ExternalID]; exists {
				t.Fatalf("duplicate observation for %q", item.ExternalID)
			}
			items[item.ExternalID] = item
		}
	}
	if len(items) != 3 {
		t.Fatalf("observed unique items=%d want=3", len(items))
	}
	if got := items["yike:123:1"]; got.Path != "holiday.jpg" || got.RemoteRevision != "md5:aaaa" {
		t.Fatalf("root item=%+v", got)
	}
	if got := items["yike:123:3"]; got.Path != "album-only.jpg" {
		t.Fatalf("own album-only item=%+v", got)
	}
	if got := items["yike:999:4"]; got.Path != "shared.jpg" {
		t.Fatalf("shared item=%+v", got)
	}
	if _, exists := items["yike:123:2"]; exists {
		t.Fatal("ignored root item was sent to source API")
	}

	if len(result.Metadata) != 3 {
		t.Fatalf("metadata snapshots=%d want=3: %+v", len(result.Metadata), result.Metadata)
	}
	metadata := make(map[string]sourcemetadata.Snapshot, len(result.Metadata))
	for i := range result.Metadata {
		metadata[result.Metadata[i].ItemExternalID] = result.Metadata[i]
	}
	albumOnly, ok := metadata["yike:123:3"]
	if !ok {
		t.Fatalf("album-only metadata missing: %+v", result.Metadata)
	}
	if albumOnly.OriginalPath != "/camera/1717120123000.jpg" ||
		albumOnly.OwnerExternalID != "123" ||
		albumOnly.CapturedAt == nil || albumOnly.CapturedAt.Unix() != 1500 ||
		albumOnly.RemoteCreatedAt == nil || albumOnly.RemoteCreatedAt.Unix() != 2500 ||
		albumOnly.ContentMD5 != strings.Repeat("a", 32) ||
		albumOnly.ThumbnailURL != "https://thumb.example/3" ||
		albumOnly.PairGroupID != "" || albumOnly.PairRole != "" {
		t.Fatalf("album-only metadata=%+v", albumOnly)
	}
	if _, exists := metadata["yike:123:2"]; exists {
		t.Fatal("ignored item produced metadata snapshot")
	}

	if len(result.Collections) != 2 {
		t.Fatalf("collections=%d want=2: %+v", len(result.Collections), result.Collections)
	}
	collections := make(map[string]sourcecollection.Snapshot, len(result.Collections))
	for _, collection := range result.Collections {
		collections[collection.ExternalID] = collection
	}
	own := collections["yike:album:own"]
	if own.Name != "Own Album" || len(own.Members) != 2 ||
		own.Members[0].ItemExternalID != "yike:123:1" || own.Members[0].Position != 0 ||
		own.Members[1].ItemExternalID != "yike:123:3" || own.Members[1].Position != 2 {
		t.Fatalf("own collection=%+v", own)
	}
	shared := collections["yike:album:shared"]
	if shared.Name != "Shared Album" || len(shared.Members) != 1 ||
		shared.Members[0].ItemExternalID != "yike:999:4" || shared.Members[0].Position != 0 {
		t.Fatalf("shared collection=%+v", shared)
	}
}

func TestScannerKeepsEmptyAlbumCollection(t *testing.T) {
	remote := &fakeRemote{
		user:  yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{"": {Page: yike.Page{HasMore: 0}}},
		albums: map[string]yike.AlbumList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.Album{{AlbumID: "empty", Title: "Empty Album"}},
			},
		},
		albumFiles: map[string]map[string]yike.AlbumFileList{
			"empty": {"": {Page: yike.Page{HasMore: 0}}},
		},
	}
	result, err := (Scanner{
		Remote: remote, API: &fakeSourceAPI{}, SourceID: 1, RunID: "run-empty",
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Collections) != 1 || result.Collections[0].ExternalID != "yike:album:empty" ||
		result.Collections[0].Name != "Empty Album" || len(result.Collections[0].Members) != 0 {
		t.Fatalf("empty collection=%+v", result.Collections)
	}
}

func TestScannerRejectsAlbumWithoutIdentity(t *testing.T) {
	remote := &fakeRemote{
		user:  yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{"": {Page: yike.Page{HasMore: 0}}},
		albums: map[string]yike.AlbumList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.Album{{AlbumID: " ", Title: "Broken"}},
			},
		},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}
	if _, err := (Scanner{
		Remote: remote, API: &fakeSourceAPI{}, SourceID: 1, RunID: "run-bad-album",
	}).Scan(context.Background()); err == nil {
		t.Fatal("empty album identity was accepted")
	}
}

func TestCollectionNameNormalizesRemoteTitle(t *testing.T) {
	long := strings.Repeat("长", 300) + "\x01"
	name := collectionName(yike.Album{AlbumID: "a", Title: long})
	if len([]byte(name)) > 512 {
		t.Fatalf("collection name bytes=%d", len([]byte(name)))
	}
	for _, r := range name {
		if r < 32 {
			t.Fatalf("collection name retained control rune %q", r)
		}
	}
	if got := collectionName(yike.Album{AlbumID: "fallback", Title: " \x00 "}); got != "Album fallback" {
		t.Fatalf("fallback collection name=%q", got)
	}
}

func TestCanonicalRemotePathPreservesVisibleYikeName(t *testing.T) {
	tests := []struct {
		file yike.File
		want string
	}{
		{yike.File{FSID: 1, Path: "/1717120121000.png", ServerFilename: "IMG_0001.png"}, "IMG_0001.png"},
		{yike.File{FSID: 2, Path: "/youa/web/1717120122000.jpg", ServerFilename: "旅行照片.jpg"}, "旅行照片.jpg"},
		{yike.File{FSID: 3, Path: "/folder/normal.mov"}, "normal.mov"},
		{yike.File{FSID: 4, Path: "/CON.jpg"}, "_CON.jpg"},
		{yike.File{FSID: 5, Path: "/bad<>:\"name?.jpg"}, "bad____name_.jpg"},
		{yike.File{FSID: 6, Filename: "from-filename.jpg"}, "from-filename.jpg"},
		{yike.File{FSID: 7, Name: "from-name.jpg"}, "from-name.jpg"},
		{yike.File{FSID: 8, ServerFilename: "  leading-space.jpg"}, "  leading-space.jpg"},
		{yike.File{FSID: 9, ServerFilename: "trailing-space.jpg   "}, "trailing-space.jpg"},
		{yike.File{FSID: 10}, "file-10"},
	}
	for _, tt := range tests {
		got := canonicalRemotePath(tt.file)
		if got != tt.want {
			t.Fatalf("canonicalRemotePath(%+v)=%q want=%q", tt.file, got, tt.want)
		}
		if strings.Contains(got, "/") {
			t.Fatalf("canonical visible filename leaked an internal directory: %q", got)
		}
		if err := meta.ValidateName(got); err != nil {
			t.Fatalf("canonical filename %q invalid: %v", got, err)
		}
		if strings.Contains(got, "[") || strings.Contains(got, "]") {
			t.Fatalf("canonical filename unexpectedly exposes fsid suffix: %q", got)
		}
	}
}

func TestCanonicalYikeFileNamePreservesExtensionWhenTruncated(t *testing.T) {
	name := strings.Repeat("长", 100) + ".jpg"
	got := canonicalRemotePath(yike.File{FSID: 11, ServerFilename: name})
	if len([]byte(got)) > 255 {
		t.Fatalf("filename bytes=%d", len([]byte(got)))
	}
	if !strings.HasSuffix(got, ".jpg") {
		t.Fatalf("truncated filename lost extension: %q", got)
	}
	if err := meta.ValidateName(got); err != nil {
		t.Fatalf("truncated filename invalid: %v", err)
	}
}

func TestReserveYikePathOnlyAddsSuffixOnRealConflict(t *testing.T) {
	owners := map[string]string{}
	first := reserveYikePath("IMG_0001.JPG", 123, 1, "yike:123:1", owners)
	if first != "IMG_0001.JPG" {
		t.Fatalf("first path=%q", first)
	}
	second := reserveYikePath("img_0001.jpg", 123, 2, "yike:123:2", owners)
	if second != "img_0001 (2).jpg" {
		t.Fatalf("case-insensitive collision path=%q", second)
	}
	third := reserveYikePath("bad_name.jpg", 999, 3, "yike:999:3", owners)
	if third != "bad_name.jpg" {
		t.Fatalf("unrelated path=%q", third)
	}
	fourth := reserveYikePath("bad_name.jpg", 999, 4, "yike:999:4", owners)
	if fourth != "bad_name (4).jpg" {
		t.Fatalf("sanitized collision path=%q", fourth)
	}
}

func TestScannerRejectsInvalidUserIdentity(t *testing.T) {
	scanner := Scanner{
		Remote: &fakeRemote{
			user:       yike.UserInfo{YouaID: "not-a-number"},
			files:      map[string]yike.FileList{},
			albums:     map[string]yike.AlbumList{},
			albumFiles: map[string]map[string]yike.AlbumFileList{},
		},
		API: &fakeSourceAPI{}, SourceID: 1, RunID: "run",
	}
	if _, err := scanner.Scan(context.Background()); err == nil {
		t.Fatal("invalid youa_id was accepted")
	}
}

type fakePlanExecutor struct {
	commits []client.SourceCommit
	failID  string
	failErr error
}

func (f *fakePlanExecutor) Execute(_ context.Context, plan client.SourcePlan, item sourcepkg.DiscoveredItem, _ TransferRef) (client.SourceCommit, error) {
	if item.ExternalID == f.failID {
		if f.failErr != nil {
			return client.SourceCommit{}, f.failErr
		}
		return client.SourceCommit{}, fmt.Errorf("download unavailable")
	}
	commit := client.SourceCommit{
		ExternalID: item.ExternalID, Action: plan.Action, NodeID: 100, NodeRevision: 1,
		Kind: item.Kind, Path: item.Path, Size: item.Size, ModifiedAt: item.ModifiedAt,
		SHA256: strings.Repeat("a", 64), RemoteRevision: item.RemoteRevision,
		Transferred: true, TransferredBytes: item.Size,
	}
	f.commits = append(f.commits, commit)
	return commit, nil
}

func TestScannerSyncExecutesAndCommitsPlans(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{{FSID: 1, Path: "/a.jpg", Size: 10, MTime: 100}},
			},
		},
		albums:     map[string]yike.AlbumList{"": {Page: yike.Page{HasMore: 0}}},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}
	api := &fakeSourceAPI{action: string(sourcepkg.ActionCreate)}
	executor := &fakePlanExecutor{}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-sync",
		Mode: meta.SourceRunModeSync, Executor: executor,
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.NewItems != 1 || result.Summary.FailedItems != 0 {
		t.Fatalf("summary=%+v", result.Summary)
	}
	if len(executor.commits) != 1 || len(api.commits) != 1 || len(api.commits[0]) != 1 {
		t.Fatalf("executor commits=%+v api commits=%+v", executor.commits, api.commits)
	}
	if api.commits[0][0].ExternalID != "yike:123:1" {
		t.Fatalf("commit=%+v", api.commits[0][0])
	}
	if len(remote.queuedFSIDs) != 1 || remote.queuedFSIDs[0] != 1 {
		t.Fatalf("queued dlink fsids=%v want=[1]", remote.queuedFSIDs)
	}
}

func TestScannerSyncCircuitBreaksOnRateLimit(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{
					{FSID: 1, Path: "/first.jpg", Size: 10, MTime: 100},
					{FSID: 2, Path: "/second.jpg", Size: 20, MTime: 200},
					{FSID: 3, Path: "/third.jpg", Size: 30, MTime: 300},
				},
			},
		},
		albums:     map[string]yike.AlbumList{"": {Page: yike.Page{HasMore: 0}}},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}
	api := &fakeSourceAPI{action: string(sourcepkg.ActionCreate)}
	executor := &fakePlanExecutor{
		failID:  "yike:123:1",
		failErr: fmt.Errorf("dlink throttled: %w", yike.ErrRateLimited),
	}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-rate-limit",
		Mode: meta.SourceRunModeSync, Executor: executor,
	}).Scan(context.Background())
	if !errors.Is(err, yike.ErrRateLimited) {
		t.Fatalf("err=%v want ErrRateLimited", err)
	}
	if result.Summary.FailedItems != 1 {
		t.Fatalf("summary=%+v", result.Summary)
	}
	if len(api.failures) != 1 || len(api.failures[0]) != 1 ||
		api.failures[0][0].ExternalID != "yike:123:1" {
		t.Fatalf("failures=%+v", api.failures)
	}
	if len(executor.commits) != 0 {
		t.Fatalf("rate-limit circuit breaker continued transfers: %+v", executor.commits)
	}
	if got := fmt.Sprint(remote.queuedFSIDs); got != "[1 2 3]" {
		t.Fatalf("queued dlink fsids=%s want=[1 2 3]", got)
	}
}

func TestScannerSyncReportsFailedItemAndContinues(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{
					{FSID: 1, Path: "/ok.jpg", Size: 10, MTime: 100},
					{FSID: 2, Path: "/fail.jpg", Size: 20, MTime: 200},
				},
			},
		},
		albums:     map[string]yike.AlbumList{"": {Page: yike.Page{HasMore: 0}}},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}
	api := &fakeSourceAPI{action: string(sourcepkg.ActionCreate)}
	executor := &fakePlanExecutor{failID: "yike:123:2"}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-partial",
		Mode: meta.SourceRunModeSync, Executor: executor,
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.NewItems != 2 || result.Summary.FailedItems != 1 || len(result.Errors) != 1 {
		t.Fatalf("result=%+v", result)
	}
	if len(api.commits) != 1 || len(api.commits[0]) != 1 ||
		api.commits[0][0].ExternalID != "yike:123:1" {
		t.Fatalf("api commits=%+v", api.commits)
	}
	if len(api.failures) != 1 || len(api.failures[0]) != 1 ||
		api.failures[0][0].ExternalID != "yike:123:2" ||
		!strings.Contains(api.failures[0][0].Error, "download unavailable") {
		t.Fatalf("api failures=%+v", api.failures)
	}
}

func TestScannerSyncReportsCommitFailure(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{{FSID: 1, Path: "/fail-commit.jpg", Size: 10, MTime: 100}},
			},
		},
		albums:     map[string]yike.AlbumList{"": {Page: yike.Page{HasMore: 0}}},
		albumFiles: map[string]map[string]yike.AlbumFileList{},
	}
	api := &fakeSourceAPI{
		action:    string(sourcepkg.ActionCreate),
		commitErr: fmt.Errorf("commit unavailable"),
	}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-commit-failure",
		Mode: meta.SourceRunModeSync, Executor: &fakePlanExecutor{},
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.FailedItems != 1 {
		t.Fatalf("summary=%+v", result.Summary)
	}
	if len(api.failures) != 1 || len(api.failures[0]) != 1 ||
		api.failures[0][0].ExternalID != "yike:123:1" ||
		!strings.Contains(api.failures[0][0].Error, "commit unavailable") {
		t.Fatalf("api failures=%+v", api.failures)
	}
}

func TestMetadataMD5OnlyAcceptsCanonicalDigest(t *testing.T) {
	valid := strings.Repeat("AB", 16)
	if got := metadataMD5("  " + valid + "  "); got != strings.ToLower(valid) {
		t.Fatalf("metadataMD5(valid)=%q", got)
	}
	for _, value := range []string{"", "aaaa", strings.Repeat("z", 32), strings.Repeat("a", 31)} {
		if got := metadataMD5(value); got != "" {
			t.Fatalf("metadataMD5(%q)=%q want empty", value, got)
		}
	}
}
