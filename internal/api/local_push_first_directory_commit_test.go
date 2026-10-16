package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

func (f localPushExistingCASTestFixture) firstDirectory(
	name string,
) (localPushFirstDirectoryCommitResult, bool, error) {
	return f.server.commitBoundLocalPushFirstDirectory(
		f.ctx, f.source.ID, f.source.Revision, f.proof, name,
	)
}

func TestLocalPushFirstDirectoryPersistsPendingExactIdentityAndReplays(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.FileVersion{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	const name = "Camera Roll"
	first, admitted, err := f.firstDirectory(name)
	if err != nil || !admitted || first.Replayed ||
		first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("private first folder commit failed: %+v admitted=%t err=%v", first, admitted, err)
	}
	key, err := localPushFirstDirectoryPathKey(f.proof.RootID, name)
	if err != nil {
		t.Fatal(err)
	}
	// Compare to native CURRENT identity format, not the file content hash.
	grant := localpush.RootGrant{SourceID: f.source.ID, RootID: f.proof.RootID}
	nativeKey, err := localpush.LocalInventoryPathKey(grant, "directory", name)
	if err != nil || key != nativeKey {
		t.Fatalf("directory identity differs from native Root key: %s != %s (%v)", key, nativeKey, err)
	}
	fileKind := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
		f.proof.RootID + "\x00file\x00" + name))
	if key == hex.EncodeToString(fileKind[:]) {
		t.Fatal("folder identity collided with a file path key")
	}
	var node meta.Node
	if err := f.server.DB.Where("id = ?", first.NodeID).Take(&node).Error; err != nil ||
		node.ParentID == nil || *node.ParentID != *f.source.TargetNodeID ||
		node.Name != name || node.Type != meta.NodeTypeDir ||
		node.OwnerID != f.device.OwnerID || node.Revision != 1 ||
		node.DeletedAt != nil {
		t.Fatalf("new cloud directory is invalid: %+v err=%v", node, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.SourceID != f.source.ID || item.ExternalID != key ||
		item.Kind != meta.SourceItemKindDirectory || item.Path != name ||
		item.NodeID == nil || *item.NodeID != node.ID ||
		item.NodeRevision != 1 || item.Size != 0 ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedRunID != "" || item.LastSyncedAt != nil {
		t.Fatalf("new SourceItem claims false backup completion: %+v err=%v", item, err)
	}
	again, ok, err := f.firstDirectory(name)
	if err != nil || !ok || !again.Replayed ||
		again.NodeID != first.NodeID || again.SourceItemID != first.SourceItemID {
		t.Fatalf("repeated private directory write did not preserve identity: %+v ok=%t err=%v", again, ok, err)
	}
	var sameNamedNodes, count, files, versions, runs int64
	if err := f.server.DB.Model(&meta.Node{}).Where(
		"parent_id = ? AND owner_id = ? AND name = ?",
		*f.source.TargetNodeID, f.device.OwnerID, name,
	).Count(&sameNamedNodes).Error; err != nil || sameNamedNodes != 1 {
		t.Fatalf("replay duplicated directory Node: %d %v", sameNamedNodes, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("replay duplicated SourceItem: %d %v", count, err)
	}
	if err := f.server.DB.Model(&meta.File{}).
		Count(&files).Error; err != nil || files != 0 {
		t.Fatalf("directory allocated file bytes: %d %v", files, err)
	}
	if err := f.server.DB.Model(&meta.FileVersion{}).
		Count(&versions).Error; err != nil || versions != 0 {
		t.Fatalf("directory created an old FileVersion: %d %v", versions, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("directory fabricated successful SourceRun: %d %v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused || source.Revision != f.source.Revision {
		t.Fatalf("private directory writer activated backup: %+v %v", source, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&stage).Error; err != nil ||
		stage.StageID != f.stage.StageID || stage.Status != f.stage.Status {
		t.Fatalf("directory creation modified unrelated first-file Stage: %+v %v", stage, err)
	}
	// The existing referenced CAS is neither retained again nor consumed.
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&blob).Error; err != nil ||
		blob.RefCount != 1 {
		t.Fatalf("folder creation modified content refs: %+v %v", blob, err)
	}
}

func TestLocalPushFirstDirectoryRejectsInvalidNamesAndRemoteOwnership(t *testing.T) {
	for _, tc := range []struct {
		name string
		path string
		set  func(*testing.T, localPushExistingCASTestFixture)
	}{
		{"empty", "", nil},
		{"parent", "..", nil},
		{"traversal", "../camera", nil},
		{"nested", "album/2026", nil},
		{"absolute", "/outside", nil},
		{"reserved", "CON", nil},
		{"trailing-dot", "folder.", nil},
		{"leading-parent", "./folder", nil},
		{"backslash", "a\\b", nil},
		{"casefold-collision", "ALBUM", func(t *testing.T, f localPushExistingCASTestFixture) {
			node := meta.Node{
				ParentID: f.source.TargetNodeID, OwnerID: f.device.OwnerID,
				Name: "album", Type: meta.NodeTypeFile, Revision: 1,
			}
			if err := f.server.DB.Create(&node).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"wrong-token", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-device-secret")
		}},
		{"other-device", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
				DeviceID: uuid.NewString(), RootID: f.proof.RootID,
				SourceRevision: f.proof.SourceRevision,
			})
		}},
		{"changed-root", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64))
		}},
		{"revoked", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			now := time.Now().UTC()
			if err := f.server.DB.Model(&meta.ClientDevice{}).
				Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"new-revision", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			if err := f.server.DB.Model(&meta.Source{}).
				Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"active-source", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			if err := f.server.DB.Model(&meta.Source{}).
				Where("id = ?", f.source.ID).Update("status", meta.SourceStatusActive).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"target-deleted", "album", func(t *testing.T, f localPushExistingCASTestFixture) {
			now := time.Now().UTC()
			if err := f.server.DB.Model(&meta.Node{}).
				Where("id = ?", *f.source.TargetNodeID).Update("deleted_at", &now).Error; err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := makeLocalPushExistingCASTestFixture(t)
			if tc.set != nil {
				tc.set(t, f)
			}
			got, admitted, err := f.firstDirectory(tc.path)
			if err == nil || admitted || got.NodeID != 0 || got.SourceItemID != 0 {
				t.Fatalf("%s escaped owning-device/Root/target checks: %+v admitted=%t err=%v",
					tc.name, got, admitted, err)
			}
			var count int64
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s wrote unauthorized SourceItem: count=%d err=%v", tc.name, count, err)
			}
		})
	}
}

