package sourceagent

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type fakeAPI struct {
	source         client.Source
	begin          client.SyncRun
	plans          func([]client.SourceObservation) []client.SourcePlan
	finishInput    *client.FinishSourceRunInput
	observed       [][]client.SourceObservation
	progress       []sourcepkg.Summary
	heartbeatCount int
	heartbeatErr   error
	commits        [][]client.SourceCommit
	commitErr      error
}

func (f *fakeAPI) Source(context.Context, uint64) (client.Source, error) {
	return f.source, nil
}

func (f *fakeAPI) BeginSourceRun(context.Context, uint64, string, string) (client.SyncRun, error) {
	return f.begin, nil
}

func (f *fakeAPI) ObserveSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	copyItems := append([]client.SourceObservation(nil), items...)
	f.observed = append(f.observed, copyItems)
	if f.plans != nil {
		return f.plans(items), nil
	}
	out := make([]client.SourcePlan, 0, len(items))
	for _, item := range items {
		out = append(out, client.SourcePlan{ExternalID: item.ExternalID, Action: "create"})
	}
	return out, nil
}

func (f *fakeAPI) CommitSourceItems(_ context.Context, _ uint64, _ string, items []client.SourceCommit) error {
	copyItems := append([]client.SourceCommit(nil), items...)
	f.commits = append(f.commits, copyItems)
	return f.commitErr
}

func (f *fakeAPI) UpdateSourceRunSummary(_ context.Context, _ uint64, _ string, summary sourcepkg.Summary) error {
	f.progress = append(f.progress, summary)
	return nil
}

func (f *fakeAPI) UpdateSourceRunTransferProgress(context.Context, uint64, string, string, int64, int64) error {
	return nil
}

func (f *fakeAPI) HeartbeatSourceRun(context.Context, uint64, string) error {
	f.heartbeatCount++
	return f.heartbeatErr
}

func (f *fakeAPI) FinishSourceRun(_ context.Context, _ uint64, _ string, input client.FinishSourceRunInput) (client.SyncRun, error) {
	copy := input
	f.finishInput = &copy
	status := input.Status
	if status == meta.SyncRunStatusCompleted && input.Summary.FailedItems > 0 {
		status = meta.SyncRunStatusPartial
	}
	return client.SyncRun{
		ID: "run-1", SourceID: 1, Mode: f.begin.Mode, Status: status,
		ScannedItems: input.Summary.ScannedItems, ScannedBytes: input.Summary.ScannedBytes,
		IgnoredItems: input.Summary.IgnoredItems, IgnoredBytes: input.Summary.IgnoredBytes,
		NewItems: input.Summary.NewItems, NewBytes: input.Summary.NewBytes,
		PlannedTransferItems: input.Summary.PlannedTransferItems,
		PlannedTransferBytes: input.Summary.PlannedTransferBytes,
		FailedItems:          input.Summary.FailedItems,
	}, nil
}

func TestScannerCooperativelyCancelsOnRunRequest(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native source scanning is supported on Linux only")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.jpg"), []byte("a"), 0o600); err != nil {
		t.Fatal(err)
	}
	rootID, err := RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	api := &fakeAPI{
		source:       client.Source{ID: 1, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:        client.SyncRun{ID: "run-1", SourceID: 1, Mode: meta.SourceRunModeScan},
		heartbeatErr: &client.APIError{Status: http.StatusConflict, Msg: "source run cancellation requested"},
	}
	run, err := (Scanner{
		API: api, SourceID: 1, HeartbeatInterval: time.Nanosecond,
		Roots: RootsWithIdentities("", "", root, rootID),
	}).Run(context.Background(), meta.SyncRunTriggerManual)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v want context.Canceled", err)
	}
	if run.Status != meta.SyncRunStatusCancelled {
		t.Fatalf("run status=%q want cancelled", run.Status)
	}
	if api.finishInput == nil || api.finishInput.Summary.FailedItems != 0 || api.finishInput.CompleteInventory {
		t.Fatalf("cancel finish input=%+v", api.finishInput)
	}
}

func TestScannerRejectsSyncModeUntilExecutorExists(t *testing.T) {
	api := &fakeAPI{
		source: client.Source{ID: 1, Kind: SynologyKind, Direction: meta.SourceDirectionPush},
		begin:  client.SyncRun{ID: "run-1", SourceID: 1, Mode: meta.SourceRunModeSync},
	}
	scanner := Scanner{
		API: api, SourceID: 1,
		Roots: []Root{{Key: "shared", Path: "/not-used", Prefix: "Shared"}},
	}
	run, err := scanner.Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err == nil {
		t.Fatal("sync mode unexpectedly succeeded")
	}
	if run.Status != meta.SyncRunStatusFailed {
		t.Fatalf("run status=%q want failed", run.Status)
	}
	if api.finishInput == nil || api.finishInput.CompleteInventory {
		t.Fatalf("unexpected finish input: %+v", api.finishInput)
	}
	if api.finishInput.Summary.FailedItems != 1 {
		t.Fatalf("failed_items=%d want 1", api.finishInput.Summary.FailedItems)
	}
}

func TestScannerRejectsWrongSourceKind(t *testing.T) {
	api := &fakeAPI{source: client.Source{ID: 1, Kind: "yike", Direction: meta.SourceDirectionPull}}
	scanner := Scanner{API: api, SourceID: 1, Roots: []Root{{Key: "shared", Path: "/x", Prefix: "Shared"}}}
	_, err := scanner.Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err == nil {
		t.Fatal("wrong source kind was accepted")
	}
	if api.finishInput != nil {
		t.Fatal("run was started for an incompatible source")
	}
}

func TestScannerRequiresAPI(t *testing.T) {
	_, err := (Scanner{}).Run(context.Background(), meta.SyncRunTriggerScheduled)
	if err == nil {
		t.Fatal("nil API was accepted")
	}
	if !errors.Is(err, context.Canceled) && err.Error() == "" {
		t.Fatal("unexpected empty error")
	}
}
