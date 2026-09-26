package yikesync

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
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
	heartbeats int
	action     string
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
						{File: yike.File{FSID: 3, Path: "/album-only.jpg", Size: 300, MTime: 3000}, AlbumID: "own", UK: 123},
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
	if result.RootItems != 2 || result.Albums != 2 || result.AlbumMemberships != 4 {
		t.Fatalf("unexpected discovery counts: %+v", result)
	}
	if result.DuplicateMemberships != 2 {
		t.Fatalf("duplicate memberships=%d want=2", result.DuplicateMemberships)
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