func TestLocalPushFirstDirectoryReplayRefusesEditedOrPromotedItem(t *testing.T) {
	for _, mutation := range []string{"deleted-node", "wrong-node-revision", "synced-item", "wrong-path"} {
		t.Run(mutation, func(t *testing.T) {
			f := makeLocalPushExistingCASTestFixture(t)
			first, ok, err := f.firstDirectory("Verified")
			if err != nil || !ok {
				t.Fatalf("failed private directory fixture: %+v %v", first, err)
			}
			switch mutation {
			case "deleted-node":
				now := time.Now().UTC()
				err = f.server.DB.Model(&meta.Node{}).
					Where("id = ?", first.NodeID).Update("deleted_at", &now).Error
			case "wrong-node-revision":
				err = f.server.DB.Model(&meta.Node{}).
					Where("id = ?", first.NodeID).Update("revision", 2).Error
			case "synced-item":
				err = f.server.DB.Model(&meta.SourceItem{}).
					Where("id = ?", first.SourceItemID).Update("state", meta.SourceItemStateSynced).Error
			case "wrong-path":
				err = f.server.DB.Model(&meta.SourceItem{}).
					Where("id = ?", first.SourceItemID).Update("path", "Other").Error
			}
			if err != nil {
				t.Fatal(err)
			}
			got, admitted, err := f.firstDirectory("Verified")
			if err == nil || admitted || got.NodeID != 0 {
				t.Fatalf("%s promoted a mutated directory as replay: %+v admitted=%t %v",
					mutation, got, admitted, err)
			}
		})
	}
}

func TestLocalPushFirstDirectorySourceItemSQLFailureRollsBackNode(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	if err := f.server.DB.Exec("CREATE FUNCTION reject_local_first_dir_item() RETURNS trigger AS $$\n" +
		"BEGIN RAISE EXCEPTION 'synthetic local directory SourceItem failure'; END;\n" +
		"$$ LANGUAGE plpgsql").Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Exec("CREATE TRIGGER reject_local_first_dir_item_before_insert\n" +
		"BEFORE INSERT ON xd_source_items FOR EACH ROW\n" +
		"EXECUTE FUNCTION reject_local_first_dir_item()").Error; err != nil {
		t.Fatal(err)
	}
	if got, admitted, err := f.firstDirectory("Safe"); err == nil || admitted || got.NodeID != 0 {
		t.Fatalf("forced SourceItem failure committed a partial folder: %+v admitted=%t err=%v",
			got, admitted, err)
	}
	var nodes, items int64
	if err := f.server.DB.Model(&meta.Node{}).
		Where("parent_id = ? AND owner_id = ? AND name = ?",
			*f.source.TargetNodeID, f.device.OwnerID, "Safe").
		Count(&nodes).Error; err != nil || nodes != 0 {
		t.Fatalf("failed transaction left an orphaned directory: %d %v", nodes, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("failed transaction left a SourceItem: %d %v", items, err)
	}
	if err := f.server.DB.Exec("DROP TRIGGER reject_local_first_dir_item_before_insert ON xd_source_items").Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Exec("DROP FUNCTION reject_local_first_dir_item()").Error; err != nil {
		t.Fatal(err)
	}
	got, admitted, err := f.firstDirectory("Safe")
	if err != nil || !admitted || got.NodeID == 0 || got.Replayed {
		t.Fatalf("failed SQL transaction left directory retry unsafe: %+v admitted=%t %v",
			got, admitted, err)
	}
}
