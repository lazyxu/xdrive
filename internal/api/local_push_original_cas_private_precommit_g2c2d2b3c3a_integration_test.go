package api

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// The NativeWitnessSHA256 in this SQL-only TEST fixture is synthetic.
// Production has NO caller for the private precommit hook until an actual
// Agent-held OS original has been authenticated for the same operation.
func TestLocalPushPrivatePrecommitRetainsOriginalSQLAndPhysicalCASWindow(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	terminal := testLocalPushFileTerminal(op, f.stage.StageID)
	terminal.State = meta.LocalPushFileTerminalPhysicalCommit
	terminal.CurrentSnapshotSHA256 = committed.CurrentSnapshotSHA256
	terminal.CurrentPathKey = committed.CurrentPathKey
	terminal.ContentSHA256 = committed.ContentSHA256
	terminal.TotalSize = committed.TotalSize
	terminal.NodeID = committed.NodeID
	terminal.SourceItemID = committed.SourceItemID

	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), key...),
		operationID: op.ID, generation: op.Generation,
		requireFileTerminalVacant: true,
	}
	calls := 0
	mutate := func(ctx context.Context, tx *gorm.DB, receipt localPushFirstLeafSQLReceipt) error {
		calls++
		if ctx.Err() != nil || !localPushFileTerminalHeldTx(tx) ||
			receipt.NodeID != first.NodeID || receipt.SourceItemID != first.SourceItemID ||
			receipt.State != localPushFirstLeafSQLReceiptState {
			return errLocalPushOperationIntentDenied
		}
		return tx.Create(&terminal).Error
	}
	observed, err := f.server.observeBoundLocalPushOriginalCASWithPrivatePrecommit(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName, selector, mutate,
	)
	if err != nil || calls != 1 || observed.NodeID != first.NodeID ||
		observed.SourceItemID != first.SourceItemID {
		t.Fatalf("held CAS/SQL transaction callback unavailable: %+v calls=%d err=%v", observed, calls, err)
	}
	var recorded meta.LocalPushFileTerminal
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&recorded).Error; err != nil ||
		recorded.State != meta.LocalPushFileTerminalPhysicalCommit ||
		recorded.StageID != terminal.StageID || recorded.NodeID != first.NodeID ||
		recorded.SourceItemID != first.SourceItemID {
		t.Fatalf("original SQL terminal fixture not durable: %+v %v", recorded, err)
	}

	// Even if the caller loses the successful response, the original
	// immutable row is not a new writer ticket. Repeating this request is
	// rejected by the source-wide vacancy check before the callback.
	if again, err := f.server.observeBoundLocalPushOriginalCASWithPrivatePrecommit(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName, selector, mutate,
	); err == nil || again != (localPushFirstLeafSQLReceipt{}) || calls != 1 {
		t.Fatalf("replay entered an already-terminal source: %+v calls=%d err=%v", again, calls, err)
	}
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&recorded).Error; err != nil ||
		recorded.NodeID != terminal.NodeID {
		t.Fatalf("replay altered immutable terminal: %+v %v", recorded, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("private fixture incorrectly completed SourceRun: %d %v", runs, err)
	}
	var pending meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&pending).Error; err != nil ||
		pending.State != meta.SourceItemStatePending || pending.LastSyncedAt != nil {
		t.Fatalf("private fixture incorrectly completed SourceItem: %+v %v", pending, err)
	}
}

func TestLocalPushPrivatePrecommitRejectsWeakSelectorsAndRollsBack(t *testing.T) {
	for _, scenario := range []string{"missing-selector", "weak-selector", "wrong-key", "callback-failure", "missing-commit"} {
		t.Run(scenario, func(t *testing.T) {
			f, key, op, _ := makeLocalPushCommittedHistoricalOperationFixture(t)
			selector := &localPushHistoricalOperationPhysicalSelector{
				requestKey:  append([]byte(nil), key...),
				operationID: op.ID, generation: op.Generation,
				requireFileTerminalVacant: true,
			}
			switch scenario {
			case "missing-selector":
				selector = nil
			case "weak-selector":
				selector.requireFileTerminalVacant = false
			case "wrong-key":
				selector.requestKey = bytes.Repeat([]byte{0xef}, localPushOperationRequestKeySize)
			case "missing-commit":
				// The actual SQL COMMIT prerequisite is removed, while
				// immutable Stage/Operation/Owner are otherwise retained.
				if err := f.server.DB.Where("operation_id = ?", op.ID).
					Delete(&meta.LocalPushFirstLeafOperationCommit{}).Error; err != nil {
					t.Fatal(err)
				}
			}
			calls := 0
			mutate := func(ctx context.Context, tx *gorm.DB, receipt localPushFirstLeafSQLReceipt) error {
				calls++
				// A callback failure after a provisional SQL row MUST roll
				// back, not create a success or authorize a new writer.
				claim := testLocalPushFileTerminal(op, f.stage.StageID)
				if err := tx.Create(&claim).Error; err != nil {
					return err
				}
				return errors.New("synthetic callback abort before SQL COMMIT")
			}
			got, err := f.server.observeBoundLocalPushOriginalCASWithPrivatePrecommit(
				f.ctx, f.source.ID, f.source.Revision, f.proof,
				f.stage.StageID, localPushFirstLeafFixtureName, selector, mutate,
			)
			if err == nil || got != (localPushFirstLeafSQLReceipt{}) {
				t.Fatalf("%s escaped original pinned precommit: %+v %v", scenario, got, err)
			}
			if scenario == "callback-failure" {
				if calls != 1 || !errors.Is(err, storage.ErrLocalPushCASPrecommitOutcomeUncertain) {
					t.Fatalf("callback entry did not preserve uncertain classification: calls=%d err=%v", calls, err)
				}
			} else if calls != 0 {
				t.Fatalf("%s invoked a mutation before verifying original scope", scenario)
			}
			var rows, runs int64
			if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
				Where("source_id = ?", f.source.ID).Count(&rows).Error; err != nil || rows != 0 {
				t.Fatalf("%s left a durable SQL terminal without COMMIT: %d %v", scenario, rows, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s invented backup completion: %d %v", scenario, runs, err)
			}
		})
	}
}
