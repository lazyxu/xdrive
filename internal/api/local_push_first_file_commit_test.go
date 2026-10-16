package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

const localPushFirstLeafFixtureName = "native-first-file.jpg"

func makeLocalPushFirstFileCommitFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushQuotaHoldFixture(t)
	key, err := localPushFirstLeafPathKey(f.proof.RootID, localPushFirstLeafFixtureName)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).
		Update("current_path_key", key).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
		Where("stage_id = ?", f.stage.StageID).
		Update("current_path_key", key).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("source_id = ?", f.source.ID).
		Take(&f.stage).Error; err != nil {
		t.Fatal(err)
	}
	setLocalPushQuotaFixture(t, f, int64(len(f.body)))
	if created, err := f.reserveLocalQuota(); !created || err != nil {
		t.Fatalf("cannot book exact first-file quota: created=%t err=%v", created, err)
	}
	return f
}

func (f localPushExistingCASTestFixture) commitFirstLeaf(
	name string,
) (localPushFirstFileCommitResult, bool, error) {
	return f.server.commitBoundLocalPushFirstLeaf(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID, name,
	)
}

func TestLocalPushFirstLeafCommitPersistsAllReferencesAndReplays(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	// A single SQL connection ensures no nested DB acquisition occurs
	// while CAS and Stage shared OS pins are held across SQL COMMIT.
	sqlDB, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	first, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !admitted || first.Replayed || first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("first-file atomic commit failed: result=%+v admitted=%t err=%v", first, admitted, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&blob).Error; err != nil ||
		blob.State != meta.ContentBlobStateReady || blob.RefCount != 1 ||
		blob.Size != int64(len(f.body)) || blob.StorageKey != f.casKey {
		t.Fatalf("canonical CAS metadata mismatch: %+v err=%v", blob, err)
	}
	var node meta.Node
	if err := f.server.DB.Where("id = ?", first.NodeID).Take(&node).Error; err != nil ||
		node.ParentID == nil || *node.ParentID != f.stage.TargetNodeID ||
		node.Name != localPushFirstLeafFixtureName ||
		node.Type != meta.NodeTypeFile || node.OwnerID != f.device.OwnerID ||
		node.Revision != 1 {
		t.Fatalf("new file Node mismatch: %+v err=%v", node, err)
	}
	var file meta.File
	if err := f.server.DB.Where("node_id = ?", node.ID).Take(&file).Error; err != nil ||
		file.StorageKey != f.casKey || file.SHA256 != f.stage.ContentSHA256 ||
		file.Size != int64(len(f.body)) {
		t.Fatalf("new canonical File mismatch: %+v err=%v", file, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.NodeID == nil || *item.NodeID != node.ID ||
		item.ExternalID != f.stage.CurrentPathKey ||
		item.Path != localPushFirstLeafFixtureName ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("new local SourceItem was invalid or falsely synced: %+v err=%v", item, err)
	}
	var hold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
		hold.ReleasedAt == nil || hold.CommittedAt == nil ||
		hold.CommittedNodeID == nil || *hold.CommittedNodeID != node.ID {
		t.Fatalf("quota hold was not atomically transferred: %+v err=%v", hold, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&stage).Error; err != nil ||
		stage.Status != localPushStageCommitted {
		t.Fatalf("Stage not terminal after SQL commit: %+v err=%v", stage, err)
	}
	usage, err := f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
	if err != nil || usage.PhysicalUsedBytes != int64(len(f.body)) || usage.ReservedBytes != 0 {
		t.Fatalf("quota hold was not exchanged for physical File usage: %+v err=%v", usage, err)
	}
	second, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !admitted || !second.Replayed ||
		second.NodeID != first.NodeID || second.SourceItemID != first.SourceItemID {
		t.Fatalf("lost-reply exact replay was not idempotent: %+v ok=%t err=%v", second, admitted, err)
	}
	var nodeCount, blobCount, itemCount, runCount int64
	if err := f.server.DB.Model(&meta.Node{}).
		Where("id = ?", first.NodeID).Count(&nodeCount).Error; err != nil || nodeCount != 1 {
		t.Fatalf("replay changed Node identity: %d err=%v", nodeCount, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobCount).Error; err != nil || blobCount != 1 {
		t.Fatalf("replay incremented CAS reference: %d err=%v", blobCount, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&itemCount).Error; err != nil || itemCount != 1 {
		t.Fatalf("replay duplicated SourceItem: %d err=%v", itemCount, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("private SQL writer created false successful SourceRun: %d err=%v", runCount, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("private writer activated Push: %+v err=%v", source, err)
	}
	reader, err := f.local.Open(context.Background(), f.casKey)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, f.body) {
		t.Fatalf("actual CAS bytes changed: read=%v close=%v", readErr, closeErr)
	}
}

func TestLocalPushFirstLeafPathClaimRejectsUnsafeNameOrSwitchedRoot(t *testing.T) {
	root := "11111111-1111-4111-8111-111111111111"
	key, err := localPushFirstLeafPathKey(root, "valid.jpg")
	if err != nil || !validLocalEvidenceDigest(key) {
		t.Fatalf("valid Root-scoped leaf failed: key=%q err=%v", key, err)
	}
	for _, invalid := range []string{
		"", ".", "..", "../outside.jpg", "nested/a.jpg",
		"/absolute.jpg", "bad\\name.jpg", "bad:name.jpg",
		"CON.txt", "trailing.", "trailing ", "bad\x00name",
	} {
		if got, err := localPushFirstLeafPathKey(root, invalid); err == nil || got != "" {
			t.Fatalf("unsafe leaf accepted %q: %q err=%v", invalid, got, err)
		}
	}
	other, err := localPushFirstLeafPathKey(
		"22222222-2222-4222-8222-222222222222", "valid.jpg",
	)
	if err != nil || other == key {
		t.Fatalf("Root swap did not change identity key: %q err=%v", other, err)
	}
	f := makeLocalPushFirstFileCommitFixture(t)
	if _, ok, err := f.commitFirstLeaf("different.jpg"); ok || err == nil {
		t.Fatalf("different leaf name bypassed bound path key: ok=%t err=%v", ok, err)
	}
}

func TestLocalPushFirstLeafCommitDeniesTamperingAndNameCollision(t *testing.T) {
	for _, variant := range []string{"foreign-token", "revoked", "stage-canceled", "quota-released", "blob-present", "name-collision", "quota-downgrade"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushFirstFileCommitFixture(t)
			switch variant {
			case "foreign-token":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-native-secret")
			case "revoked":
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", f.stage.CreatedAt).Error; err != nil {
					t.Fatal(err)
				}
			case "stage-canceled":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("status", localPushStageCanceled).Error; err != nil {
					t.Fatal(err)
				}
			case "quota-released":
				if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("released_at", f.stage.CreatedAt).Error; err != nil {
					t.Fatal(err)
				}
			case "blob-present":
				if err := f.server.DB.Create(&meta.ContentBlob{
					SHA256: f.stage.ContentSHA256, StorageKey: f.casKey,
					Size: f.stage.TotalSize, RefCount: 0, State: meta.ContentBlobStateDeleting,
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "name-collision":
				if err := f.server.DB.Create(&meta.Node{
					ParentID: &f.stage.TargetNodeID, OwnerID: f.stage.OwnerID,
					Name: strings.ToUpper(localPushFirstLeafFixtureName),
					Type: meta.NodeTypeFile, Revision: 1,
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "quota-downgrade":
				setLocalPushQuotaFixture(t, f, f.stage.TotalSize-1)
			}
			_, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
			if admitted || err == nil {
				t.Fatalf("%s allowed an unauthorized canonical writer: admitted=%t err=%v", variant, admitted, err)
			}
			var count int64
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).
				Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s inserted SourceItem: %d err=%v", variant, count, err)
			}
			var saved meta.LocalPushQuotaHold
			if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&saved).Error; err != nil ||
				saved.CommittedNodeID != nil {
				t.Fatalf("%s committed quota hold: %+v err=%v", variant, saved, err)
			}
		})
	}
}

func TestLocalPushFirstLeafCommitBusyOrPostCommitPhysicalDrift(t *testing.T) {
	for _, variant := range []string{"busy", "late-drift"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushFirstFileCommitFixture(t)
			failedAfterCommit := errors.New("synthetic physical drift")
			called := 0
			_, admitted, err := f.server.commitBoundLocalPushFirstLeafWithInspector(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, localPushFirstLeafFixtureName,
				func(ctx context.Context, stageKey, casKey string, size int64,
					callback func(context.Context) error) (bool, error) {
					called++
					if variant == "busy" {
						return false, nil
					}
					if err := callback(ctx); err != nil {
						return false, err
					}
					return false, failedAfterCommit
				},
			)
			if admitted || called != 1 {
				t.Fatalf("%s admitted a synthetic inspection: admitted=%t called=%d", variant, admitted, called)
			}
			if variant == "busy" && err != nil {
				t.Fatalf("busy OS pin should return false,nil: %v", err)
			}
			if variant == "late-drift" && !errors.Is(err, failedAfterCommit) {
				t.Fatalf("late physical mismatch was hidden: %v", err)
			}
			var nodeCount int64
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).Count(&nodeCount).Error; err != nil {
				t.Fatal(err)
			}
			if variant == "busy" && nodeCount != 0 {
				t.Fatalf("busy physical admission wrote canonical metadata: %d", nodeCount)
			}
			if variant == "late-drift" {
				if nodeCount != 1 {
					t.Fatalf("late physical drift must retain committed data for reconciliation: %d", nodeCount)
				}
				replay, ok, replayErr := f.commitFirstLeaf(localPushFirstLeafFixtureName)
				if !ok || replayErr != nil || !replay.Replayed {
					t.Fatalf("late negative result duplicated/lost SQL receipt: %+v admitted=%t err=%v",
						replay, ok, replayErr)
				}
			}
		})
	}
}

