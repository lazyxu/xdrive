package sourceagent

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/synology"
)

type fakePhotosRemote struct {
	available map[synology.Space]bool
	folders   map[synology.Space][]synology.Folder
	items     map[synology.Space][]synology.Item
}

func (f *fakePhotosRemote) Available(space synology.Space) bool { return f.available[space] }

func (f *fakePhotosRemote) ListFoldersPage(_ context.Context, space synology.Space, offset, limit int) (synology.FolderPage, error) {
	list := f.folders[space]
	if offset >= len(list) {
		return synology.FolderPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	return synology.FolderPage{Offset: offset, Total: len(list), List: append([]synology.Folder(nil), list[offset:end]...)}, nil
}

func (f *fakePhotosRemote) ListItemsPage(_ context.Context, space synology.Space, offset, limit int) (synology.ItemPage, error) {
	list := f.items[space]
	if offset >= len(list) {
		return synology.ItemPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	return synology.ItemPage{Offset: offset, Total: len(list), List: append([]synology.Item(nil), list[offset:end]...)}, nil
}

func TestBuildPhotosIdentityIndexMapsProviderPathToConfiguredRoot(t *testing.T) {
	root := Root{Key: "shared", Path: "/volume1/photo", Prefix: "Shared"}
	remote := &fakePhotosRemote{
		available: map[synology.Space]bool{synology.SpaceShared: true},
		folders: map[synology.Space][]synology.Folder{
			synology.SpaceShared: {{ID: 10, Name: "Trips"}, {ID: 11, Name: "Paris", Parent: 10}},
		},
		items: map[synology.Space][]synology.Item{
			synology.SpaceShared: {{ID: 99, FolderID: 11, Filename: "IMG.JPG", Filesize: 12}},
		},
	}
	index, warnings, err := buildPhotosIdentityIndex(context.Background(), remote, []Root{root}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings=%v", warnings)
	}
	record, ok := index[filepath.Join(string(filepath.Separator)+"volume1", "photo", "Trips", "Paris", "IMG.JPG")]
	if !ok {
		t.Fatalf("index=%+v", index)
	}
	if record.ExternalID != "synology:shared:99" || record.Size != 12 {
		t.Fatalf("record=%+v", record)
	}
}

func TestBuildPhotosIdentityIndexDropsConflictingSpace(t *testing.T) {
	root := Root{Key: "shared", Path: "/volume1/photo", Prefix: "Shared"}
	remote := &fakePhotosRemote{
		available: map[synology.Space]bool{synology.SpaceShared: true},
		items: map[synology.Space][]synology.Item{
			synology.SpaceShared: {
				{ID: 1, Filename: "same.jpg", Filesize: 1},
				{ID: 2, Filename: "same.jpg", Filesize: 1},
			},
		},
	}
	index, warnings, err := buildPhotosIdentityIndex(context.Background(), remote, []Root{root}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != 0 || len(warnings) != 1 {
		t.Fatalf("index=%+v warnings=%v", index, warnings)
	}
}
