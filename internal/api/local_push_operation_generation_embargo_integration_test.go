package api

import (
	"bytes"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A committed first leaf is durable SQL history, even when the 30-second
// operation reservation has elapsed and its HTTP response was lost. Without
// native/physical recovery and key-retirement proof no new generation may be
// minted for the same Source. This is not a backup completion receipt.
func TestLocalPushCommittedFirstLeafEmbargoesNextGeneration(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	committed, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, operation.ID, operation.Generation)
	if err != nil || !ok || committed.NodeID == 0 || committed.SourceItemID == 0 {
		t.Fatalf("real SQL/CAS first-leaf prerequisite unavailable: %+v %t %v", committed, ok, err)
	}
	// Same-key replay may recover the original admission while the lease is
	// still live. It must not mint an alternate operation or generation.
	replay, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.ctx, f.source.ID, f.source.Revision, key)
	if err != nil || replay.ID != operation.ID || replay.Generation != operation.Generation {
		t.Fatalf("original-key replay changed operation: %+v %v", replay, err)
	}
	expired := f.server.DB.Exec(
		"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", operation.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("cannot expire previously committed operation: %+v", expired)
	}
	for _, scenario := range []struct {
		name  string
		keyed bool
	}{{"fresh-native-key", true}, {"unkeyed-private-legacy", false}} {
		t.Run(scenario.name, func(t *testing.T) {
			var next meta.LocalPushOperationIntent
			var err error
			if scenario.keyed {
				next, err = f.server.reserveBoundLocalPushOperationIntentWithKey(
					f.ctx, f.source.ID, f.source.Revision,
					bytes.Repeat([]byte{0x74}, localPushOperationRequestKeySize))
			} else {
				next, err = f.server.reserveBoundLocalPushOperationIntent(
					f.ctx, f.source.ID, f.source.Revision)
			}
			if err == nil || next.ID != "" {
				t.Fatalf("post-COMMIT lease expiry admitted another generation: %+v %v", next, err)
			}
		})
	}
	var operations, commits, runs int64
	if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&operations).Error; err != nil || operations != 1 {
		t.Fatalf("post-COMMIT embargo altered operation count: %d %v", operations, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Where("operation_id = ?", operation.ID).Count(&commits).Error; err != nil || commits != 1 {
		t.Fatalf("committed SQL receipt disappeared: %d %v", commits, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("embargo fabricated backup completion: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", committed.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("first leaf no longer PENDING: %+v %v", item, err)
	}
}

// A previous version may already have admitted a newer uncommitted operation
// after an older SQL commit. Checking only the latest UUID is insufficient:
// the source-wide immutable receipt must hold the embargo until recovery.
func TestLocalPushHistoricalCommittedLeafEmbargoesLaterGeneration(t *testing.T) {
	f, key, first := makeLocalPushBoundFirstLeafFixture(t)
	committed, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, first.ID, first.Generation)
	if err != nil || !ok || committed.NodeID == 0 {
		t.Fatalf("real first-leaf SQL prerequisite unavailable: %+v %t %v", committed, ok, err)
	}
	digest, valid := localPushOperationRequestKeyDigest(bytes.Repeat([]byte{0x75}, localPushOperationRequestKeySize))
	if !valid {
		t.Fatal("test request key digest invalid")
	}
	now := time.Now().UTC()
	legacy := first
	legacy.ID = uuid.NewString()
	legacy.Generation = first.Generation + 1
	legacy.RequestKeyDigest = &digest
	legacy.State = meta.LocalPushOperationIntentAborted
	legacy.IssuedAt = now.Add(-10 * time.Second)
	legacy.ExpiresAt = now.Add(20 * time.Second)
	legacy.AbortedAt = &now
	legacy.CreatedAt = time.Time{}
	legacy.UpdatedAt = time.Time{}
	// Simulate a pre-fence generation with no SQL COMMIT of its own.
	if err := f.server.DB.Create(&legacy).Error; err != nil {
		t.Fatalf("cannot seed older inconsistent generation history: %v", err)
	}
	next, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.ctx, f.source.ID, f.source.Revision,
		bytes.Repeat([]byte{0x76}, localPushOperationRequestKeySize))
	if err == nil || next.ID != "" {
		t.Fatalf("older SQL COMMIT lost protection behind later generation: %+v %v", next, err)
	}
	var operations int64
	if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&operations).Error; err != nil || operations != 2 {
		t.Fatalf("unsafe third-generation admission changed history: %d %v", operations, err)
	}
}

// If the immutable commit table is missing, SQL cannot certify that an
// earlier operation did not commit; a fresh key must never silently bypass
// that uncertainty simply because the previous reservation was aborted.
func TestLocalPushNextGenerationFailsClosedWithoutCommitMigration(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	key := bytes.Repeat([]byte{0x61}, localPushOperationRequestKeySize)
	first, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation); err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Migrator().DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	next, err := (&Server{DB: f.replica}).reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision,
		bytes.Repeat([]byte{0x62}, localPushOperationRequestKeySize))
	if err == nil || next.ID != "" {
		t.Fatalf("missing immutable COMMIT table admitted a new generation: %+v %v", next, err)
	}
	var operations, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&operations).Error; err != nil || operations != 1 {
		t.Fatalf("missing migration created another private operation: %d %v", operations, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("missing migration fabricated a backup run: %d %v", runs, err)
	}
}
