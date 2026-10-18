package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// A row is visible after the exact same physical-CAS/Node/SourceItem COMMIT.
// A lost response can no longer make the operation's *SQL* outcome disappear.
// This is NOT an attestation of current native bytes or backup completion.
func TestLocalPushOperationFirstLeafSQLCommitIsImmutableAfterReplay(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	write := func() (localPushFirstFileCommitResult, bool, error) {
		return f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
			f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
			localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	}
	first, committed, err := write()
	if err != nil || !committed || first.Replayed ||
		first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("first private SQL commit missing: %+v %t %v", first, committed, err)
	}
	var original meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", operation.ID).
		Take(&original).Error; err != nil ||
		original.StageID != f.stage.StageID ||
		original.SourceID != f.source.ID ||
		original.Generation != operation.Generation ||
		original.OwnerID != operation.OwnerID ||
		original.OwnerSession != operation.OwnerSession ||
		original.DeviceID != operation.DeviceID ||
		original.RootID != operation.RootID ||
		original.RootFingerprint != operation.RootFingerprint ||
		original.TargetNodeID != operation.TargetNodeID ||
		original.SourceRevision != f.source.Revision ||
		original.CurrentPathKey != f.stage.CurrentPathKey ||
		original.CurrentSnapshotSHA256 != f.stage.CurrentSnapshotSHA256 ||
		original.ContentSHA256 != f.stage.ContentSHA256 ||
		original.TotalSize != f.stage.TotalSize ||
		original.NodeID != first.NodeID ||
		original.SourceItemID != first.SourceItemID ||
		original.CommittedAt.IsZero() {
		t.Fatalf("durable private operation SQL outcome incomplete: %+v %v", original, err)
	}
	raw, err := json.Marshal(original)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private SQL commit record escaped JSON: %q %v", raw, err)
	}
	replay, ok, err := write()
	if err != nil || !ok || !replay.Replayed ||
		replay.NodeID != first.NodeID || replay.SourceItemID != first.SourceItemID {
		t.Fatalf("lost response replay duplicated canonical file: %+v %t %v", replay, ok, err)
	}
	var next meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", operation.ID).
		Take(&next).Error; err != nil ||
		!sameLocalPushFirstLeafOperationCommit(original, next) ||
		!original.CommittedAt.Equal(next.CommittedAt) {
		t.Fatalf("replay changed immutable commit receipt: %+v %v", next, err)
	}
	var rows int64
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("duplicate SQL commit receipts: %d %v", rows, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("SQL commit incorrectly reported successful backup: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("private outcome invented SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushOperationFirstLeafSQLCommitMissingMigrationRollsBackWholeFile(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	if err := f.server.DB.Migrator().
		DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	got, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	if err == nil || committed || got.NodeID != 0 || got.SourceItemID != 0 {
		t.Fatalf("missing receipt migration admitted canonical commit: %+v %t %v", got, committed, err)
	}
	var items, blobs, runs int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("missing commit migration created SourceItem: %d %v", items, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("missing commit migration created CAS ref: %d %v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("missing commit migration created SourceRun: %d %v", runs, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).
		Take(&stage).Error; err != nil || stage.Status != localPushStageReady {
		t.Fatalf("missing receipt schema committed Stage: %+v %v", stage, err)
	}
	var hold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).
		Take(&hold).Error; err != nil ||
		hold.CommittedAt != nil || hold.CommittedNodeID != nil ||
		hold.CommittedSourceItemID != nil {
		t.Fatalf("missing receipt schema transferred quota: %+v %v", hold, err)
	}
}

func TestLocalPushOperationFirstLeafSQLCommitRejectsCorruptReplayWithoutDeletingPriorCommit(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	first, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	if err != nil || !committed || first.NodeID == 0 {
		t.Fatalf("first SQL commit failed: %+v %v", first, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Where("operation_id = ?", operation.ID).
		Update("content_sha256", strings.Repeat("f", 64)).Error; err != nil {
		t.Fatal(err)
	}
	got, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	if err == nil || ok || got.NodeID != 0 {
		t.Fatalf("corrupt historical receipt permitted replay: %+v %t %v", got, ok, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.NodeID == nil || *item.NodeID != first.NodeID ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil {
		t.Fatalf("corrupt replay rewrote previously committed metadata: %+v %v", item, err)
	}
	var rows int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("corrupt replay duplicated or erased SourceItem: %d %v", rows, err)
	}
}

func TestLocalPushOperationFirstLeafSQLCommitNeverAppearsAfterAbort(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	if err := f.server.abortBoundLocalPushOperationIntent(
		f.ctx, f.source.ID, f.source.Revision, operation.ID, operation.Generation,
	); err != nil {
		t.Fatal(err)
	}
	_, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	if err == nil || committed {
		t.Fatalf("aborted operation created SQL commit: committed=%t err=%v", committed, err)
	}
	var rows int64
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Count(&rows).Error; err != nil || rows != 0 {
		t.Fatalf("aborted operation invented durable SQL commit: %d %v", rows, err)
	}
}
