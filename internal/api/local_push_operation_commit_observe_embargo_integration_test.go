package api

import (
	"bytes"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A Server reservation may still be "reserved" or age to "expired" after a
// genuine first-leaf SQL/CAS COMMIT. Neither is a trustworthy description of
// its recoverable physical outcome. Preserve the original key and use the
// separately fenced native+historical CAS read instead.
func TestLocalPushOperationObserveCannotHideCommittedFirstLeaf(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	observe := func() (localPushOperationIntentObservation, error) {
		return f.server.observeBoundLocalPushOperationIntent(
			f.ctx, f.source.ID, f.source.Revision, operation.ID, operation.Generation,
		)
	}
	before, err := observe()
	if err != nil || before.state != meta.LocalPushOperationIntentReserved {
		t.Fatalf("valid uncommitted reservation no longer observable: %+v %v", before, err)
	}
	first, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, operation.ID, operation.Generation,
	)
	if err != nil || !committed || first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("physical CAS/SQL prerequisite missing: %+v %t %v", first, committed, err)
	}
	for _, state := range []string{"still-live", "lease-expired"} {
		t.Run(state, func(t *testing.T) {
			if state == "lease-expired" {
				update := f.server.DB.Exec(
					"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", operation.ID,
				)
				if update.Error != nil || update.RowsAffected != 1 {
					t.Fatalf("could not expire committed operation: %+v", update)
				}
			}
			result, err := observe()
			if err == nil || result != (localPushOperationIntentObservation{}) {
				t.Fatalf("%s reservation falsely reported after SQL COMMIT: %+v %v", state, result, err)
			}
		})
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("observation changed pending SourceItem: %+v %v", item, err)
	}
	var runs, commits int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("observation fabricated backup success: %d %v", runs, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Where("source_id = ?", f.source.ID).Count(&commits).Error; err != nil || commits != 1 {
		t.Fatalf("observation changed original SQL COMMIT: %d %v", commits, err)
	}
}

// A pre-fence upgrade could already have admitted another uncommitted and
// aborted operation behind a committed first leaf. Source-wide history, not
// only the latest operation ID, must prevent an "aborted" recovery answer.
func TestLocalPushHistoricalCommitHidesBehindLatestAbortedObservation(t *testing.T) {
	f, key, original := makeLocalPushBoundFirstLeafFixture(t)
	first, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, original.ID, original.Generation,
	)
	if err != nil || !ok || first.NodeID == 0 {
		t.Fatalf("original SQL/CAS COMMIT missing: %+v %t %v", first, ok, err)
	}
	digest, valid := localPushOperationRequestKeyDigest(
		bytes.Repeat([]byte{0x79}, localPushOperationRequestKeySize))
	if !valid {
		t.Fatal("bad test key digest")
	}
	now := time.Now().UTC()
	legacy := original
	legacy.ID = uuid.NewString()
	legacy.Generation = original.Generation + 1
	legacy.RequestKeyDigest = &digest
	legacy.State = meta.LocalPushOperationIntentAborted
	legacy.IssuedAt = now.Add(-10 * time.Second)
	legacy.ExpiresAt = now.Add(20 * time.Second)
	legacy.AbortedAt = &now
	legacy.CreatedAt = time.Time{}
	legacy.UpdatedAt = time.Time{}
	if err := f.server.DB.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	result, err := f.server.observeBoundLocalPushOperationIntent(
		f.ctx, f.source.ID, f.source.Revision, legacy.ID, legacy.Generation,
	)
	if err == nil || result != (localPushOperationIntentObservation{}) {
		t.Fatalf("newest abort hid older committed file: %+v %v", result, err)
	}
	var count, runs int64
	if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("read-only guard altered reservation history: %d %v", count, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("false completed backup: %d %v", runs, err)
	}
}

// If the immutable SQL COMMIT table is unavailable, a read MUST NOT silently
// turn that uncertainty into an "uncommitted" reservation status.
func TestLocalPushOperationObserveMissingCommitTableFailsClosed(t *testing.T) {
	f := makeLocalOperationFixture(t)
	first, err := (&Server{DB: f.primary}).reserveBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Migrator().DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	got, err := (&Server{DB: f.replica}).observeBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation)
	if err == nil || got != (localPushOperationIntentObservation{}) {
		t.Fatalf("missing SQL COMMIT migration reported false uncommitted operation: %+v %v", got, err)
	}
	var operations, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ?", f.source.ID).Count(&operations).Error; err != nil || operations != 1 {
		t.Fatalf("denied observation altered operation: %d %v", operations, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("denied observation invented backup Run: %d %v", runs, err)
	}
}
