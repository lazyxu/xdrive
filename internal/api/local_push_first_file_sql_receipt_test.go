package api

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func (f localPushExistingCASTestFixture) readFirstLeafSQLReceipt(
	leaf string,
) (localPushFirstLeafSQLReceipt, error) {
	return f.server.readBoundLocalPushFirstLeafSQLReceipt(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID, leaf,
	)
}

func TestLocalPushFirstLeafSQLReceiptPersistsAcrossStageReplacementAndExpiry(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	committed, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !ok || committed.NodeID == 0 || committed.SourceItemID == 0 {
		t.Fatalf("initial bounded SQL commit failed: %+v ok=%t err=%v", committed, ok, err)
	}
	var firstHold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&firstHold).Error; err != nil ||
		firstHold.CommittedSourceItemID == nil ||
		*firstHold.CommittedSourceItemID != committed.SourceItemID {
		t.Fatalf("atomic receipt lacks exact SourceItem identity: %+v err=%v", firstHold, err)
	}
	receipt, err := f.readFirstLeafSQLReceipt(localPushFirstLeafFixtureName)
	if err != nil || receipt.State != localPushFirstLeafSQLReceiptState ||
		receipt.NodeID != committed.NodeID || receipt.SourceItemID != committed.SourceItemID {
		t.Fatalf("fresh SQL-only receipt did not match committed rows: %+v err=%v", receipt, err)
	}

	// A Source holds only one live Stage row; later staging may replace it.
	// This SQL-only receipt must remain independently auditable without
	// reauthorizing an old Stage for more uploads.
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).
		Update("stage_id", uuid.NewString()).Error; err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
		Where("stage_id = ?", f.stage.StageID).
		Update("stage_expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
		Where("stage_id = ?", f.stage.StageID).
		Update("expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	again, err := f.readFirstLeafSQLReceipt(localPushFirstLeafFixtureName)
	if err != nil || again.State != localPushFirstLeafSQLReceiptState ||
		again.NodeID != receipt.NodeID || again.SourceItemID != receipt.SourceItemID {
		t.Fatalf("lost-response recovery after replaced/expired Stage failed: %+v err=%v", again, err)
	}
	var afterHold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).
		Take(&afterHold).Error; err != nil ||
		!afterHold.CommittedAt.Equal(*firstHold.CommittedAt) ||
		afterHold.CommittedSourceItemID == nil ||
		*afterHold.CommittedSourceItemID != committed.SourceItemID {
		t.Fatalf("read-only receipt modified durable commit: %+v err=%v", afterHold, err)
	}
	var runCount int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("SQL-only receipt fabricated a SourceRun: count=%d err=%v", runCount, err)
	}
}

func TestLocalPushFirstLeafSQLReceiptRequiresOwningDeviceAndExactCanonicalState(t *testing.T) {
	for _, variant := range []string{
		"forged-token", "wrong-root", "source-revision", "wrong-leaf",
		"blob-deleting", "item-path", "tampered-intent", "changed-node",
		"wrong-receipt-item", "uncommitted-hold",
	} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushFirstFileCommitFixture(t)
			if _, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName); !ok || err != nil {
				t.Fatalf("fixture first-file commit failed: ok=%t err=%v", ok, err)
			}
			leaf := localPushFirstLeafFixtureName
			switch variant {
			case "forged-token":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "incorrect-device-token")
			case "wrong-root":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint",
					"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
			case "source-revision":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "wrong-leaf":
				leaf = "other-first-file.jpg"
			case "blob-deleting":
				if err := f.server.DB.Model(&meta.ContentBlob{}).
					Where("sha256 = ?", f.stage.ContentSHA256).
					Updates(map[string]any{"state": meta.ContentBlobStateDeleting, "ref_count": 0}).Error; err != nil {
					t.Fatal(err)
				}
			case "item-path":
				if err := f.server.DB.Model(&meta.SourceItem{}).
					Where("source_id = ?", f.source.ID).Update("path", "different.jpg").Error; err != nil {
					t.Fatal(err)
				}
			case "tampered-intent":
				if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("current_path_key",
						"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee").Error; err != nil {
					t.Fatal(err)
				}
			case "changed-node":
				if err := f.server.DB.Model(&meta.Node{}).
					Where("name = ?", localPushFirstLeafFixtureName).
					Update("revision", 2).Error; err != nil {
					t.Fatal(err)
				}
			case "wrong-receipt-item":
				if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("committed_source_item_id", uint64(999999)).Error; err != nil {
					t.Fatal(err)
				}
			case "uncommitted-hold":
				if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("committed_at", nil).Error; err != nil {
					t.Fatal(err)
				}
			}
			if receipt, err := f.readFirstLeafSQLReceipt(leaf); err == nil ||
				receipt.State == localPushFirstLeafSQLReceiptState {
				t.Fatalf("%s returned an untrusted SQL receipt: %+v err=%v", variant, receipt, err)
			}
		})
	}
}

func TestLocalPushFirstLeafSQLReceiptNeverClaimsPhysicalContentVerified(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	first, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !ok {
		t.Fatalf("first-file SQL fixture failed: %+v ok=%t err=%v", first, ok, err)
	}
	// Simulate an external actor removing canonical bytes without using
	// the cooperating Server GC transaction. The SQL receipt remains a
	// historical database fact, explicitly not a restorable-file proof.
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatal(err)
	}
	sqlOnly, err := f.readFirstLeafSQLReceipt(localPushFirstLeafFixtureName)
	if err != nil || sqlOnly.State != localPushFirstLeafSQLReceiptState ||
		sqlOnly.NodeID != first.NodeID || sqlOnly.SourceItemID != first.SourceItemID {
		t.Fatalf("SQL-only receipt was incorrectly treated as a physical verifier: %+v err=%v",
			sqlOnly, err)
	}
}