func TestLocalPushFirstLeafCommittedStageCannotBeCanceled(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	first, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !admitted || first.NodeID == 0 {
		t.Fatalf("initial private commit failed: %+v ok=%t err=%v", first, admitted, err)
	}
	bindLocalStageCancelTestRoute(f)
	f.server.cancelLocalPushStage(f.ctx)
	if f.ctx.Writer.Status() == http.StatusNoContent {
		t.Fatal("committed Stage was canceled, risking canonical CAS")
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).
		Take(&stage).Error; err != nil || stage.Status != localPushStageCommitted {
		t.Fatalf("committed Stage status lost: %+v err=%v", stage, err)
	}
}

func TestLocalPushFirstLeafSQLFailureRollsBackAllCanonicalReferences(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	// An independent PostgreSQL trigger forces a failure AFTER the blob,
	// Node and File inserts but BEFORE the SourceItem can be committed.
	// Rollback must retain the live booked quota hold and original Stage.
	if err := f.server.DB.Exec(`CREATE FUNCTION reject_local_push_source_item() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'synthetic SourceItem persistence failure'; END;
$$ LANGUAGE plpgsql`).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Exec(`CREATE TRIGGER reject_local_push_source_item_before_insert
BEFORE INSERT ON xd_source_items FOR EACH ROW
EXECUTE FUNCTION reject_local_push_source_item()`).Error; err != nil {
		t.Fatal(err)
	}
	_, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if admitted || err == nil {
		t.Fatalf("forced SourceItem failure committed a partial file: admitted=%t err=%v", admitted, err)
	}
	var blobCount, fileCount, nodeCount, sourceItemCount int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobCount).Error; err != nil || blobCount != 0 {
		t.Fatalf("SQL rollback left Blob ref: %d err=%v", blobCount, err)
	}
	if err := f.server.DB.Model(&meta.File{}).Count(&fileCount).Error; err != nil || fileCount != 0 {
		t.Fatalf("SQL rollback left File: %d err=%v", fileCount, err)
	}
	if err := f.server.DB.Model(&meta.Node{}).
		Where("name = ?", localPushFirstLeafFixtureName).
		Count(&nodeCount).Error; err != nil || nodeCount != 0 {
		t.Fatalf("SQL rollback left new Node: %d err=%v", nodeCount, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&sourceItemCount).Error; err != nil ||
		sourceItemCount != 0 {
		t.Fatalf("SQL rollback left SourceItem: %d err=%v", sourceItemCount, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&stage).Error; err != nil ||
		stage.Status != localPushStageReady {
		t.Fatalf("SQL rollback changed Stage state: %+v err=%v", stage, err)
	}
	var hold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
		hold.ReleasedAt != nil || hold.CommittedNodeID != nil {
		t.Fatalf("SQL rollback released quota or recorded a receipt: %+v err=%v", hold, err)
	}
	if err := f.server.DB.Exec("DROP TRIGGER reject_local_push_source_item_before_insert ON xd_source_items").Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Exec("DROP FUNCTION reject_local_push_source_item()").Error; err != nil {
		t.Fatal(err)
	}
	result, ok, retryErr := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if !ok || retryErr != nil || result.Replayed || result.NodeID == 0 {
		t.Fatalf("rollback left state incapable of safe retry: result=%+v admitted=%t err=%v", result, ok, retryErr)
	}
}
