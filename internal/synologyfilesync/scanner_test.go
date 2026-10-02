package synologyfilesync

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/synology"
)

type fakeFileStationRemote struct {
	folders map[string][]synology.FileStationEntry
}

func (f *fakeFileStationRemote) ListFolderPage(_ context.Context, folder string, offset, limit int) (synology.FileStationPage, error) {
	items := f.folders[folder]
	if offset >= len(items) {
		return synology.FileStationPage{Offset: offset, Total: len(items)}, nil
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return synology.FileStationPage{
		Offset:  offset,
		Total:   len(items),
		Entries: append([]synology.FileStationEntry(nil), items[offset:end]...),
	}, nil
}

type fakeFileStationAPI struct {
	observed []client.SourceObservation
}

func (a *fakeFileStationAPI) ObserveSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	a.observed = append(a.observed, items...)
	out := make([]client.SourcePlan, 0, len(items))
	for _, item := range items {
		out = append(out, client.SourcePlan{ExternalID: item.ExternalID, Action: string(sourcepkg.ActionCreate)})
	}
	return out, nil
}

func (a *fakeFileStationAPI) CommitSourceItems(context.Context, uint64, string, []client.SourceCommit) error {
	return nil
}

func (a *fakeFileStationAPI) FailSourceItems(context.Context, uint64, string, []client.SourceFailure) error {
	return nil
}

func (a *fakeFileStationAPI) UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error {
	return nil
}

func (a *fakeFileStationAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	return nil
}

