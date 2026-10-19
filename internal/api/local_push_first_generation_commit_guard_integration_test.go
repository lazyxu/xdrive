package api

import (
	"bytes"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// A new Source has no previous Operation row. It still must not admit an
// initial private reservation if the immutable COMMIT migration is missing.
func TestLocalPushFirstGenerationRequiresCommitMigration(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.Migrator().DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	for _, keyed := range []bool{false, true} {
		var got meta.LocalPushOperationIntent
		var err error
		s := &Server{DB: f.replica}
		if keyed {
			got, err = s.reserveBoundLocalPushOperationIntentWithKey(
				f.owningRequest(), f.source.ID, f.source.Revision,
				bytes.Repeat([]byte{0x71}, localPushOperationRequestKeySize))
		} else {
			got, err = s.reserveBoundLocalPushOperationIntent(
				f.owningRequest(), f.source.ID, f.source.Revision)
		}
		if !errors.Is(err, errLocalPushOperationIntentDenied) || got.ID != "" {
			t.Fatalf("missing migration admitted initial reservation keyed=%t: %+v %v", keyed, got, err)
		}
	}
	var operations, items, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&operations).Error; err != nil || operations != 0 {
		t.Fatalf("missing migration created Operation: %d %v", operations, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("missing migration created SourceItem: %d %v", items, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("missing migration invented SourceRun: %d %v", runs, err)
	}
}

// Simulate a damaged restore that retains immutable physical CAS/SQL COMMIT
// evidence but loses the private Operation row. Admission must not mint
// generation one again, even though the normal 'latest' lookup is empty.
func TestLocalPushOrphanedFirstLeafCommitVetoesFreshInitialGeneration(t *testing.T) {
	f, oldKey, operation := makeLocalPushBoundFirstLeafFixture(t)
	committed, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, oldKey, operation.ID, operation.Generation)
	if err != nil || !ok || committed.NodeID == 0 || committed.SourceItemID == 0 {
		t.Fatalf("real canonical first-leaf COMMIT prerequisite unavailable: %+v %t %v", committed, ok, err)
	}
	removed := f.server.DB.Where("id = ?", operation.ID).Delete(&meta.LocalPushOperationIntent{})
	if removed.Error != nil || removed.RowsAffected != 1 {
		t.Fatalf("cannot simulate lost private reservation row: %+v", removed)
	}
	var prior meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", operation.ID).Take(&prior).Error; err != nil ||
		prior.NodeID != committed.NodeID || prior.SourceItemID != committed.SourceItemID {
		t.Fatalf("orphaned immutable COMMIT was altered: %+v %v", prior, err)
	}
	for _, keyed := range []bool{false, true} {
		var next meta.LocalPushOperationIntent
		var err error
		if keyed {
			next, err = f.server.reserveBoundLocalPushOperationIntentWithKey(
				f.ctx, f.source.ID, f.source.Revision,
				bytes.Repeat([]byte{0x72}, localPushOperationRequestKeySize))
		} else {
			next, err = f.server.reserveBoundLocalPushOperationIntent(
				f.ctx, f.source.ID, f.source.Revision)
		}
		if !errors.Is(err, errLocalPushOperationIntentDenied) || next.ID != "" {
			t.Fatalf("orphan COMMIT admitted a fresh operation keyed=%t: %+v %v", keyed, next, err)
		}
	}
	var ops, runs int64
	if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&ops).Error; err != nil || ops != 0 {
		t.Fatalf("orphan COMMIT was hidden behind a new generation: %d %v", ops, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("orphan COMMIT was reported as backup success: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", committed.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("orphan SourceItem is no longer PENDING: %+v %v", item, err)
	}
}

func TestLocalPushFirstGenerationStillAcceptsEmptyCommitTable(t *testing.T) {
	f := makeLocalOperationFixture(t)
	first, err := (&Server{DB: f.primary}).reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision,
		bytes.Repeat([]byte{0x73}, localPushOperationRequestKeySize))
	if err != nil || first.ID == "" || first.Generation != 1 ||
		first.State != meta.LocalPushOperationIntentReserved {
		t.Fatalf("valid first private reservation was denied: %+v %v", first, err)
	}
	var commits, runs int64
	if err := f.replica.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Where("source_id = ?", f.source.ID).Count(&commits).Error; err != nil || commits != 0 {
		t.Fatalf("valid reservation invented immutable COMMIT: %d %v", commits, err)
	}
	if err := f.replica.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("valid reservation invented SourceRun: %d %v", runs, err)
	}
}
