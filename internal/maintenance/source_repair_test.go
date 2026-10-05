package maintenance

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPlanSourceRepairGroupsOnlySafeBindingIssues(t *testing.T) {
	report := SourceVerifyReport{Issues: []SourceBindingIssue{
		{
			SourceID: 1, SourceItemID: 10, ExternalID: "remote:10",
			NodeID: 100, Reason: "node_owner_mismatch",
		},
		{
			SourceID: 1, SourceItemID: 10, ExternalID: "remote:10",
			NodeID: 100, Reason: "node_type_mismatch",
		},
		{
			SourceID: 1, SourceItemID: 11, ExternalID: "remote:11",
			NodeID: 101, Reason: "file_size_mismatch",
		},
		{
			SourceID: 1, Reason: "active_target_missing",
		},
	}}

	actions, skipped := planSourceRepair(report)
	if len(actions) != 1 {
		t.Fatalf("actions=%+v", actions)
	}
	action := actions[0]
	if action.SourceID != 1 || action.SourceItemID != 10 ||
		action.ExternalID != "remote:10" || action.PreviousNodeID != 100 {
		t.Fatalf("action=%+v", action)
	}
	if len(action.Reasons) != 2 ||
		action.Reasons[0] != "node_owner_mismatch" ||
		action.Reasons[1] != "node_type_mismatch" {
		t.Fatalf("action reasons=%+v", action.Reasons)
	}
	if len(skipped) != 2 ||
		skipped[0].Reason != "active_target_missing" ||
		skipped[1].Reason != "file_size_mismatch" {
		t.Fatalf("skipped=%+v", skipped)
	}
}

