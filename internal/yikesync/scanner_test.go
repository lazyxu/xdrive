package yikesync

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcemetadata"
	"github.com/lazyxu/xdrive/internal/yike"
)

type fakeRemote struct {
	user       yike.UserInfo
	files      map[string]yike.FileList
	albums     map[string]yike.AlbumList
	albumFiles map[string]map[string]yike.AlbumFileList
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

type fakeSourceAPI struct {
	observed   [][]client.SourceObservation
	commits    [][]client.SourceCommit
	heartbeats int
	action     string
	commitErr  error
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

func (f *fakeSourceAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	f.heartbeats++
	return nil
}

func TestScannerDeduplicatesRootAndAlbumMemberships(t *testing.T) {
	remote := &fakeRemote{
		user: yike.UserInfo{YouaID: "123"},
		files: map[string]yike.FileList{
			"": {
				Page: yike.Page{HasMore: 0},
				List: []yike.File{
					{FSID: 1, Path: "/holiday.jpg", Size: 100, MTime: 1000, MD5: "AAAA"},
					{FSID: 2, Path: "/ignored.jpg", Size: 200, MTime: 2000},
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
						{File: yike.File{FSID: 1, Path: "/holiday.jpg", Size: 100, MTime: 1000, MD5: "AAAA"}, AlbumID: "own", UK: 123},
						// The same stable media identity was ignored from the root
						// library. A different album path must not re-include it.
						{File: yike.File{FSID: 2, Path: "/visible-in-album.jpg", Size: 200, MTime: 2000}, AlbumID: "own", UK: 123},
						{File: yike.File{
							FSID: 3, Path: "/album-only.jpg", Size: 300, CTime: 2500, MTime: 3000,
							MD5: strings.Repeat("a", 32), ThumbURL: []string{"", " https://thumb.example/3 "},
						}, AlbumID: "own", UK: 123},
					},
				},
			},
			"shared": {
				"": {
					Page: yike.Page{HasMore: 0},
					List: []yike.AlbumFile{
						{File: yike.File{FSID: 4, Path: "/shared.jpg", Size: 400, MTime: 4000}, AlbumID: "shared", UK: 999},
						{File: yike.File{FSID: 4, Path: "/shared.jpg", Size: 400, MTime: 4000}, AlbumID: "shared", UK: 999},
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
	if got := items["yike:123:1"]; got.Path != "Library/holiday.jpg [1]" || got.RemoteRevision != "md5:aaaa" {
		t.Fatalf("root item=%+v", got)
	}
	if got := items["yike:123:3"]; got.Path != "Library/album-only.jpg [3]" {
		t.Fatalf("own album-only item=%+v", got)
	}
	if got := items["yike:999:4"]; got.Path != "Shared/999/shared.jpg [4]" {
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
	if albumOnly.OriginalPath != "/album-only.jpg" ||
		albumOnly.OwnerExternalID != "123" ||
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

func TestCanonicalFileNameAlwaysValid(t *testing.T) {
	tests := []struct {
		path string
		fsid int64
	}{
		{"/CON.jpg", 1},
		{"/bad<>:\"name?.jpg", 2},
		{"/trailing. ", 3},
		{"/" + strings.Repeat("长", 200) + ".jpg", 4},
		{"", 5},
	}
	for _, tt := range tests {
		name := canonicalFileName(tt.path, tt.fsid)
		if err := meta.ValidateName(name); err != nil {
			t.Fatalf("canonicalFileName(%q,%d)=%q invalid: %v", tt.path, tt.fsid, name, err)
		}
		if !strings.Contains(name, "["+strconv.FormatInt(tt.fsid, 10)+"]") && !strings.HasPrefix(name, "file-") {
			t.Fatalf("canonical name lacks stable fsid suffix: %q", name)
		}
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
}

func (f *fakePlanExecutor) Execute(_ context.Context, plan client.SourcePlan, item sourcepkg.DiscoveredItem, _ TransferRef) (client.SourceCommit, error) {
	if item.ExternalID == f.failID {
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
}

func TestScannerSyncKeepsFailedItemPendingAndContinues(t *testing.T) {
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
