package api

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// This is a SYNTHETIC fixture for the unexposed SQL/CAS terminal writer.
// A production caller must get equivalent identity only from an owning
// authenticated native Agent while its original fd and Writer Claim are held.
func testLocalPushHeldNativeCommitWitness(
	committed meta.LocalPushFirstLeafOperationCommit,
) localPushHeldNativeCommitWitness {
	return localPushHeldNativeCommitWitness{
		operationID: committed.OperationID, generation: committed.Generation,
		stageID: committed.StageID, sourceID: committed.SourceID,
		revision: committed.SourceRevision, deviceID: committed.DeviceID,
		rootID: committed.RootID, rootFingerprint: committed.RootFingerprint,
		snapshotSHA256: committed.CurrentSnapshotSHA256,
		pathKey:        committed.CurrentPathKey, contentSHA256: committed.ContentSHA256,
		totalSize:           committed.TotalSize,
		nativeWitnessSHA256: strings.Repeat("d", 64), originalClaimHeld: true,
	}
}

func TestLocalPushPhysicalCommitPinnedOriginalTransactionIsDurableButNotBackupComplete(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	witness := testLocalPushHeldNativeCommitWitness(committed)
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), key...),
		operationID: op.ID, generation: op.Generation,
		requireFileTerminalVacant: true,
	}
	receipt, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, selector, witness)
	if err != nil || receipt.NodeID != first.NodeID ||
		receipt.SourceItemID != first.SourceItemID {
		t.Fatalf("pinned original operation terminal unavailable: %+v %v", receipt, err)
	}
	var recorded meta.LocalPushFileTerminal
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&recorded).Error; err != nil ||
		recorded.State != meta.LocalPushFileTerminalPhysicalCommit ||
		recorded.NodeID != first.NodeID ||
		recorded.SourceItemID != first.SourceItemID ||
		recorded.NativeWitnessSHA256 != witness.nativeWitnessSHA256 ||
		recorded.StageID != f.stage.StageID || recorded.Generation != op.Generation {
		t.Fatalf("canonical physical-commit not durable: %+v %v", recorded, err)
	}
	if err := f.server.DB.Transaction(func(tx *gorm.DB) error {
		got, err := f.server.inspectBoundLocalPushFileTerminalTx(
			tx, f.ctx, f.source.ID, f.source.Revision,
			key, op.ID, op.Generation, f.stage.StageID)
		if err != nil || got.State != meta.LocalPushFileTerminalPhysicalCommit ||
			got.NativeWitnessSHA256 != witness.nativeWitnessSHA256 {
			t.Fatalf("original immutable terminal unreadable: %+v %v", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Lost ACK must not cause a second INSERT, another generation or a new
	// physical decision. The eventual replay reader is a separate stage.
	if again, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, selector, witness,
	); err == nil || again != (localPushFirstLeafSQLReceipt{}) {
		t.Fatalf("same Operation unexpectedly committed twice: %+v %v", again, err)
	}
	var count, runs int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("terminal row count changed after replay: %d %v", count, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("physical first file invented SourceRun completion: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("physical first file silently completed SourceItem: %+v %v", item, err)
	}
}

func TestLocalPushPhysicalCommitPinnedWriterRejectsForgedAndCrossScopeWitness(t *testing.T) {
	for _, scenario := range []string{
		"unheld-writer", "missing-native-digest", "wrong-op", "wrong-stage",
		"wrong-generation", "wrong-root", "wrong-content", "wrong-size",
		"wrong-key", "expired-reservation-receipt", "missing-cas",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, op, _ := makeLocalPushCommittedHistoricalOperationFixture(t)
			var committed meta.LocalPushFirstLeafOperationCommit
			if err := f.server.DB.Where("operation_id = ?", op.ID).
				Take(&committed).Error; err != nil {
				t.Fatal(err)
			}
			witness := testLocalPushHeldNativeCommitWitness(committed)
			selector := &localPushHistoricalOperationPhysicalSelector{
				requestKey:  append([]byte(nil), key...),
				operationID: op.ID, generation: op.Generation,
				requireFileTerminalVacant: true,
			}
			switch scenario {
			case "unheld-writer":
				witness.originalClaimHeld = false
			case "missing-native-digest":
				witness.nativeWitnessSHA256 = strings.Repeat("0", 64)
			case "wrong-op":
				witness.operationID = "not-the-original-operation"
			case "wrong-stage":
				witness.stageID = "replaced-stage"
			case "wrong-generation":
				witness.generation++
			case "wrong-root":
				witness.rootFingerprint = strings.Repeat("e", 64)
			case "wrong-content":
				witness.contentSHA256 = strings.Repeat("e", 64)
			case "wrong-size":
				witness.totalSize++
			case "wrong-key":
				selector.requestKey = bytes.Repeat([]byte{0xe1}, localPushOperationRequestKeySize)
			case "expired-reservation-receipt":
				// Inconsistent prior reservation history is a terminal veto,
				// not a claim that lease expiry physically stopped a Writer.
				earlier := meta.LocalPushOperationTerminalReceipt{
					OperationID: op.ID, SourceID: op.SourceID,
					Generation: op.Generation, RequestKeyDigest: *op.RequestKeyDigest,
					State:      meta.LocalPushTerminalReservationExpired,
					RecordedAt: committed.CommittedAt,
				}
				if err := f.server.DB.Create(&earlier).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-cas":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			}
			got, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
				f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
				localPushFirstLeafFixtureName, selector, witness)
			if err == nil || got != (localPushFirstLeafSQLReceipt{}) {
				t.Fatalf("%s fabricated a physical terminal: %+v %v", scenario, got, err)
			}
			var terminalCount, runCount int64
			if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
				Where("source_id = ?", f.source.ID).Count(&terminalCount).Error; err != nil ||
				terminalCount != 0 {
				t.Fatalf("%s left an unproven terminal: %d %v", scenario, terminalCount, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil ||
				runCount != 0 {
				t.Fatalf("%s created SourceRun: %d %v", scenario, runCount, err)
			}
		})
	}
}
