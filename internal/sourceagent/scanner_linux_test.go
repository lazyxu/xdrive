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
