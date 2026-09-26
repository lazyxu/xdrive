package source

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPlannerActions(t *testing.T) {
	base := time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC)
	nodeID := uint64(7)
	current := meta.SourceItem{
		ExternalID: "asset-1",
		NodeID:     &nodeID,
		Kind:       meta.SourceItemKindFile,
		Path:       "DCIM/a.jpg",
		Size:       100,
		ModifiedAt: &base,
		State:      meta.SourceItemStateSynced,
	}

	item := DiscoveredItem{
		ExternalID: "asset-1",
		Kind:       meta.SourceItemKindFile,
		Path:       "DCIM/a.jpg",
		Size:       100,
		ModifiedAt: &base,
	}
	assertAction(t, &current, item, nil, ActionUnchanged)

	moved := item
	moved.Path = "Family/a.jpg"
	assertAction(t, &current, moved, nil, ActionMove)

	changed := item
	changed.Size = 101
	assertAction(t, &current, changed, nil, ActionUpdate)

	movedChanged := changed
	movedChanged.Path = "Family/a.jpg"
	assertAction(t, &current, movedChanged, nil, ActionMoveUpdate)

	assertAction(t, nil, item, nil, ActionCreate)

	detached := current
	detached.NodeID = nil
	assertAction(t, &detached, item, nil, ActionCreate)
}

func TestPlannerUsesStrongIdentityWhenAvailable(t *testing.T) {
	base := time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC)
	later := base.Add(time.Hour)
	nodeID := uint64(9)
	current := meta.SourceItem{
		ExternalID: "asset-2", NodeID: &nodeID,
		Kind: meta.SourceItemKindFile, Path: "a.jpg", Size: 100,
		ModifiedAt: &base,
		SHA256:     "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	next := DiscoveredItem{
		ExternalID: "asset-2", Kind: meta.SourceItemKindFile,
		Path: "a.jpg", Size: 100, ModifiedAt: &later,
		SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	assertAction(t, &current, next, nil, ActionUnchanged)

	next.SHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	assertAction(t, &current, next, nil, ActionUpdate)
}

func TestPlannerIgnoreAndSummary(t *testing.T) {
	matcher, err := CompileIgnoreRules("@eaDir/\n*.tmp\n")
	if err != nil {
		t.Fatal(err)
	}
	items := []DiscoveredItem{
		{ExternalID: "1", Kind: meta.SourceItemKindFile, Path: "a.jpg", Size: 10},
		{ExternalID: "2", Kind: meta.SourceItemKindFile, Path: "cache.tmp", Size: 20},
		{ExternalID: "3", Kind: meta.SourceItemKindFile, Path: "@eaDir/thumb.jpg", Size: 30},
	}
	var summary Summary
	for _, item := range items {
		plan, err := Plan(nil, item, matcher)
		if err != nil {
			t.Fatal(err)
		}
		summary.Add(plan)
	}
	summary.AddMissing(meta.SourceItem{Size: 40})
	summary.AddFailure()

	if summary.ScannedItems != 3 || summary.ScannedBytes != 60 {
		t.Fatalf("unexpected scan totals: %+v", summary)
	}
	if summary.IgnoredItems != 2 || summary.IgnoredBytes != 50 {
		t.Fatalf("unexpected ignored totals: %+v", summary)
	}
	if summary.NewItems != 1 || summary.NewBytes != 10 ||
		summary.PlannedTransferItems != 1 || summary.PlannedTransferBytes != 10 {
		t.Fatalf("unexpected new/transfer totals: %+v", summary)
	}
	if summary.MissingItems != 1 || summary.MissingBytes != 40 || summary.FailedItems != 1 {
		t.Fatalf("unexpected missing/failure totals: %+v", summary)
	}

	run := meta.SyncRun{}
	summary.ApplyToSyncRun(&run)
	if run.ScannedItems != 3 || run.IgnoredItems != 2 || run.NewItems != 1 ||
		run.PlannedTransferBytes != 10 || run.MissingBytes != 40 || run.SkippedItems != 2 {
		t.Fatalf("sync run summary mismatch: %+v", run)
	}
}

func assertAction(t *testing.T, current *meta.SourceItem, item DiscoveredItem, matcher *IgnoreMatcher, want PlanAction) {
	t.Helper()
	got, err := Plan(current, item, matcher)
	if err != nil {
		t.Fatal(err)
	}
	if got.Action != want {
		t.Fatalf("action=%q want=%q result=%+v", got.Action, want, got)
	}
}
