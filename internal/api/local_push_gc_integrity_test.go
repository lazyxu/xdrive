package api

import (
	"context"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// L03-F2d8c3a: physical GC must never use an inconsistent/absent
// ContentBlob row as permission to erase a surviving File or FileVersion.
// These tests use REAL PostgreSQL and Local Store, not a synthetic inspector.
// They do not create a SourceRun, activate local_folder or attest a crash.
func localPushGCFirstLeafFixture(t *testing.T) (localPushExistingCASTestFixture, localPushFirstFileCommitResult) {
	t.Helper()
	f := makeLocalPushFirstFileCommitFixture(t)
	receipt, ok, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !ok || receipt.NodeID == 0 || receipt.SourceItemID == 0 {
		t.Fatalf("first-file fixture commit: %+v ok=%t err=%v", receipt, ok, err)
	}
	return f, receipt
}

func localPushGCMarkBlobInconsistent(t *testing.T, f localPushExistingCASTestFixture) {
	t.Helper()
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Updates(map[string]any{
			"ref_count": int64(0),
			"state":     meta.ContentBlobStateDeleting,
		}).Error; err != nil {
		t.Fatal(err)
	}
}

func localPushGCCandidate(f localPushExistingCASTestFixture) []contentDeleteCandidate {
	return []contentDeleteCandidate{{SHA256: f.stage.ContentSHA256, StorageKey: f.casKey}}
}

func localPushGCExpectPhysicalCAS(t *testing.T, f localPushExistingCASTestFixture) {
	t.Helper()
	file, err := f.local.Open(context.Background(), f.casKey)
	if err != nil {
		t.Fatalf("GC deleted referenced canonical bytes: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushGCRejectsCorruptZeroRefcountWithLiveFirstFileAndReopens(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	localPushGCMarkBlobInconsistent(t, f)
	if err := f.server.finalizeContentBlobDeletes(context.Background(), localPushGCCandidate(f)); err == nil {
		t.Fatal("GC accepted zero-refcount metadata despite an existing canonical File")
	}
	localPushGCExpectPhysicalCAS(t, f)
	var saved meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&saved).Error; err != nil ||
		saved.RefCount != 0 || saved.State != meta.ContentBlobStateDeleting {
		t.Fatalf("GC unexpectedly rewrote inconsistent Blob metadata: %+v err=%v", saved, err)
	}
	// Simulate an explicitly audited metadata repair, not automatic healing.
	// Reopen an independent Local backend against the same filesystem root.
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Updates(map[string]any{"ref_count": int64(1), "state": meta.ContentBlobStateReady}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatal(err)
	}
	reopened, err := storage.NewLocal(f.local.FilesystemRoot())
	if err != nil {
		t.Fatal(err)
	}
	f.server.Store = reopened
	got, err := f.readFirstLeafPhysicalReceipt(localPushFirstLeafFixtureName)
	if err != nil || got.State != localPushFirstLeafPhysicalReceiptState ||
		got.NodeID != first.NodeID || got.SourceItemID != first.SourceItemID {
		t.Fatalf("reopened Local lost private historical physical receipt: %+v err=%v", got, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("GC/reopen test incorrectly synced SourceItem: %+v err=%v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("GC/reopen test fabricated a SourceRun: %d err=%v", runs, err)
	}
}

func TestLocalPushGCRejectsCorruptZeroRefcountWithOnlyFileVersion(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	if err := f.server.DB.Where("node_id = ?", first.NodeID).
		Delete(&meta.File{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Create(&meta.FileVersion{
		NodeID: first.NodeID, Revision: 1,
		Size: int64(len(f.body)), StorageKey: f.casKey, SHA256: f.stage.ContentSHA256,
	}).Error; err != nil {
		t.Fatal(err)
	}
	localPushGCMarkBlobInconsistent(t, f)
	if err := f.server.finalizeContentBlobDeletes(context.Background(), localPushGCCandidate(f)); err == nil {
		t.Fatal("GC deleted a blob with a surviving historical FileVersion")
	}
	localPushGCExpectPhysicalCAS(t, f)
}

func TestLocalPushUncommittedCleanupRejectsMissingBlobRowWithLiveFile(t *testing.T) {
	f, _ := localPushGCFirstLeafFixture(t)
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).
		Delete(&meta.ContentBlob{}).Error; err != nil {
		t.Fatal(err)
	}
	f.server.cleanupUncommittedContentBlob(context.Background(), f.stage.ContentSHA256, f.casKey)
	localPushGCExpectPhysicalCAS(t, f)
	// Mismatched key must also fail closed and cannot remove this object.
	f.server.cleanupUncommittedContentBlob(context.Background(), f.stage.ContentSHA256, "outside/canonical")
	localPushGCExpectPhysicalCAS(t, f)
}

func TestLocalPushGCAllowsDeletionAfterAllCanonicalFileReferencesGone(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	// Simulate the post-deletion state, not a user-facing/local Push delete:
	// the existing private historical quota receipt is not a forever pin.
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Delete(&meta.SourceItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("node_id = ?", first.NodeID).
		Delete(&meta.File{}).Error; err != nil {
		t.Fatal(err)
	}
	localPushGCMarkBlobInconsistent(t, f)
	// The isolated first-leaf fixture omits ordinary resumable upload
	// tables; the existing GC finalizer still must check reused parts.
	if err := f.server.DB.AutoMigrate(&meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.finalizeContentBlobDeletes(context.Background(), localPushGCCandidate(f)); err != nil {
		t.Fatalf("truly unreferenced GC was blocked: %v", err)
	}
	if file, err := f.local.Open(context.Background(), f.casKey); err == nil {
		_ = file.Close()
		t.Fatal("truly unreferenced CAS object remained after finalization")
	}
	var count int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unreferenced Blob row survived GC: count=%d err=%v", count, err)
	}
}

func TestLocalPushUncommittedCleanupPreservesActiveReusedUploadParts(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Delete(&meta.SourceItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("node_id = ?", first.NodeID).Delete(&meta.File{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Delete(&meta.ContentBlob{}).Error; err != nil {
		t.Fatal(err)
	}
	reused := meta.UploadPart{
		SessionID:        "11111111-1111-4111-8111-111111111111",
		PartIndex:        0,
		Size:             int64(len(f.body)),
		SHA256:           f.stage.ContentSHA256,
		StorageKey:       ".xdrive-reuse/1/missing-blob-session/000000",
		Reused:           true,
		SourceStorageKey: f.casKey,
	}
	if err := f.server.DB.Create(&reused).Error; err != nil {
		t.Fatal(err)
	}
	f.server.cleanupUncommittedContentBlob(context.Background(), f.stage.ContentSHA256, f.casKey)
	localPushGCExpectPhysicalCAS(t, f)
	if err := f.server.DB.Delete(&reused).Error; err != nil {
		t.Fatal(err)
	}
	f.server.cleanupUncommittedContentBlob(context.Background(), f.stage.ContentSHA256, f.casKey)
	if file, err := f.local.Open(context.Background(), f.casKey); err == nil {
		_ = file.Close()
		t.Fatal("unreferenced CAS remained after reused upload part released")
	} else if !os.IsNotExist(err) {
		t.Fatalf("unexpected post-cleanup CAS status: %v", err)
	}
	var runCount int64
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("cleanup fabricated backup run: %d err=%v", runCount, err)
	}
}

func TestLocalPushReaperConvergesWhenPhysicalDeletePrecedesSQLDelete(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Delete(&meta.SourceItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Where("node_id = ?", first.NodeID).Delete(&meta.File{}).Error; err != nil {
		t.Fatal(err)
	}
	localPushGCMarkBlobInconsistent(t, f)
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatal(err)
	}
	reopened, err := storage.NewLocal(f.local.FilesystemRoot())
	if err != nil {
		t.Fatal(err)
	}
	f.server.Store = reopened
	for i := 0; i < 2; i++ {
		if err := f.server.reapDeletingContentBlobs(context.Background()); err != nil {
			t.Fatalf("reaper retry %d failed: %v", i+1, err)
		}
	}
	var blobs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Where("sha256 = ?", f.stage.ContentSHA256).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("stale deleting Blob survived idempotent GC: count=%d err=%v", blobs, err)
	}
	if file, err := reopened.Open(context.Background(), f.casKey); err == nil {
		_ = file.Close()
		t.Fatal("physically deleted CAS was unexpectedly restored")
	} else if !os.IsNotExist(err) {
		t.Fatalf("unexpected post-GC CAS status: %v", err)
	}
}
