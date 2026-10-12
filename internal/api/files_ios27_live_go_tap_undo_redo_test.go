//go:build linux

package api

import (
	"bytes"
	"context"
	"testing"
	"time"

	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Four actual browser button taps enqueue authenticated Undo/Redo operations.
// The test endpoint merely runs the same production Worker: it does not
// manufacture any /api/v1 response or mutate any target outside that Worker.
func assertIOS27FilesLiveTapUndoRedo(
	t *testing.T, db *gorm.DB, apiURL, token string,
	ownerID uint64, operationIDs []string, beforeCAS int64,
	moved []ios27FilesWorkerEffect,
) {
	t.Helper()
	if len(operationIDs) != 4 || len(moved) != 2 {
		t.Fatalf("expected four UI taps and two physical moved files: taps=%d moved=%d",
			len(operationIDs), len(moved))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := clientpkg.New(apiURL, token)
	kinds := []string{
		meta.FileOperationTypeUndo, meta.FileOperationTypeRedo,
		meta.FileOperationTypeUndo, meta.FileOperationTypeRedo,
	}
	seen := make(map[string]bool, 4)
	for index, id := range operationIDs {
		if id == "" || seen[id] {
			t.Fatalf("UI tap %d has missing/repeated operation ID %q", index, id)
		}
		seen[id] = true
		op, err := client.GetFileOperation(ctx, id)
		if err != nil || op.Type != kinds[index] ||
			op.Status != meta.FileOperationStatusCompleted ||
			op.TotalItems != 2 || op.ProcessedItems != op.TotalItems ||
			op.FinishedAt == nil {
			t.Fatalf("UI tap %d task failed after real Worker: %+v err=%v", index, op, err)
		}
		if index > 0 && index%2 == 1 {
			if op.RedoOfID == nil || *op.RedoOfID != operationIDs[index-1] {
				t.Fatalf("real Redo must reference preceding clicked Undo: %+v", op)
			}
		}
		if index == 2 {
			if op.UndoOfID == nil || *op.UndoOfID != operationIDs[index-1] {
				t.Fatalf("Wide Undo must reference preceding Mobile Redo: %+v", op)
			}
		}
	}
	for _, expected := range moved {
		var node meta.Node
		if err := db.Preload("File").Where("id = ? AND owner_id = ?",
			expected.ID, ownerID).First(&node).Error; err != nil {
			t.Fatal(err)
		}
		if node.DeletedAt != nil || node.ParentID == nil ||
			*node.ParentID != expected.TargetParent ||
			node.Revision != expected.Revision+7 || node.File == nil {
			t.Fatalf("Mobile/Wide Undo/Redo changed moved Node identity: %+v", node)
		}
		var actual bytes.Buffer
		if err := client.DownloadTo(ctx, expected.ID, &actual); err != nil ||
			actual.String() != expected.Body {
			t.Fatalf("UI Undo/Redo damaged downloaded CAS bytes for %d: %q err=%v",
				expected.ID, actual.String(), err)
		}
	}
	var afterCAS int64
	if err := db.Model(&meta.ContentBlob{}).Count(&afterCAS).Error; err != nil {
		t.Fatal(err)
	}
	if afterCAS != beforeCAS {
		t.Fatalf("physical CAS objects changed after real UI taps: %d to %d", beforeCAS, afterCAS)
	}
	if trash, err := client.Trash(ctx); err != nil || len(trash) != 0 {
		t.Fatalf("Mobile/Wide Undo/Redo left Trash content: %+v err=%v", trash, err)
	}
	var foreign int64
	if err := db.Model(&meta.FileOperation{}).Where("owner_id <> ?", ownerID).
		Count(&foreign).Error; err != nil || foreign != 0 {
		t.Fatalf("UI tap operation crossed owner boundary: %d err=%v", foreign, err)
	}
	var pending int64
	if err := db.Model(&meta.FileOperation{}).Where("status IN ?",
		[]string{meta.FileOperationStatusQueued, meta.FileOperationStatusRunning}).
		Count(&pending).Error; err != nil || pending != 0 {
		t.Fatalf("UI taps left unprocessed tasks: %d err=%v", pending, err)
	}
	t.Logf("IOS27_FILES_REAL_MOBILE_WIDE_TAP_UNDO_REDO_COMPLETED taps=4 moved_nodes=2 physical_cas_stable=true")
}
