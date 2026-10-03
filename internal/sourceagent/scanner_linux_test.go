//go:build linux

package sourceagent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
)

func TestScannerWalksPersonalAndSharedWithIgnore(t *testing.T) {
	personal := t.TempDir()
	shared := t.TempDir()
	if err := os.WriteFile(filepath.Join(personal, "a.jpg"), []byte("1234567890"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(personal, "@eaDir"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(personal, "@eaDir", "thumb.jpg"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(shared, "Trip"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shared, "Trip", "video.mp4"), []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}

	api := &fakeAPI{
		source: client.Source{ID: 7, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin: client.SyncRun{
			ID: "run-7", SourceID: 7, Mode: meta.SourceRunModeScan,
			IgnoreRules: "@eaDir/\n",
		},
	}
	personalID, err := RootIdentity("personal", personal)
	if err != nil {
		t.Fatal(err)
	}
	sharedID, err := RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	scanner := Scanner{
		API: api, SourceID: 7, BatchSize: 2,
		HeartbeatInterval: time.Nanosecond,
		Roots:             RootsWithIdentities(personal, personalID, shared, sharedID),
	}
	run, err := scanner.Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != meta.SyncRunStatusCompleted {
		t.Fatalf("run status=%q want completed", run.Status)
	}
	if api.finishInput == nil || !api.finishInput.CompleteInventory {
		t.Fatalf("finish did not declare complete inventory: %+v", api.finishInput)
	}
	summary := api.finishInput.Summary
	if summary.ScannedItems != 7 || summary.IgnoredItems != 2 {
		t.Fatalf("unexpected scan summary: %+v", summary)
	}
	if summary.NewItems != 5 {
		t.Fatalf("new_items=%d want 5: %+v", summary.NewItems, summary)
	}
	if summary.PlannedTransferItems != 2 || summary.PlannedTransferBytes != 15 {
		t.Fatalf("unexpected planned transfer: %+v", summary)
	}
	if len(api.observed) != 3 {
		t.Fatalf("observation batches=%d want 3", len(api.observed))
	}
	if len(api.progress) == 0 ||
		api.progress[len(api.progress)-1].ScannedItems != summary.ScannedItems ||
		api.progress[len(api.progress)-1].PlannedTransferBytes != summary.PlannedTransferBytes {
		t.Fatalf("live progress=%+v final=%+v", api.progress, summary)
	}
	if api.heartbeatCount == 0 {
		t.Fatal("long-scan heartbeat was not exercised")
	}

	var all []client.SourceObservation
	for _, batch := range api.observed {
		all = append(all, batch...)
	}
	paths := map[string]client.SourceObservation{}
	for _, item := range all {
		paths[item.Path] = item
		if strings.Contains(item.Path, "@eaDir") {
			t.Fatalf("ignored item was sent to server: %+v", item)
		}
	}
	for _, want := range []string{"Personal", "Personal/a.jpg", "Shared", "Shared/Trip", "Shared/Trip/video.mp4"} {
		if _, ok := paths[want]; !ok {
			t.Fatalf("missing observed path %q: %+v", want, paths)
		}
	}
	if got := paths["Personal"].ExternalID; got != "root:personal" {
		t.Fatalf("personal root id=%q", got)
	}
	if got := paths["Shared"].ExternalID; got != "root:shared" {
		t.Fatalf("shared root id=%q", got)
	}
	if got := paths["Personal/a.jpg"].ExternalID; !strings.HasPrefix(got, "fs:personal:") {
		t.Fatalf("personal file identity=%q", got)
	}
	if got := paths["Shared/Trip/video.mp4"].ExternalID; !strings.HasPrefix(got, "fs:shared:") {
		t.Fatalf("shared file identity=%q", got)
	}
}

func TestScannerRejectsChangedRootIdentity(t *testing.T) {
	root := t.TempDir()
	api := &fakeAPI{
		source: client.Source{ID: 8, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:  client.SyncRun{ID: "run-8", SourceID: 8, Mode: meta.SourceRunModeScan},
	}
	scanner := Scanner{
		API: api, SourceID: 8,
		Roots: []Root{{Key: "shared", Path: root, Prefix: "Shared", ExpectedID: "fs:shared:999:999"}},
	}
	run, err := scanner.Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err == nil {
		t.Fatal("changed root identity unexpectedly succeeded")
	}
	if run.Status != meta.SyncRunStatusFailed {
		t.Fatalf("run status=%q want failed", run.Status)
	}
	if api.finishInput == nil || api.finishInput.CompleteInventory {
		t.Fatalf("root identity failure declared complete inventory: %+v", api.finishInput)
	}
}

func TestRootIdentityRejectsSymlinkRoot(t *testing.T) {
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "photos")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := RootIdentity("shared", link); err == nil {
		t.Fatal("symlink root was accepted")
	}
}

func TestScannerSyncExecutesAndCommits(t *testing.T) {
	shared := t.TempDir()
	local := filepath.Join(shared, "photo.jpg")
	if err := os.WriteFile(local, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	sharedID, err := RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	targetID := uint64(100)
	protocol := &fakeAPI{
		source: client.Source{ID: 9, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin: client.SyncRun{
			ID: "run-9", SourceID: 9, Mode: meta.SourceRunModeSync, TargetNodeID: &targetID,
		},
	}
	execution := newFakeExecutionAPI()
	execution.upload = client.UploadResult{
		Node:             client.Node{ID: 200, Type: meta.NodeTypeFile, Revision: 1},
		SHA256:           "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TransferredBytes: 3,
	}
	scanner := Scanner{
		API: protocol, ExecutionAPI: execution, SourceID: 9,
		Roots: RootsWithIdentities("", "", shared, sharedID),
	}
	run, err := scanner.Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != meta.SyncRunStatusCompleted {
		t.Fatalf("run status=%q", run.Status)
	}
	if execution.createDirs != 1 || execution.uploads != 1 {
		t.Fatalf("createDirs=%d uploads=%d", execution.createDirs, execution.uploads)
	}
	if len(protocol.commits) != 1 || len(protocol.commits[0]) != 2 {
		t.Fatalf("commits=%+v", protocol.commits)
	}
	var fileCommit *client.SourceCommit
	for i := range protocol.commits[0] {
		if protocol.commits[0][i].Kind == meta.SourceItemKindFile {
			fileCommit = &protocol.commits[0][i]
			break
		}
	}
	if fileCommit == nil || !fileCommit.Transferred || fileCommit.TransferredBytes != 3 {
		t.Fatalf("file commit=%+v", fileCommit)
	}
}

func TestScannerPromotesFilesystemIdentityToPhotosItem(t *testing.T) {
	shared := t.TempDir()
	local := filepath.Join(shared, "photo.jpg")
	if err := os.WriteFile(local, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	sharedID, err := RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(local)
	if err != nil {
		t.Fatal(err)
	}
	filesystemID, err := filesystemIdentity("shared", local, info)
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{
		source:      client.Source{ID: 10, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:       client.SyncRun{ID: "run-10", SourceID: 10, Mode: meta.SourceRunModeScan},
		sourceItems: []client.SourceItem{{ExternalID: filesystemID.LegacyExternalID, Path: "Shared/photo.jpg"}},
	}
	photos := &fakePhotosRemote{
		available: map[synology.Space]bool{synology.SpaceShared: true},
		items: map[synology.Space][]synology.Item{
			synology.SpaceShared: {{ID: 80716, Filename: "photo.jpg", Filesize: 3}},
		},
	}
	_, err = (Scanner{API: api, SourceID: 10, Photos: photos, Roots: RootsWithIdentities("", "", shared, sharedID)}).
		Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	var file client.SourceObservation
	for _, batch := range api.observed {
		for _, item := range batch {
			if item.Path == "Shared/photo.jpg" {
				file = item
			}
		}
	}
	if file.ExternalID != "synology:shared:80716" || !file.PromoteExternalID ||
		len(file.ExternalIDAliases) != 1 || file.ExternalIDAliases[0] != filesystemID.LegacyExternalID {
		t.Fatalf("observation=%+v", file)
	}
}

func TestScannerUsesPhotosIDForNewFileWithoutPromotion(t *testing.T) {
	shared := t.TempDir()
	if err := os.WriteFile(filepath.Join(shared, "new.jpg"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	sharedID, err := RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{
		source: client.Source{ID: 11, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:  client.SyncRun{ID: "run-11", SourceID: 11, Mode: meta.SourceRunModeScan},
	}
	photos := &fakePhotosRemote{
		available: map[synology.Space]bool{synology.SpaceShared: true},
		items: map[synology.Space][]synology.Item{
			synology.SpaceShared: {{ID: 9001, Filename: "new.jpg", Filesize: 3}},
		},
	}
	_, err = (Scanner{API: api, SourceID: 11, Photos: photos, Roots: RootsWithIdentities("", "", shared, sharedID)}).
		Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	for _, batch := range api.observed {
		for _, item := range batch {
			if item.Path == "Shared/new.jpg" {
				if item.ExternalID != "synology:shared:9001" || item.PromoteExternalID ||
					len(item.ExternalIDAliases) != 1 || !strings.HasPrefix(item.ExternalIDAliases[0], "fs:shared:") {
					t.Fatalf("observation=%+v", item)
				}
				return
			}
		}
	}
	t.Fatal("new file observation not found")
}

func TestScannerFallsBackToFilesystemIdentityWhenPhotosSizeDoesNotMatch(t *testing.T) {
	shared := t.TempDir()
	if err := os.WriteFile(filepath.Join(shared, "photo.jpg"), []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	sharedID, err := RootIdentity("shared", shared)
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{
		source: client.Source{ID: 12, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:  client.SyncRun{ID: "run-12", SourceID: 12, Mode: meta.SourceRunModeScan},
	}
	photos := &fakePhotosRemote{
		available: map[synology.Space]bool{synology.SpaceShared: true},
		items: map[synology.Space][]synology.Item{
			synology.SpaceShared: {{ID: 1, Filename: "photo.jpg", Filesize: 999}},
		},
	}
	_, err = (Scanner{API: api, SourceID: 12, Photos: photos, Roots: RootsWithIdentities("", "", shared, sharedID)}).
		Run(context.Background(), meta.SyncRunTriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	for _, batch := range api.observed {
		for _, item := range batch {
			if item.Path == "Shared/photo.jpg" {
				if !strings.HasPrefix(item.ExternalID, "fs:shared:") || len(item.ExternalIDAliases) != 0 {
					t.Fatalf("observation=%+v", item)
				}
				return
			}
		}
	}
	t.Fatal("fallback file observation not found")
}
