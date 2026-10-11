//go:build linux

package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// ios27FilesWorkerEffect identifies a physical upload already selected by
// genuine Mobile or Wide Chromium. No new operation requests are synthesized.
type ios27FilesWorkerEffect struct {
	ID           uint64
	Revision     uint64
	SourceParent uint64
	TargetParent uint64
	Name         string
	Body         string
}

// assertIOS27FilesLiveWorkerEffects runs only AFTER the authentic browser
// created the operations and the existing PostgreSQL queue assertions passed.
// Real Worker execution, Gin downloads, Local CAS and Trash are mandatory.
func assertIOS27FilesLiveWorkerEffects(
	t *testing.T,
	srv *Server,
	db *gorm.DB,
	router *gin.Engine,
	apiURL, token string,
	ownerID uint64,
	copies, moves, deletes []ios27FilesWorkerEffect,
) {
	t.Helper()
	const expectedOperations = 12
	if len(copies) != 6 || len(moves) != 6 || len(deletes) != 6 {
		t.Fatalf("physical group sizes copy=%d move=%d delete=%d", len(copies), len(moves), len(deletes))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := clientpkg.New(apiURL, token)
	var beforeOperations []meta.FileOperation
	if err := db.Where("owner_id = ?", ownerID).Find(&beforeOperations).Error; err != nil {
		t.Fatal(err)
	}
	if len(beforeOperations) != expectedOperations {
		t.Fatalf("expected %d genuine UI queued operations, got %d", expectedOperations, len(beforeOperations))
	}
	for _, op := range beforeOperations {
		if op.Status != meta.FileOperationStatusQueued {
			t.Fatalf("browser operation was not queued before worker: %+v", op)
		}
	}
	var beforeBlobs int64
	if err := db.Model(&meta.ContentBlob{}).Count(&beforeBlobs).Error; err != nil {
		t.Fatal(err)
	}
	if beforeBlobs == 0 {
		t.Fatal("genuine physical CAS objects were not stored")
	}

	// Snapshot physical bytes before any copy, move, or soft-delete.
	originalFiles := make(map[uint64]meta.File)
	all := append(append(append([]ios27FilesWorkerEffect{}, copies...), moves...), deletes...)
	for _, spec := range all {
		if _, exists := originalFiles[spec.ID]; exists {
			continue // one source really was copied to two different destinations
		}
		var file meta.File
		if err := db.Where("node_id = ?", spec.ID).First(&file).Error; err != nil {
			t.Fatal(err)
		}
		if file.SHA256 == "" || file.StorageKey == "" || file.Size != int64(len(spec.Body)) {
			t.Fatalf("expected physical CAS upload for node %d: %+v", spec.ID, file)
		}
		originalFiles[spec.ID] = file
	}

	for i := 0; i < expectedOperations; i++ {
		processed, err := srv.processNextFileOperation(ctx)
		if err != nil || !processed {
			t.Fatalf("real Worker %d/%d processed=%v err=%v", i+1, expectedOperations, processed, err)
		}
	}
	if processed, err := srv.processNextFileOperation(ctx); err != nil || processed {
		t.Fatalf("worker should drain only the real UI queue: processed=%v err=%v", processed, err)
	}
	var finalOperations []meta.FileOperation
	if err := db.Where("owner_id = ?", ownerID).Find(&finalOperations).Error; err != nil {
		t.Fatal(err)
	}
	if len(finalOperations) != expectedOperations {
		t.Fatalf("unexpected worker operation count %d", len(finalOperations))
	}
	for _, op := range finalOperations {
		if op.Status != meta.FileOperationStatusCompleted || op.FinishedAt == nil ||
			op.ProcessedItems != op.TotalItems || op.ProcessedBytes != op.TotalBytes ||
			op.FailureCode != "" || op.Error != "" {
			t.Fatalf("browser operation did not complete after real worker: %+v", op)
		}
	}
	var foreignOperations int64
	if err := db.Model(&meta.FileOperation{}).Where("owner_id <> ?", ownerID).
		Count(&foreignOperations).Error; err != nil {
		t.Fatal(err)
	}
	if foreignOperations != 0 {
		t.Fatalf("foreign owner gained %d operations", foreignOperations)
	}

	download := func(id uint64, want string) {
		t.Helper()
		var data bytes.Buffer
		if err := client.DownloadTo(ctx, id, &data); err != nil {
			t.Fatalf("genuine Gin/Local CAS download node %d: %v", id, err)
		}
		if data.String() != want {
			t.Fatalf("actual downloaded bytes for node %d: got %q want %q", id, data.String(), want)
		}
	}
	load := func(id uint64) meta.Node {
		t.Helper()
		var node meta.Node
		if err := db.Preload("File").Where("id = ? AND owner_id = ?", id, ownerID).
			First(&node).Error; err != nil {
			t.Fatal(err)
		}
		return node
	}

	for _, spec := range copies {
		source := load(spec.ID)
		if source.DeletedAt != nil || source.ParentID == nil ||
			*source.ParentID != spec.SourceParent || source.Revision != spec.Revision ||
			source.Name != spec.Name {
			t.Fatalf("copy mutated source identity: %+v", source)
		}
		var dest []meta.Node
		if err := db.Preload("File").Where(
			"owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			ownerID, spec.TargetParent, spec.Name,
		).Find(&dest).Error; err != nil {
			t.Fatal(err)
		}
		if len(dest) != 1 || dest[0].ID == spec.ID || dest[0].File == nil || source.File == nil {
			t.Fatalf("copy lacked exactly one independent target node: %+v", dest)
		}
		want := originalFiles[spec.ID]
		if dest[0].File.SHA256 != want.SHA256 || dest[0].File.StorageKey != want.StorageKey ||
			dest[0].File.Size != want.Size {
			t.Fatalf("copy physical CAS identity changed: source=%+v dest=%+v", want, *dest[0].File)
		}
		download(dest[0].ID, spec.Body)
		download(spec.ID, spec.Body)
	}
	t.Logf("IOS27_FILES_REAL_WORKER_COPY_COMPLETED sources=%d actual_cas_downloads=%d", len(copies), 2*len(copies))

	for _, spec := range moves {
		node := load(spec.ID)
		if node.DeletedAt != nil || node.ParentID == nil ||
			*node.ParentID != spec.TargetParent || node.Revision != spec.Revision+1 ||
			node.Name != spec.Name || node.File == nil {
			t.Fatalf("move did not preserve exact Node ID/parent/revision: %+v", node)
		}
		want := originalFiles[spec.ID]
		if node.File.SHA256 != want.SHA256 || node.File.StorageKey != want.StorageKey ||
			node.File.Size != want.Size {
			t.Fatalf("move changed physical blob: source=%+v moved=%+v", want, *node.File)
		}
		download(spec.ID, spec.Body)
	}
	t.Logf("IOS27_FILES_REAL_WORKER_MOVE_COMPLETED sources=%d", len(moves))

	trash, err := client.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	trashIDs := make(map[uint64]bool, len(trash))
	for _, item := range trash {
		trashIDs[item.ID] = true
	}
	if len(trashIDs) != len(deletes) {
		t.Fatalf("want %d trashed Node IDs, found %d", len(deletes), len(trashIDs))
	}
	for _, spec := range deletes {
		node := load(spec.ID)
		if node.DeletedAt == nil || node.TrashRootID == nil ||
			*node.TrashRootID != spec.ID || node.ParentID == nil ||
			*node.ParentID != spec.SourceParent || node.Revision != spec.Revision+1 ||
			node.File == nil || !trashIDs[spec.ID] {
			t.Fatalf("soft delete failed to preserve Trash identity: %+v", node)
		}
		want := originalFiles[spec.ID]
		if node.File.SHA256 != want.SHA256 || node.File.StorageKey != want.StorageKey ||
			node.File.Size != want.Size {
			t.Fatalf("Trash lost physical CAS content: before=%+v after=%+v", want, *node.File)
		}
		request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d", spec.ID),
			token, nil, http.StatusNotFound)
		restored, err := client.RestoreTrash(ctx, spec.ID, node.Revision)
		if err != nil || restored.ID != spec.ID || restored.DeletedAt != nil ||
			restored.Revision <= node.Revision {
			t.Fatalf("Trash restore lost identity: %+v err=%v", restored, err)
		}
		reloaded := load(spec.ID)
		if reloaded.DeletedAt != nil || reloaded.TrashRootID != nil ||
			reloaded.ParentID == nil || *reloaded.ParentID != spec.SourceParent {
			t.Fatalf("restore did not return to original parent: %+v", reloaded)
		}
		download(spec.ID, spec.Body)
	}
	remaining, err := client.Trash(ctx)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("restored files should leave Trash empty: %+v err=%v", remaining, err)
	}
	var afterBlobs int64
	if err := db.Model(&meta.ContentBlob{}).Count(&afterBlobs).Error; err != nil {
		t.Fatal(err)
	}
	if afterBlobs != beforeBlobs {
		t.Fatalf("unexpected physical CAS blob count before=%d after=%d", beforeBlobs, afterBlobs)
	}
	t.Logf("IOS27_FILES_REAL_WORKER_DELETE_TRASH_RESTORE_COMPLETED sources=%d retained_cas_blobs=%d",
		len(deletes), afterBlobs)
}
