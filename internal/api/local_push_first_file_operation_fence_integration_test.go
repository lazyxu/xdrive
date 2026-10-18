package api

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func makeLocalPushFencedFirstLeafFixture(
	t *testing.T,
) (localPushExistingCASTestFixture, []byte, meta.LocalPushOperationIntent) {
	t.Helper()
	f := makeLocalPushFirstFileCommitFixture(t)
	if err := f.server.DB.AutoMigrate(
		&meta.LocalPushOperationIntent{}, &meta.LocalPushOperationTerminalReceipt{},
	); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{0x73}, localPushOperationRequestKeySize)
	operation, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.ctx, f.source.ID, f.source.Revision, key,
	)
	if err != nil {
		t.Fatalf("reserve exact owning operation: %v", err)
	}
	return f, key, operation
}

// makeLocalPushBoundFirstLeafFixture adds the immutable Stage/operation SQL
// prerequisite ONLY to operation-aware writer tests. The original fixture
// remains unchanged for independent Stage-binding tests and legacy CI writer.
func makeLocalPushBoundFirstLeafFixture(
	t *testing.T,
) (localPushExistingCASTestFixture, []byte, meta.LocalPushOperationIntent) {
	t.Helper()
	f, key, operation := makeLocalPushFencedFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationStageBinding{}); err != nil {
		t.Fatal(err)
	}
	bound, err := f.server.bindBoundLocalPushOperationStage(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, key, operation.ID, operation.Generation)
	if err != nil || bound.StageID != f.stage.StageID ||
		bound.OperationID != operation.ID {
		t.Fatalf("current Stage/operation prerequisite missing: %+v %v", bound, err)
	}
	return f, key, operation
}

func TestLocalPushFencedFirstLeafCommitsExactCurrentGenerationOnly(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	commit := func() (localPushFirstFileCommitResult, bool, error) {
		return f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
			f.ctx, f.source.ID, f.source.Revision, f.proof,
			f.stage.StageID, localPushFirstLeafFixtureName,
			key, operation.ID, operation.Generation,
		)
	}
	first, ok, err := commit()
	if err != nil || !ok || first.Replayed || first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("same-operation physical CAS/SQL commit failed: %+v %t %v", first, ok, err)
	}
	again, ok, err := commit()
	if err != nil || !ok || !again.Replayed ||
		again.NodeID != first.NodeID || again.SourceItemID != first.SourceItemID {
		t.Fatalf("exact generation replay duplicated or lost receipt: %+v %t %v", again, ok, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil ||
		item.LastSyncedRunID != "" {
		t.Fatalf("operation fence falsely confirmed a SourceRun: %+v %v", item, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&stage).Error; err != nil ||
		stage.Status != localPushStageCommitted {
		t.Fatalf("actual CAS/SQL transaction did not commit: %+v %v", stage, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&blob).Error; err != nil ||
		blob.RefCount != 1 || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("operation-gated blob not durable: %+v %v", blob, err)
	}
	var runCount int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("operation gate invented successful backup runs: %d %v", runCount, err)
	}
}

func TestLocalPushFencedFirstLeafRejectsStaleAndForeignOperationsBeforeCAS(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "missing-key", "foreign-operation", "wrong-generation",
		"expired", "aborted", "revoked", "foreign-owner", "foreign-root",
		"terminal-receipt", "canceled",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
			id, generation := operation.ID, operation.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0x74}, localPushOperationRequestKeySize)
			case "missing-key":
				key = nil
			case "foreign-operation":
				id = uuid.NewString()
			case "wrong-generation":
				generation++
			case "expired":
				if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
					Where("id = ?", id).
					Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
					t.Fatal(err)
				}
			case "aborted":
				if err := f.server.abortBoundLocalPushOperationIntent(
					f.ctx, f.source.ID, f.source.Revision, id, generation,
				); err != nil {
					t.Fatal(err)
				}
			case "revoked":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "foreign-owner":
				f.ctx.Set("userID", f.device.OwnerID+1)
			case "foreign-root":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint",
					"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
			case "terminal-receipt":
				digest, valid := localPushOperationRequestKeyDigest(key)
				if !valid {
					t.Fatal("valid original key missing")
				}
				if err := f.server.DB.Create(&meta.LocalPushOperationTerminalReceipt{
					OperationID: id, SourceID: f.source.ID, Generation: generation,
					RequestKeyDigest: digest, State: meta.LocalPushTerminalReservationExpired,
					RecordedAt: time.Now().UTC(),
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "canceled":
				ctx, cancel := context.WithCancel(f.ctx.Request.Context())
				cancel()
				defer cancel()
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
			}
			_, admitted, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.ctx, f.source.ID, f.source.Revision, f.proof,
				f.stage.StageID, localPushFirstLeafFixtureName, key, id, generation,
			)
			if admitted || err == nil {
				t.Fatalf("%s bypassed current operation writer fence: %t %v", scenario, admitted, err)
			}
			var items, blobs, runs int64
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
				t.Fatalf("%s created SourceItem: %d %v", scenario, items, err)
			}
			if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
				t.Fatalf("%s created durable CAS: %d %v", scenario, blobs, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s created a backup run: %d %v", scenario, runs, err)
			}
			var hold meta.LocalPushQuotaHold
			if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
				hold.CommittedAt != nil || hold.CommittedNodeID != nil {
				t.Fatalf("%s transferred quota despite denial: %+v %v", scenario, hold, err)
			}
		})
	}
}

func TestLocalPushFencedFirstLeafRejectsExpiryInsidePinnedCallback(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	var expiry meta.LocalPushOperationIntent
	if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
		Where("id = ?", operation.ID).
		Update("expires_at", time.Now().UTC().Add(2*time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("id = ?", operation.ID).Take(&expiry).Error; err != nil {
		t.Fatal(err)
	}
	entered := false
	_, admitted, err := f.server.commitBoundLocalPushFirstLeafWithInspectorAndOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		func(ctx context.Context, _, _ string, _ int64, callback func(context.Context) error) (bool, error) {
			entered = true
			if remaining := time.Until(expiry.ExpiresAt) + 150*time.Millisecond; remaining > 0 {
				timer := time.NewTimer(remaining)
				defer timer.Stop()
				select {
				case <-ctx.Done():
					return false, ctx.Err()
				case <-timer.C:
				}
			}
			return false, callback(ctx)
		},
		&localPushFirstLeafOperation{requestKey: key, operationID: operation.ID, generation: operation.Generation},
	)
	if !entered {
		t.Skip("expired before pinned callback admission; no deterministic mid-transaction window")
	}
	if admitted || err == nil {
		t.Fatalf("expired operation crossed physical-pinned precommit fence: %t %v", admitted, err)
	}
	var items int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("expired precommit did not rollback canonical rows: %d %v", items, err)
	}
}
