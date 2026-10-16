package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func makeCanonicalReusePart(f localPushExistingCASTestFixture) meta.UploadPart {
	return meta.UploadPart{
		SessionID:        uuid.NewString(),
		PartIndex:        0,
		Size:             int64(len(f.body)),
		SHA256:           f.stage.ContentSHA256,
		StorageKey:       ".xdrive-reuse/1/verified-cas/000000",
		Reused:           true,
		SourceStorageKey: f.casKey,
		SourceOffset:     0,
	}
}

func TestLocalPushCanonicalReuseWriterRejectsStaleCASAndBadParts(t *testing.T) {
	for _, variant := range []string{"valid", "missing-blob", "deleting-blob", "missing-file", "bad-part-boundary", "wrong-digest", "not-reused"} {
		t.Run(variant, func(t *testing.T) {
			f, first := localPushGCFirstLeafFixture(t)
			var source meta.File
			if err := f.server.DB.Where("node_id = ?", first.NodeID).Take(&source).Error; err != nil {
				t.Fatal(err)
			}
			part := makeCanonicalReusePart(f)
			switch variant {
			case "missing-blob":
				if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Delete(&meta.ContentBlob{}).Error; err != nil {
					t.Fatal(err)
				}
			case "deleting-blob":
				localPushGCMarkBlobInconsistent(t, f)
			case "missing-file":
				if err := f.server.DB.Where("node_id = ?", first.NodeID).Delete(&meta.File{}).Error; err != nil {
					t.Fatal(err)
				}
			case "bad-part-boundary":
				part.SourceOffset = source.Size
			case "wrong-digest":
				source.SHA256 = "0000000000000000000000000000000000000000000000000000000000000000"
			case "not-reused":
				part.Reused = false
			}
			err := f.server.DB.Transaction(func(tx *gorm.DB) error {
				return lockReusableUploadCASSourceTx(tx, &source, []meta.UploadPart{part})
			})
			if variant == "valid" && err != nil {
				t.Fatalf("live canonical reuse refused: %v", err)
			}
			if variant != "valid" && !errors.Is(err, errReusedUploadSourceChanged) {
				t.Fatalf("%s reused unavailable CAS: got %v", variant, err)
			}
			var runs int64
			if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("reuse preflight fabricated SourceRun: %d, %v", runs, err)
			}
		})
	}
}

func TestLocalPushReusedWriterCASHashSerializesPhysicalGC(t *testing.T) {
	f, first := localPushGCFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	var source meta.File
	if err := f.server.DB.Where("node_id = ?", first.NodeID).Take(&source).Error; err != nil {
		t.Fatal(err)
	}
	part := makeCanonicalReusePart(f)
	tx := f.server.DB.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := lockReusableUploadCASSourceTx(tx, &source, []meta.UploadPart{part}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Create(&part).Error; err != nil {
		t.Fatal(err)
	}
	// Model the source deletion/write transaction while its reusable-part
	// admission still holds the CAS hash. GC must see the part only AFTER
	// this transaction commits, never between a check and an insertion.
	if err := tx.Where("id = ?", first.SourceItemID).Delete(&meta.SourceItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Where("node_id = ?", first.NodeID).Delete(&meta.File{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", f.stage.ContentSHA256).
		Updates(map[string]any{
			"ref_count": int64(0),
			"state":     meta.ContentBlobStateDeleting,
		}).Error; err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		done <- f.server.finalizeContentBlobDeletes(context.Background(), localPushGCCandidate(f))
	}()
	<-started
	select {
	case err := <-done:
		t.Fatalf("GC completed while writer held canonical hash lock: %v", err)
	case <-time.After(120 * time.Millisecond):
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("GC failed after writer published reused part: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("GC did not finish after writer released hash lock")
	}
	localPushGCExpectPhysicalCAS(t, f)
	if err := f.server.DB.Delete(&part).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.finalizeContentBlobDeletes(context.Background(), localPushGCCandidate(f)); err != nil {
		t.Fatalf("GC blocked after reused part released: %v", err)
	}
}
