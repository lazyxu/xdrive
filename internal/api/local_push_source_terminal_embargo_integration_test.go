package api

import (
	"bytes"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A legacy successor might have been admitted before the source-wide first-
// leaf embargo. It must not issue an ABORT or EXPIRED receipt while an older
// generation has an actual persisted canonical first-leaf SQL/CAS COMMIT.
func TestLocalPushHistoricalFirstLeafCommitBlocksLaterNegativeOutcomes(t *testing.T) {
	for _, scenario := range []string{"abort", "terminal-aborted", "terminal-expired"} {
		t.Run(scenario, func(t *testing.T) {
			f, originalKey, first := makeLocalPushBoundFirstLeafFixture(t)
			committed, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.ctx, f.source.ID, f.source.Revision, f.proof,
				f.stage.StageID, localPushFirstLeafFixtureName,
				originalKey, first.ID, first.Generation)
			if err != nil || !ok || committed.NodeID == 0 || committed.SourceItemID == 0 {
				t.Fatalf("genuine original first-leaf SQL/CAS commit missing: %+v %t %v", committed, ok, err)
			}
			// Model one older pre-G1b install: a distinct, already-admitted
			// second generation with no SQL COMMIT of its own.
			key := bytes.Repeat([]byte{0x7b}, localPushOperationRequestKeySize)
			digest, valid := localPushOperationRequestKeyDigest(key)
			if !valid {
				t.Fatal("invalid test-only legacy operation key")
			}
			now := time.Now().UTC()
			legacy := first
			legacy.ID = uuid.NewString()
			legacy.Generation = first.Generation + 1
			legacy.RequestKeyDigest = &digest
			legacy.State = meta.LocalPushOperationIntentReserved
			legacy.AbortedAt = nil
			legacy.IssuedAt = now.Add(-10 * time.Second)
			legacy.ExpiresAt = now.Add(20 * time.Second)
			if scenario == "terminal-aborted" {
				legacy.State = meta.LocalPushOperationIntentAborted
				legacy.AbortedAt = &now
			}
			if scenario == "terminal-expired" {
				legacy.IssuedAt = now.Add(-35 * time.Second)
				legacy.ExpiresAt = now.Add(-5 * time.Second)
			}
			legacy.CreatedAt = time.Time{}
			legacy.UpdatedAt = time.Time{}
			if err := f.server.DB.Create(&legacy).Error; err != nil {
				t.Fatalf("failed to seed legacy admitted generation: %v", err)
			}

			switch scenario {
			case "abort":
				if err := f.server.abortBoundLocalPushOperationIntent(
					f.ctx, f.source.ID, f.source.Revision, legacy.ID, legacy.Generation,
				); err == nil {
					t.Fatal("historically committed Source issued a newer abort")
				}
			default:
				got, err := f.server.recordBoundLocalPushReservationTerminal(
					f.ctx, f.source.ID, f.source.Revision, key, legacy.ID, legacy.Generation,
				)
				if err == nil || got != (localPushPrivateReservationTerminal{}) {
					t.Fatalf("older SQL COMMIT hidden behind newer terminal: %+v %v", got, err)
				}
			}
			var unchanged meta.LocalPushOperationIntent
			if err := f.server.DB.Where("id = ?", legacy.ID).Take(&unchanged).Error; err != nil ||
				unchanged.State != legacy.State ||
				(unchanged.AbortedAt == nil) != (legacy.AbortedAt == nil) {
				t.Fatalf("denied action modified legacy operation: %+v %v", unchanged, err)
			}
			var original meta.LocalPushFirstLeafOperationCommit
			if err := f.server.DB.Where("operation_id = ?", first.ID).Take(&original).Error; err != nil ||
				original.NodeID != committed.NodeID || original.SourceItemID != committed.SourceItemID {
				t.Fatalf("immutable earlier SQL COMMIT altered: %+v %v", original, err)
			}
			var item meta.SourceItem
			if err := f.server.DB.Where("id = ?", committed.SourceItemID).Take(&item).Error; err != nil ||
				item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
				t.Fatalf("older first-leaf SourceItem changed: %+v %v", item, err)
			}
			var terminals, runs int64
			if err := f.server.DB.Model(&meta.LocalPushOperationTerminalReceipt{}).
				Where("source_id = ?", f.source.ID).Count(&terminals).Error; err != nil || terminals != 0 {
				t.Fatalf("denied legacy action minted terminal evidence: %d %v", terminals, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("denied legacy action fabricated backup Run: %d %v", runs, err)
			}
		})
	}
}

// The source-wide check must not change valid previously-tested behavior
// when NO committed first leaf exists: aborted and expired lease receipts
// remain strictly private reservation outcomes, never a backup complete.
func TestLocalPushSourceWithoutCommittedLeafStillAllowsValidReservationTerminal(t *testing.T) {
	f := makeLocalOperationFixture(t)
	key := bytes.Repeat([]byte{0x39}, localPushOperationRequestKeySize)
	first, err := (&Server{DB: f.primary}).reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := (&Server{DB: f.replica}).abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation); err != nil {
		t.Fatalf("valid uncommitted abort denied: %v", err)
	}
	terminal, err := (&Server{DB: f.primary}).recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		first.ID, first.Generation)
	if err != nil || terminal.state != meta.LocalPushTerminalReservationAborted {
		t.Fatalf("ordinary uncommitted abort receipt unavailable: %+v %v", terminal, err)
	}
	var runs int64
	if err := f.primary.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("reservation terminal invented completed backup: %d %v", runs, err)
	}
}
