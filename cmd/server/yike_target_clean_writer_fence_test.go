package main

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A clean old Yike root must not move while an old upload or Files operation
// can still write to a stale NodeID, even though its ownership is verified.
func TestLegacyYikeCleanMigrationFencesUnfinishedOwnerWriters(t *testing.T) {
	for _, scenario := range []string{
		"active-upload", "queued-operation", "running-operation", "cancel-requested-operation",
	} {
		t.Run(scenario, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)

			photo := meta.Node{OwnerID: user.ID, ParentID: &target.ID,
				Name: "tracked.jpg", Type: meta.NodeTypeFile, Revision: 1}
			if err := db.Create(&photo).Error; err != nil {
				t.Fatal(err)
			}
			item := meta.SourceItem{SourceID: source.ID, ExternalID: "photo:tracked",
				NodeID: &photo.ID, NodeRevision: photo.Revision, Kind: meta.SourceItemKindFile,
				Path: photo.Name, State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC()}
			if err := db.Create(&item).Error; err != nil {
				t.Fatal(err)
			}
			direct := meta.Share{OwnerID: user.ID, NodeID: target.ID,
				TokenHash: strings.Repeat("a", 64), Access: "read_only"}
			if err := db.Create(&direct).Error; err != nil {
				t.Fatal(err)
			}

			var uploadID, operationID string
			if scenario == "active-upload" {
				uploadID = uuid.NewString()
				upload := meta.UploadSession{ID: uploadID, OwnerID: user.ID, ParentID: &target.ID,
					Status: meta.UploadStatusActive, TotalSize: 16, ChunkSize: 16, ChunkCount: 1,
					ExpiresAt: time.Now().Add(time.Hour)}
				if err := db.Create(&upload).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				operationID = uuid.NewString()
				status := meta.FileOperationStatusQueued
				switch scenario {
				case "running-operation":
					status = meta.FileOperationStatusRunning
				case "cancel-requested-operation":
					status = meta.FileOperationStatusCancelRequested
				}
				op := meta.FileOperation{ID: operationID, OwnerID: user.ID,
					Type: meta.FileOperationTypeMove, Status: status, ItemsJSON: "[]"}
				if err := db.Create(&op).Error; err != nil {
					t.Fatal(err)
				}
			}

			// Block before creating either canonical parent; leave the old
			// legacy root and all Shares, SourceItems and file identities in place.
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var oldRoot meta.Node
			var paused meta.Source
			var retained meta.SourceItem
			var retainedShare meta.Share
			for _, err := range []error{
				db.First(&oldRoot, target.ID).Error,
				db.First(&paused, source.ID).Error,
				db.First(&retained, item.ID).Error,
				db.First(&retainedShare, direct.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if paused.Status != meta.SourceStatusPaused || paused.TargetNodeID == nil ||
				*paused.TargetNodeID != target.ID || paused.Revision != source.Revision+1 ||
				oldRoot.ParentID == nil || *oldRoot.ParentID != connector.ID ||
				retained.NodeID == nil || *retained.NodeID != photo.ID ||
				retainedShare.NodeID != target.ID || retainedShare.TokenHash != direct.TokenHash {
				t.Fatalf("blocked clean relocation mutated identities: source=%+v root=%+v item=%+v share=%+v",
					paused, oldRoot, retained, retainedShare)
			}
			var canonicalCount int64
			if err := db.Model(&meta.Node{}).Where(
				"owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
				user.ID, root.ID, yikeTargetRootName,
			).Count(&canonicalCount).Error; err != nil {
				t.Fatal(err)
			}
			if canonicalCount != 0 {
				t.Fatal("blocked clean relocation created a canonical directory")
			}

			// Once the unfinished operation reaches a terminal state, retry
			// without revoking the old NodeID or direct Share token.
			if uploadID != "" {
				if err := db.Model(&meta.UploadSession{}).Where("id = ?", uploadID).
					Update("status", meta.UploadStatusFinalized).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				if err := db.Model(&meta.FileOperation{}).Where("id = ?", operationID).
					Update("status", meta.FileOperationStatusCompleted).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var moved meta.Node
			var directAfter meta.Share
			if err := db.First(&moved, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&directAfter, direct.ID).Error; err != nil {
				t.Fatal(err)
			}
			if moved.ParentID == nil || *moved.ParentID == connector.ID ||
				directAfter.NodeID != target.ID || directAfter.TokenHash != direct.TokenHash {
				t.Fatalf("clean retry changed root/share identities: root=%+v share=%+v", moved, directAfter)
			}
		})
	}
}

func TestLegacyYikeCleanMigrationIgnoresExpiredUploadAndTerminalOperation(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, _, connector, target, _ := createLegacyYikeMigrationFixture(t, db)
	expired := meta.UploadSession{ID: uuid.NewString(), OwnerID: user.ID, ParentID: &target.ID,
		Status: meta.UploadStatusActive, TotalSize: 10, ChunkSize: 10, ChunkCount: 1,
		ExpiresAt: time.Now().Add(-time.Minute)}
	op := meta.FileOperation{ID: uuid.NewString(), OwnerID: user.ID, Type: meta.FileOperationTypeMove,
		Status: meta.FileOperationStatusCompleted, ItemsJSON: "[]"}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&op).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var moved meta.Node
	if err := db.First(&moved, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if moved.ParentID == nil || *moved.ParentID == connector.ID {
		t.Fatalf("expired/terminal work incorrectly blocked migration: %+v", moved)
	}
}

// Ensure the test fixtures keep the PostgreSQL GORM adapter linked.
var _ *gorm.DB
