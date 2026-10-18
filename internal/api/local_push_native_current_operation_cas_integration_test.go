//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// A real native original crosses the existing authenticated Gin Stage,
// physical CAS preparation, and the CURRENT-operation SQL writer. This
// remains an UNROUTED fixture: a precommit native observation is NOT a
// continuously held file handle or a successful production backup.
func TestLocalPushNativeOriginalToCurrentOperationPinnedCASAndSQL(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	original, err := f.nativePrecommit()
	if err != nil || !original.NativeMatched || !original.PhysicalStageMatched ||
		original.Authoritative || original.CommitSupported {
		t.Fatalf("native-to-Stage precommit failed: %+v %v", original, err)
	}
	f.prepareAndReserve(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationIntent{}, &meta.LocalPushOperationTerminalReceipt{}, &meta.LocalPushOperationStageBinding{}, &meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	originalKey := bytes.Repeat([]byte{0x5a}, localPushOperationRequestKeySize)
	operation, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.request, f.source.ID, f.source.Revision, originalKey,
	)
	if err != nil || operation.ID == "" || operation.Generation == 0 {
		t.Fatalf("owning operation did not reserve: %+v %v", operation, err)
	}
	if _, err := f.server.bindBoundLocalPushOperationStage(
		f.request, f.source.ID, f.source.Revision, f.sqlProof,
		f.stage.StageID, originalKey, operation.ID, operation.Generation,
	); err != nil {
		t.Fatalf("real native Stage not bound to current operation: %v", err)
	}
	write := func() (localPushFirstFileCommitResult, bool, error) {
		return f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
			f.request, f.source.ID, f.source.Revision, f.sqlProof,
			f.stage.StageID, localPushFirstLeafFixtureName,
			originalKey, operation.ID, operation.Generation,
		)
	}
	first, committed, err := write()
	if err != nil || !committed || first.Replayed || first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("real native current-operation CAS/SQL commit denied: %+v admitted=%t %v", first, committed, err)
	}
	replay, committed, err := write()
	if err != nil || !committed || !replay.Replayed ||
		replay.NodeID != first.NodeID || replay.SourceItemID != first.SourceItemID {
		t.Fatalf("same-key replay changed canonical identity: %+v admitted=%t %v", replay, committed, err)
	}
	receipt, err := f.server.readBoundLocalPushFirstLeafPhysicalReceipt(
		f.request, f.source.ID, f.source.Revision, f.sqlProof,
		f.stage.StageID, localPushFirstLeafFixtureName,
	)
	if err != nil || receipt.NodeID != first.NodeID ||
		receipt.SourceItemID != first.SourceItemID ||
		receipt.State != localPushFirstLeafPhysicalReceiptState {
		t.Fatalf("real physical receipt elevated unsafe backup authority: %+v %v", receipt, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).Take(&blob).Error; err != nil ||
		blob.Size != int64(len(f.body)) || blob.RefCount != 1 || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("original bytes were not referenced exactly once: %+v %v", blob, err)
	}
	reader, err := f.store.Open(context.Background(), blob.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, f.body) {
		t.Fatalf("actual native bytes changed across CAS: %v %v", readErr, closeErr)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("private writer lifted local-folder hard gate: %+v %v", source, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("native operation incorrectly marked synced: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runs).Error; err != nil || runs != 0 || f.stagePUTs.Load() != 1 {
		t.Fatalf("private operation fabricated a Run or duplicated native PUT: runs=%d puts=%d %v", runs, f.stagePUTs.Load(), err)
	}
}

// An authenticated reservation aborted after the actual original reached
// Stage/CAS must not publish even one canonical File/Node/SourceItem.
func TestLocalPushNativeOriginalToCASRejectsAbortedCurrentOperation(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	observed, err := f.nativePrecommit()
	if err != nil || !observed.NativeMatched || !observed.PhysicalStageMatched {
		t.Fatalf("native original fixture not verified: %+v %v", observed, err)
	}
	f.prepareAndReserve(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationIntent{}, &meta.LocalPushOperationTerminalReceipt{}, &meta.LocalPushOperationStageBinding{}, &meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{0x3a}, localPushOperationRequestKeySize)
	operation, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.request, f.source.ID, f.source.Revision, key,
	)
	if err != nil || operation.ID == "" {
		t.Fatalf("owning operation unavailable: %+v %v", operation, err)
	}
	if _, err := f.server.bindBoundLocalPushOperationStage(
		f.request, f.source.ID, f.source.Revision, f.sqlProof,
		f.stage.StageID, key, operation.ID, operation.Generation,
	); err != nil {
		t.Fatalf("native Stage pre-abort binding missing: %v", err)
	}
	if err := f.server.abortBoundLocalPushOperationIntent(
		f.request, f.source.ID, f.source.Revision, operation.ID, operation.Generation,
	); err != nil {
		t.Fatalf("owning operation abort denied: %v", err)
	}
	_, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.request, f.source.ID, f.source.Revision, f.sqlProof,
		f.stage.StageID, localPushFirstLeafFixtureName, key, operation.ID, operation.Generation,
	)
	if committed || err == nil {
		t.Fatalf("aborted native operation committed actual CAS metadata: %t %v", committed, err)
	}
	var blobs, items, runs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("aborted writer added referenced Blob: %d %v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).
		Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("aborted writer added SourceItem: %d %v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("aborted writer fabricated Run: %d %v", runs, err)
	}
	var hold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
		hold.CommittedAt != nil || hold.CommittedNodeID != nil || hold.CommittedSourceItemID != nil {
		t.Fatalf("aborted writer published durable metadata: %+v %v", hold, err)
	}
}