func TestRepairSourcesDetachesInvalidBindingsIdempotently(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_repair_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
		&meta.SourceItemAlias{}, &meta.SourceCollection{},
		&meta.SourceCollectionItem{}, &meta.SourceItemMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username: "source-repair-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{
		Name: "sync", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	wrongType := meta.Node{
		ParentID: &target.ID, Name: "wrong", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 7,
	}
	if err := db.Create(&wrongType).Error; err != nil {
		t.Fatal(err)
	}

	source := meta.Source{
		OwnerID: user.ID, Name: "repair-test", Kind: "test",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	lastSynced := now.Add(-time.Hour)
	items := []meta.SourceItem{
		{
			SourceID: source.ID, ExternalID: "remote:no-node",
			Kind: meta.SourceItemKindFile, Path: "missing.bin", Size: 11,
			RemoteRevision: "rev-1", State: meta.SourceItemStateSynced,
			LastSeenAt: now, LastSyncedRunID: "historical-run",
			LastSyncedAt: &lastSynced,
		},
		{
			SourceID: source.ID, ExternalID: "remote:wrong-type",
			NodeID: &wrongType.ID, NodeRevision: wrongType.Revision,
			Kind: meta.SourceItemKindFile, Path: "wrong", Size: 12,
			RemoteRevision: "rev-2", State: meta.SourceItemStateSynced,
			LastSeenAt: now, LastSyncedRunID: "historical-run-2",
			LastSyncedAt: &lastSynced,
		},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	staleAt := now.Add(-sourcepkg.SyncRunStaleAfter - time.Minute)
	cancelRequestedAt := staleAt.Add(time.Minute)
	runs := []meta.SyncRun{
		{
			ID:       "00000000-0000-0000-0000-000000000101",
			SourceID: source.ID, RunNumber: 1, SourceRevision: source.Revision,
			Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerScheduled,
			Status: meta.SyncRunStatusRunning, StartedAt: staleAt,
			ActiveTransferPath: "stale.bin", ActiveTransferBytes: 10, ActiveTransferTotal: 100,
			CreatedAt: staleAt, UpdatedAt: staleAt,
		},
		{
			ID:       "00000000-0000-0000-0000-000000000102",
			SourceID: source.ID, RunNumber: 2, SourceRevision: source.Revision,
			Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
			Status: meta.SyncRunStatusRunning, StartedAt: staleAt,
			CancelRequestedAt:  &cancelRequestedAt,
			ActiveTransferPath: "cancel.bin", ActiveTransferBytes: 20, ActiveTransferTotal: 200,
			CreatedAt: staleAt, UpdatedAt: staleAt,
		},
	}
	if err := db.Create(&runs).Error; err != nil {
		t.Fatal(err)
	}

	baseline := make(map[uint64]meta.SourceItem, len(items))
	for _, item := range items {
		var persisted meta.SourceItem
		if err := db.First(&persisted, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		baseline[item.ID] = persisted
	}

	dry, err := RepairSources(context.Background(), db, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Actions) != 2 || len(dry.RunActions) != 2 {
		t.Fatalf("dry actions=%+v run_actions=%+v", dry.Actions, dry.RunActions)
	}
	if dry.RunActions[0].RunID != runs[0].ID ||
		dry.RunActions[0].TargetStatus != meta.SyncRunStatusFailed ||
		dry.RunActions[1].RunID != runs[1].ID ||
		dry.RunActions[1].TargetStatus != meta.SyncRunStatusCancelled {
		t.Fatalf("dry run actions=%+v", dry.RunActions)
	}
	for _, action := range dry.Actions {
		if action.Applied {
			t.Fatalf("dry-run action applied: %+v", action)
		}
	}
	for _, action := range dry.RunActions {
		if action.Applied {
			t.Fatalf("dry-run run action applied: %+v", action)
		}
	}
	var dryRuns []meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).Order("run_number ASC").Find(&dryRuns).Error; err != nil {
		t.Fatal(err)
	}
	if len(dryRuns) != 2 ||
		dryRuns[0].Status != meta.SyncRunStatusRunning ||
		dryRuns[1].Status != meta.SyncRunStatusRunning {
		t.Fatalf("dry run mutated source runs: %+v", dryRuns)
	}
	var dryWrong meta.SourceItem
	if err := db.First(&dryWrong, items[1].ID).Error; err != nil {
		t.Fatal(err)
	}
	if dryWrong.NodeID == nil || *dryWrong.NodeID != wrongType.ID ||
		dryWrong.State != meta.SourceItemStateSynced {
		t.Fatalf("dry run mutated source item: %+v", dryWrong)
	}

	applied, err := RepairSources(context.Background(), db, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied.Actions) != 2 || len(applied.RunActions) != 2 {
		t.Fatalf("applied actions=%+v run_actions=%+v", applied.Actions, applied.RunActions)
	}
	for _, action := range applied.Actions {
		if !action.Applied {
			t.Fatalf("action not applied: %+v", action)
		}
	}
	for _, action := range applied.RunActions {
		if !action.Applied {
			t.Fatalf("run action not applied: %+v", action)
		}
	}
	var repairedRuns []meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).Order("run_number ASC").Find(&repairedRuns).Error; err != nil {
		t.Fatal(err)
	}
	if len(repairedRuns) != 2 ||
		repairedRuns[0].Status != meta.SyncRunStatusFailed ||
		repairedRuns[1].Status != meta.SyncRunStatusCancelled {
		t.Fatalf("stale runs not finalized: %+v", repairedRuns)
	}
	for _, run := range repairedRuns {
		if run.FinishedAt == nil ||
			run.ActiveTransferPath != "" ||
			run.ActiveTransferBytes != 0 ||
			run.ActiveTransferTotal != 0 {
			t.Fatalf("stale run active state not cleared: %+v", run)
		}
	}
	if !applied.After.OK() {
		t.Fatalf("after issues=%+v", applied.After.Issues)
	}

	for _, item := range items {
		original := baseline[item.ID]
		var repaired meta.SourceItem
		if err := db.First(&repaired, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		if repaired.NodeID != nil || repaired.NodeRevision != 0 ||
			repaired.State != meta.SourceItemStatePending {
			t.Fatalf("binding not reset: %+v", repaired)
		}
		if repaired.ExternalID != original.ExternalID ||
			repaired.Path != original.Path ||
			repaired.Size != original.Size ||
			repaired.RemoteRevision != original.RemoteRevision {
			t.Fatalf("remote identity/provenance changed: before=%+v after=%+v", original, repaired)
		}
		if repaired.LastSyncedRunID != original.LastSyncedRunID ||
			repaired.LastSyncedAt == nil ||
			original.LastSyncedAt == nil ||
			!repaired.LastSyncedAt.Equal(*original.LastSyncedAt) {
			t.Fatalf("sync history was erased: before=%+v after=%+v", original, repaired)
		}
	}

	second, err := RepairSources(context.Background(), db, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Actions) != 0 || len(second.RunActions) != 0 || !second.After.OK() {
		t.Fatalf("second repair=%+v", second)
	}
}
