package api

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func (f localPushExistingCASTestFixture) readFirstLeafPhysicalReceipt(
	leaf string,
) (localPushFirstLeafSQLReceipt, error) {
	return f.server.readBoundLocalPushFirstLeafPhysicalReceipt(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID, leaf,
	)
}

func TestLocalPushFirstLeafPhysicalReceiptAfterStageReplacementAndExpiry(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	commit, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !ok || commit.NodeID == 0 || commit.SourceItemID == 0 {
		t.Fatalf("initial SQL commit failed: %+v ok=%t err=%v", commit, ok, err)
	}
	// A new Stage replaces this Source slot. The historical physical receipt
	// cannot read the replaced Stage, and MUST NOT depend on its expiry.
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
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatal(err)
	}
	db, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	got, err := f.readFirstLeafPhysicalReceipt(localPushFirstLeafFixtureName)
	if err != nil || got.State != localPushFirstLeafPhysicalReceiptState ||
		got.NodeID != commit.NodeID || got.SourceItemID != commit.SourceItemID {
		t.Fatalf("Stage-free physical CAS receipt invalid: %+v err=%v", got, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("physical observation fabricated SourceRun: %d err=%v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", commit.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("physical observation improperly marked SourceItem synced: %+v err=%v", item, err)
	}
}

func TestLocalPushFirstLeafPhysicalReceiptRejectsMissingOrCorruptCAS(t *testing.T) {
	for _, mutation := range []string{"missing", "corrupt", "renamed"} {
		t.Run(mutation, func(t *testing.T) {
			f := makeLocalPushFirstFileCommitFixture(t)
			commit, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
			if err != nil || !ok {
				t.Fatalf("initial SQL commit failed: %+v ok=%t err=%v", commit, ok, err)
			}
			switch mutation {
			case "missing":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			case "corrupt":
				full := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				data := bytes.Clone(f.body)
				data[len(data)/2] ^= 0x40
				if err := os.WriteFile(full, data, 0o600); err != nil {
					t.Fatal(err)
				}
			case "renamed":
				full := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				if err := os.Rename(full, full+".elsewhere"); err != nil {
					t.Fatal(err)
				}
			}
			sql, err := f.readFirstLeafSQLReceipt(localPushFirstLeafFixtureName)
			if err != nil || sql.State != localPushFirstLeafSQLReceiptState {
				t.Fatalf("missing/corrupt CAS invalidated SQL-only receipt semantics: %+v err=%v", sql, err)
			}
			physical, err := f.readFirstLeafPhysicalReceipt(localPushFirstLeafFixtureName)
			if err == nil || physical.State == localPushFirstLeafPhysicalReceiptState {
				t.Fatalf("%s CAS incorrectly verified: %+v err=%v", mutation, physical, err)
			}
		})
	}
}

func TestLocalPushFirstLeafPhysicalReceiptRejectsInvalidOwnerOrChangedSQL(t *testing.T) {
	for _, variant := range []string{"forged-credential", "root-fingerprint", "source-revision", "leaf", "blob", "item"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushFirstFileCommitFixture(t)
			if _, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName); !ok || err != nil {
				t.Fatalf("first file commit: ok=%t err=%v", ok, err)
			}
			leaf := localPushFirstLeafFixtureName
			switch variant {
			case "forged-credential":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-credential")
			case "root-fingerprint":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint",
					"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
			case "source-revision":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "leaf":
				leaf = "wrong-private-file.jpg"
			case "blob":
				if err := f.server.DB.Model(&meta.ContentBlob{}).
					Where("sha256 = ?", f.stage.ContentSHA256).
					Update("state", meta.ContentBlobStateDeleting).Error; err != nil {
					t.Fatal(err)
				}
			case "item":
				if err := f.server.DB.Model(&meta.SourceItem{}).
					Where("source_id = ?", f.source.ID).
					Update("state", meta.SourceItemStateSynced).Error; err != nil {
					t.Fatal(err)
				}
			}
			got, err := f.readFirstLeafPhysicalReceipt(leaf)
			if err == nil || got.State == localPushFirstLeafPhysicalReceiptState {
				t.Fatalf("%s unauthorized physical receipt: %+v err=%v", variant, got, err)
			}
		})
	}
}

func TestLocalPushFirstLeafPhysicalReceiptNeverTrustsBusyOrLateDrift(t *testing.T) {
	f := makeLocalPushFirstFileCommitFixture(t)
	if _, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName); !ok || err != nil {
		t.Fatalf("first-file commit: ok=%t err=%v", ok, err)
	}
	observerCalled := false
	got, err := f.server.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, localPushFirstLeafFixtureName,
		func(context.Context, string, int64, func(context.Context) error) (bool, error) {
			observerCalled = true
			return false, nil
		},
	)
	if err == nil || !observerCalled || got.State == localPushFirstLeafPhysicalReceiptState {
		t.Fatalf("busy CAS OS shard counted as verified: %+v called=%t err=%v", got, observerCalled, err)
	}

	sentinel := errors.New("late physical corruption")
	got, err = f.server.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, localPushFirstLeafFixtureName,
		func(ctx context.Context, key string, size int64, inside func(context.Context) error) (bool, error) {
			if err := inside(ctx); err != nil {
				return false, err
			}
			return false, sentinel
		},
	)
	if !errors.Is(err, sentinel) || got.State == localPushFirstLeafPhysicalReceiptState {
		t.Fatalf("post-SQL read physical drift counted as verified: %+v err=%v", got, err)
	}
	// A successful SQL-only diagnosis remains separately possible. Neither
	// failure can update canonical rows or activate local Push.
	sql, err := f.readFirstLeafSQLReceipt(localPushFirstLeafFixtureName)
	if err != nil || sql.State != localPushFirstLeafSQLReceiptState {
		t.Fatalf("SQL-only historical receipt regressed: %+v err=%v", sql, err)
	}
}
