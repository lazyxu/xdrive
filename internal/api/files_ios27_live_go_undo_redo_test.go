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

// F09I-D4 verifies authenticated Undo/Redo of original operations created by
// real Mobile/Wide Chromium. The test does not forge the original queue or
// claim that these Undo/Redo actions were clicked inside the browser.
func assertIOS27FilesLiveUndoRedo(
	t *testing.T,
	srv *Server,
	db *gorm.DB,
	router *gin.Engine,
	apiURL, token, foreignToken string,
	ownerID uint64,
	copySources, moveSources []ios27FilesWorkerEffect,
) {
	t.Helper()
	if len(copySources) != 2 || len(moveSources) != 2 {
		t.Fatal("need two genuine Mobile Copy and two genuine Wide Move sources")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	client := clientpkg.New(apiURL, token)

	var beforeBlobs int64
	if err := db.Model(&meta.ContentBlob{}).Count(&beforeBlobs).Error; err != nil {
		t.Fatal(err)
	}

	// Each target/type pair identifies exactly one real two-item Chromium
	// operation: never enqueue an artificial Copy or Move in this function.
	for _, spec := range []struct {
		kind    string
		sources []ios27FilesWorkerEffect
	}{
		{kind: meta.FileOperationTypeCopy, sources: copySources},
		{kind: meta.FileOperationTypeMove, sources: moveSources},
	} {
		targetID := spec.sources[0].TargetParent
		if targetID == 0 || spec.sources[1].TargetParent != targetID {
			t.Fatalf("%s two selected sources have different targets", spec.kind)
		}
		var originals []meta.FileOperation
		if err := db.Where("owner_id = ? AND type = ? AND total_items = ? AND parent_id = ?",
			ownerID, spec.kind, 2, targetID).Find(&originals).Error; err != nil {
			t.Fatal(err)
		}
		if len(originals) != 1 {
			t.Fatalf("%s: expected exactly one real browser two-source operation, found %d",
				spec.kind, len(originals))
		}
		original := originals[0]
		if original.Status != meta.FileOperationStatusCompleted ||
			!toFileOperationDTO(original).Undoable || original.UndoPlanJSON == "" {
			t.Fatalf("%s: genuine completed browser operation is not undoable: %+v",
				spec.kind, original)
		}
		refs, err := decodeFileOperationRefs(original.ItemsJSON)
		if err != nil || len(refs) != 2 || refs[0].ID == refs[1].ID {
			t.Fatalf("%s: expected two distinct pinned refs: %+v err=%v", spec.kind, refs, err)
		}
		seen := make(map[uint64]bool, len(refs))
		for _, ref := range refs {
			match := false
			for _, source := range spec.sources {
				if source.ID == ref.ID && source.Revision == ref.Revision {
					match = true
					break
				}
			}
			if !match || seen[ref.ID] {
				t.Fatalf("%s: browser refs were mixed or stale: %+v", spec.kind, refs)
			}
			seen[ref.ID] = true
		}

		// A foreign signed-in owner must not inspect, Undo, or Redo the
		// legitimate owner's operation, despite knowing its exact UUID.
		request(t, router, http.MethodPost,
			fmt.Sprintf("/api/v1/file-operations/%s/undo", original.ID),
			foreignToken, nil, http.StatusNotFound)
		var copiedNodeIDs map[uint64]uint64
		if spec.kind == meta.FileOperationTypeCopy {
			copiedNodeIDs = make(map[uint64]uint64, len(spec.sources))
			for _, source := range spec.sources {
				var nodes []meta.Node
				if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
					ownerID, source.TargetParent, source.Name).Find(&nodes).Error; err != nil {
					t.Fatal(err)
				}
				if len(nodes) != 1 || nodes[0].ID == source.ID {
					t.Fatalf("copy target must have independent real Node ID: %+v", nodes)
				}
				copiedNodeIDs[source.ID] = nodes[0].ID
			}
		}

		undo, err := client.UndoFileOperation(ctx, original.ID)
		if err != nil || undo.Type != meta.FileOperationTypeUndo ||
			undo.Status != meta.FileOperationStatusQueued ||
			undo.UndoOfID == nil || *undo.UndoOfID != original.ID {
			t.Fatalf("%s: real HTTP Undo was not queued: %+v err=%v", spec.kind, undo, err)
		}
		if done, err := srv.processNextFileOperation(ctx); err != nil || !done {
			t.Fatalf("%s: production Undo Worker failed: done=%v err=%v", spec.kind, done, err)
		}
		undo, err = client.GetFileOperation(ctx, undo.ID)
		if err != nil || undo.Status != meta.FileOperationStatusCompleted || !undo.Redoable {
			t.Fatalf("%s: HTTP Undo did not complete with Redo capability: %+v err=%v",
				spec.kind, undo, err)
		}
		originalAfterUndo, err := client.GetFileOperation(ctx, original.ID)
		if err != nil || originalAfterUndo.UndoneByID == nil ||
			*originalAfterUndo.UndoneByID != undo.ID || originalAfterUndo.Undoable {
			t.Fatalf("%s: original Undo lineage/availability is incorrect: %+v err=%v",
				spec.kind, originalAfterUndo, err)
		}
		for _, source := range spec.sources {
			if spec.kind == meta.FileOperationTypeCopy {
				var copied meta.Node
				if err := db.Where("id = ? AND owner_id = ?",
					copiedNodeIDs[source.ID], ownerID).First(&copied).Error; err != nil {
					t.Fatal(err)
				}
				if copied.DeletedAt == nil || copied.Revision != 2 {
					t.Fatalf("Undo Copy did not soft-delete exact copied Node: %+v", copied)
				}
			} else {
				var moved meta.Node
				if err := db.Where("id = ? AND owner_id = ?", source.ID, ownerID).
					First(&moved).Error; err != nil {
					t.Fatal(err)
				}
				if moved.DeletedAt != nil || moved.ParentID == nil ||
					*moved.ParentID != source.SourceParent ||
					moved.Revision != source.Revision+2 {
					t.Fatalf("Undo Move lost original Node or parent: %+v", moved)
				}
			}
		}

		request(t, router, http.MethodPost,
			fmt.Sprintf("/api/v1/file-operations/%s/redo", undo.ID),
			foreignToken, nil, http.StatusNotFound)
		redo, err := client.RedoFileOperation(ctx, undo.ID)
		if err != nil || redo.Type != meta.FileOperationTypeRedo ||
			redo.Status != meta.FileOperationStatusQueued ||
			redo.RedoOfID == nil || *redo.RedoOfID != undo.ID {
			t.Fatalf("%s: real HTTP Redo was not queued: %+v err=%v", spec.kind, redo, err)
		}
		if done, err := srv.processNextFileOperation(ctx); err != nil || !done {
			t.Fatalf("%s: production Redo Worker failed: done=%v err=%v", spec.kind, done, err)
		}
		redo, err = client.GetFileOperation(ctx, redo.ID)
		if err != nil || redo.Status != meta.FileOperationStatusCompleted || !redo.Undoable {
			t.Fatalf("%s: HTTP Redo did not complete with Undo capability: %+v err=%v",
				spec.kind, redo, err)
		}
		undoAfterRedo, err := client.GetFileOperation(ctx, undo.ID)
		if err != nil || undoAfterRedo.RedoneByID == nil ||
			*undoAfterRedo.RedoneByID != redo.ID || undoAfterRedo.Redoable {
			t.Fatalf("%s: Undo Redo lineage/availability is incorrect: %+v err=%v",
				spec.kind, undoAfterRedo, err)
		}
		for _, source := range spec.sources {
			nodeID := source.ID
			if spec.kind == meta.FileOperationTypeCopy {
				nodeID = copiedNodeIDs[source.ID]
			}
			var node meta.Node
			if err := db.Preload("File").Where("id = ? AND owner_id = ?", nodeID, ownerID).
				First(&node).Error; err != nil {
				t.Fatal(err)
			}
			if node.DeletedAt != nil || node.ParentID == nil ||
				*node.ParentID != source.TargetParent || node.File == nil {
				t.Fatalf("%s Redo did not recover exact file identity/parent: %+v",
					spec.kind, node)
			}
			if spec.kind == meta.FileOperationTypeCopy && node.Revision != 3 {
				t.Fatalf("Redo Copy changed revision unexpectedly: %+v", node)
			}
			if spec.kind == meta.FileOperationTypeMove && node.Revision != source.Revision+3 {
				t.Fatalf("Redo Move changed revision unexpectedly: %+v", node)
			}
			var content bytes.Buffer
			if err := client.DownloadTo(ctx, nodeID, &content); err != nil ||
				content.String() != source.Body {
				t.Fatalf("%s Redo CAS bytes changed for %d: %q err=%v",
					spec.kind, nodeID, content.String(), err)
			}
		}
		t.Logf("IOS27_FILES_REAL_UNDO_REDO_COMPLETED kind=%s sources=2 authentic_http=true",
			spec.kind)
	}

	var afterBlobs int64
	if err := db.Model(&meta.ContentBlob{}).Count(&afterBlobs).Error; err != nil {
		t.Fatal(err)
	}
	if afterBlobs != beforeBlobs {
		t.Fatalf("Undo/Redo unexpectedly changed physical CAS blob count: before=%d after=%d",
			beforeBlobs, afterBlobs)
	}
	if removed, err := client.Trash(ctx); err != nil || len(removed) != 0 {
		t.Fatalf("after Redo, temporary Undo trash must be empty: %+v err=%v", removed, err)
	}
	var foreignOperations int64
	if err := db.Model(&meta.FileOperation{}).Where("owner_id <> ?", ownerID).
		Count(&foreignOperations).Error; err != nil || foreignOperations != 0 {
		t.Fatalf("Undo/Redo crossed owner boundary: count=%d err=%v", foreignOperations, err)
	}
	t.Logf("IOS27_FILES_REAL_UNDO_REDO_CAS_VERIFIED operations=4 browser_source_operations=2")
}