func TestScannerTreatsArbitraryFilesAndEmptyDirectoriesAsNormalSourceItems(t *testing.T) {
	modified := int64(1_700_000_000)
	remote := &fakeFileStationRemote{folders: map[string][]synology.FileStationEntry{
		"/documents": {
			{Name: "Empty", Path: "/documents/Empty", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
			{Name: "Reports", Path: "/documents/Reports", IsDir: true, Additional: synology.FileStationAdditional{Time: synology.FileStationTime{MTime: modified}}},
			{Name: "notes.txt", Path: "/documents/notes.txt", Additional: synology.FileStationAdditional{Size: 4, Time: synology.FileStationTime{MTime: modified}, Type: "txt"}},
			{Name: "archive.zip", Path: "/documents/archive.zip", Additional: synology.FileStationAdditional{Size: 8, Time: synology.FileStationTime{MTime: modified}, Type: "zip"}},
		},
		"/documents/Empty": {},
		"/documents/Reports": {
			{Name: "report.pdf", Path: "/documents/Reports/report.pdf", Additional: synology.FileStationAdditional{Size: 16, Time: synology.FileStationTime{MTime: modified}, Type: "pdf"}},
		},
	}}
	api := &fakeFileStationAPI{}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-1",
		Mode: meta.SourceRunModeScan, Roots: []string{"/documents"},
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Files != 3 || result.Directories != 3 {
		t.Fatalf("files=%d dirs=%d", result.Files, result.Directories)
	}
	if result.Summary.ScannedItems != 6 || result.Summary.NewItems != 6 ||
		result.Summary.PlannedTransferItems != 3 || result.Summary.PlannedTransferBytes != 28 {
		t.Fatalf("summary=%+v", result.Summary)
	}

	got := make(map[string]client.SourceObservation, len(api.observed))
	for _, item := range api.observed {
		got[item.Path] = item
	}
	for _, want := range []struct {
		path string
		kind string
		size int64
	}{
		{"documents", meta.SourceItemKindDirectory, 0},
		{"documents/Empty", meta.SourceItemKindDirectory, 0},
		{"documents/Reports", meta.SourceItemKindDirectory, 0},
		{"documents/notes.txt", meta.SourceItemKindFile, 4},
		{"documents/archive.zip", meta.SourceItemKindFile, 8},
		{"documents/Reports/report.pdf", meta.SourceItemKindFile, 16},
	} {
		item, ok := got[want.path]
		if !ok {
			t.Fatalf("missing observation %q: %+v", want.path, api.observed)
		}
		if item.Kind != want.kind || item.Size != want.size {
			t.Fatalf("observation %q=%+v", want.path, item)
		}
	}
}

func TestScannerPathIdentityDoesNotGuessRename(t *testing.T) {
	oldID := fileStationExternalID("/documents/old.txt")
	newID := fileStationExternalID("/documents/new.txt")
	if oldID == newID {
		t.Fatalf("path identity did not change across rename: %q", oldID)
	}
	if len(oldID) > 512 || len(newID) > 512 {
		t.Fatalf("external id too long")
	}
}

func TestScannerPreservesLeadingSpacesAndSanitizesUnrepresentableNames(t *testing.T) {
	if got := sanitizeSegment("  notes.txt", "/documents/  notes.txt"); got != "  notes.txt" {
		t.Fatalf("leading spaces were lost: %q", got)
	}
	got := sanitizeSegment("bad:name?.txt", "/documents/bad:name?.txt")
	if got != "bad_name_.txt" {
		t.Fatalf("sanitized name=%q", got)
	}
}

func TestScannerIgnoresDirectorySubtree(t *testing.T) {
	remote := &fakeFileStationRemote{folders: map[string][]synology.FileStationEntry{
		"/documents": {
			{Name: "cache", Path: "/documents/cache", IsDir: true},
			{Name: "keep.txt", Path: "/documents/keep.txt", Additional: synology.FileStationAdditional{Size: 1}},
		},
		"/documents/cache": {
			{Name: "secret.bin", Path: "/documents/cache/secret.bin", Additional: synology.FileStationAdditional{Size: 99}},
		},
	}}
	api := &fakeFileStationAPI{}
	result, err := (Scanner{
		Remote: remote, API: api, SourceID: 1, RunID: "run-2",
		Mode: meta.SourceRunModeScan, Roots: []string{"/documents"},
		IgnoreRules: "cache/",
	}).Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Files != 1 || result.Summary.IgnoredItems != 1 {
		t.Fatalf("result=%+v", result)
	}
	for _, item := range api.observed {
		if item.Path == "documents/cache/secret.bin" {
			t.Fatal("ignored directory subtree was traversed")
		}
	}
}

func TestDiscoveredItemUsesMTimeWithoutMediaSemantics(t *testing.T) {
	entry := synology.FileStationEntry{
		Name: "data.db", Path: "/documents/data.db",
		Additional: synology.FileStationAdditional{
			Size: 42, Time: synology.FileStationTime{MTime: 1_700_000_000}, Type: "db",
		},
	}
	item := discoveredItem(entry.Path, "documents/data.db", entry, nil)
	if item.Kind != meta.SourceItemKindFile || item.Size != 42 || item.ModifiedAt == nil {
		t.Fatalf("item=%+v", item)
	}
	if !item.ModifiedAt.Equal(time.Unix(1_700_000_000, 0).UTC()) {
		t.Fatalf("mtime=%v", item.ModifiedAt)
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

type duplicateFileStationRemote struct{}

func (r *duplicateFileStationRemote) ListFolderPage(_ context.Context, folder string, offset, _ int) (synology.FileStationPage, error) {
	if folder != "/documents" {
		return synology.FileStationPage{Offset: offset, Total: 0}, nil
	}
	return synology.FileStationPage{
		Offset: offset,
		Total:  2,
		Entries: []synology.FileStationEntry{{
			Name: "same.txt", Path: "/documents/same.txt",
			Additional: synology.FileStationAdditional{Size: 1},
		}},
	}, nil
}

func TestScannerRejectsDuplicateRemotePathAcrossPages(t *testing.T) {
	_, err := (Scanner{
		Remote: &duplicateFileStationRemote{}, API: &fakeFileStationAPI{},
		SourceID: 1, RunID: "run-duplicate", Mode: meta.SourceRunModeScan,
		Roots: []string{"/documents"},
	}).Scan(context.Background())
	if err == nil || !strings.Contains(err.Error(), "path repeated") {
		t.Fatalf("duplicate path err=%v", err)
	}
}

func TestFileStationRemoteRevisionUsesChangeTimesForNewFiles(t *testing.T) {
	entry := synology.FileStationEntry{
		Path: "/documents/a.bin",
		Additional: synology.FileStationAdditional{
			Size: 10,
			Time: synology.FileStationTime{MTime: 100, CTime: 110, CRTime: 90},
		},
	}
	got := fileStationRemoteRevision(entry, nil)
	want := "v2:mtime:100:ctime:110:crtime:90:size:10"
	if got != want {
		t.Fatalf("revision=%q want=%q", got, want)
	}
}

func TestFileStationRemoteRevisionKeepsUnchangedLegacyItem(t *testing.T) {
	entry := synology.FileStationEntry{
		Path: "/documents/a.bin",
		Additional: synology.FileStationAdditional{
			Size: 10,
			Time: synology.FileStationTime{MTime: 100, CTime: 110, CRTime: 90},
		},
	}
	current := &client.SourceItem{
		ExternalID:     fileStationExternalID(entry.Path),
		RemoteRevision: "mtime:100:size:10:dir:false",
	}
	if got := fileStationRemoteRevision(entry, current); got != current.RemoteRevision {
		t.Fatalf("unchanged legacy revision=%q want=%q", got, current.RemoteRevision)
	}
}

func TestFileStationRemoteRevisionMigratesLegacyItemWhenItChanges(t *testing.T) {
	entry := synology.FileStationEntry{
		Path: "/documents/a.bin",
		Additional: synology.FileStationAdditional{
			Size: 10,
			Time: synology.FileStationTime{MTime: 101, CTime: 111, CRTime: 90},
		},
	}
	current := &client.SourceItem{
		ExternalID:     fileStationExternalID(entry.Path),
		RemoteRevision: "mtime:100:size:10:dir:false",
	}
	got := fileStationRemoteRevision(entry, current)
	want := "v2:mtime:101:ctime:111:crtime:90:size:10"
	if got != want {
		t.Fatalf("changed legacy revision=%q want=%q", got, want)
	}
}

func TestFileStationRemoteRevisionFallsBackWhenChangeTimesUnavailable(t *testing.T) {
	entry := synology.FileStationEntry{
		Path: "/documents/a.bin",
		Additional: synology.FileStationAdditional{
			Size: 10,
			Time: synology.FileStationTime{MTime: 100},
		},
	}
	if got := fileStationRemoteRevision(entry, nil); got != "mtime:100:size:10:dir:false" {
		t.Fatalf("fallback revision=%q", got)
	}
}
