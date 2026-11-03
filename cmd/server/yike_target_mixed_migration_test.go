package main

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func setupLegacyYikeFlatMixed(t *testing.T, db *gorm.DB) (meta.User, meta.Node, meta.Node, meta.SourceItem, meta.Source) {
	t.Helper()
	user, _, _, oldRoot, source := createLegacyYikeMigrationFixture(t, db)
	oldRootID := oldRoot.ID
	photo := meta.Node{OwnerID: user.ID, ParentID: &oldRootID, Name: "tracked.jpg", Type: meta.NodeTypeFile, Revision: 1}
	ordinary := meta.Node{OwnerID: user.ID, ParentID: &oldRootID, Name: "ordinary.pdf", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&photo).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "yike:12345:photo", NodeID: &photo.ID,
		NodeRevision: photo.Revision, Kind: meta.SourceItemKindFile, Path: photo.Name,
		State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	return user, oldRoot, ordinary, item, source
}

func TestLegacyYikeFlatMixedSplitPreservesDirectSharesAndCAS(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, oldRoot, ordinary, item, source := setupLegacyYikeFlatMixed(t, db)
	photoID := *item.NodeID
	rootShare := meta.Share{OwnerID: user.ID, NodeID: oldRoot.ID,
		TokenHash: strings.Repeat("d", 64), Access: "read_only"}
	childShare := meta.Share{OwnerID: user.ID, NodeID: photoID,
		TokenHash: strings.Repeat("e", 64), Access: "read_only"}
	file := meta.File{NodeID: photoID, Size: 8, StorageKey: "blobs/current", SHA256: strings.Repeat("a", 64)}
	version := meta.FileVersion{NodeID: photoID, Revision: 1, Size: 7,
		StorageKey: "blobs/history", SHA256: strings.Repeat("b", 64)}
	for _, err := range []error{
		db.Create(&rootShare).Error, db.Create(&childShare).Error,
		db.Create(&file).Error, db.Create(&version).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var oldAfter, ordinaryAfter, photoAfter meta.Node
	var sourceAfter meta.Source
	var itemAfter meta.SourceItem
	var rootShareAfter, childShareAfter meta.Share
	var fileAfter meta.File
	var versionAfter meta.FileVersion
	for _, err := range []error{
		db.First(&oldAfter, oldRoot.ID).Error,
		db.First(&ordinaryAfter, ordinary.ID).Error,
		db.First(&photoAfter, photoID).Error,
		db.First(&sourceAfter, source.ID).Error,
		db.First(&itemAfter, item.ID).Error,
		db.First(&rootShareAfter, rootShare.ID).Error,
		db.First(&childShareAfter, childShare.ID).Error,
		db.First(&fileAfter, file.NodeID).Error,
		db.First(&versionAfter, version.ID).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if sourceAfter.TargetNodeID == nil || *sourceAfter.TargetNodeID == oldRoot.ID ||
		sourceAfter.Revision != source.Revision+1 || !sourceAfter.TargetManaged ||
		oldAfter.ParentID == nil || *oldAfter.ParentID != *oldRoot.ParentID ||
		ordinaryAfter.ParentID == nil || *ordinaryAfter.ParentID != oldRoot.ID ||
		photoAfter.ParentID == nil || *photoAfter.ParentID != *sourceAfter.TargetNodeID ||
		photoAfter.Revision != 2 || itemAfter.NodeID == nil ||
		*itemAfter.NodeID != photoID || itemAfter.NodeRevision != 2 ||
		itemAfter.Path != item.Path {
		t.Fatalf("mixed split changed old root or verified child identity: source=%+v root=%+v ordinary=%+v photo=%+v item=%+v",
			sourceAfter, oldAfter, ordinaryAfter, photoAfter, itemAfter)
	}
	if rootShareAfter.NodeID != oldRoot.ID || rootShareAfter.TokenHash != rootShare.TokenHash ||
		rootShareAfter.RevokedAt != nil || childShareAfter.NodeID != photoID ||
		childShareAfter.TokenHash != childShare.TokenHash || childShareAfter.RevokedAt != nil ||
		fileAfter.StorageKey != file.StorageKey || versionAfter.StorageKey != version.StorageKey {
		t.Fatalf("Share, FileVersion or CAS identity changed during split")
	}
	var newRoot meta.Node
	if err := db.First(&newRoot, *sourceAfter.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if newRoot.ID == oldRoot.ID || newRoot.Name != oldRoot.Name || newRoot.ParentID == nil {
		t.Fatalf("invalid server-created managed root: %+v", newRoot)
	}
	var connector meta.Node
	if err := db.First(&connector, *newRoot.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if connector.Name != yikeTargetConnectorName || connector.ParentID == nil {
		t.Fatalf("invalid canonical connector: %+v", connector)
	}
	var syncRoot meta.Node
	if err := db.First(&syncRoot, *connector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if syncRoot.Name != yikeTargetRootName {
		t.Fatalf("invalid canonical root: %+v", syncRoot)
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var afterRetry meta.Source
	if err := db.First(&afterRetry, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterRetry.TargetNodeID == nil || *afterRetry.TargetNodeID != *sourceAfter.TargetNodeID ||
		afterRetry.Revision != sourceAfter.Revision {
		t.Fatalf("second startup duplicated target or source revision: %+v", afterRetry)
	}
}

func TestLegacyYikeFlatMixedSplitRejectsConcurrentWorkOrForeignClaims(t *testing.T) {
	for _, scenario := range []string{"upload", "batch", "foreign-source", "occupied"} {
		t.Run(scenario, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, oldRoot, _, item, source := setupLegacyYikeFlatMixed(t, db)
			switch scenario {
			case "upload":
				op := meta.UploadSession{ID: uuid.NewString(), OwnerID: user.ID,
					ParentID: &oldRoot.ID, Status: meta.UploadStatusActive,
					TotalSize: 8, ChunkSize: 8, ChunkCount: 1,
					ExpiresAt: time.Now().Add(time.Hour)}
				if err := db.Create(&op).Error; err != nil {
					t.Fatal(err)
				}
			case "batch":
				op := meta.FileOperation{ID: uuid.NewString(), OwnerID: user.ID,
					Type: meta.FileOperationTypeMove, Status: meta.FileOperationStatusQueued,
					ItemsJSON: "[]", CreatedAt: time.Now().UTC()}
				if err := db.Create(&op).Error; err != nil {
					t.Fatal(err)
				}
			case "foreign-source":
				other := meta.Source{OwnerID: user.ID, Name: "Other",
					Kind: "synology_files", Direction: meta.SourceDirectionPull,
					SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
					Status: meta.SourceStatusPaused, Revision: 1}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
				claim := meta.SourceItem{SourceID: other.ID, ExternalID: "foreign",
					NodeID: item.NodeID, NodeRevision: 1, Kind: meta.SourceItemKindFile,
					Path: item.Path, State: meta.SourceItemStateSynced,
					LastSeenAt: time.Now().UTC()}
				if err := db.Create(&claim).Error; err != nil {
					t.Fatal(err)
				}
			case "occupied":
				var ownerRoot meta.Node
				if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).
					Take(&ownerRoot).Error; err != nil {
					t.Fatal(err)
				}
				syncRoot, err := ensureMigrationDirectory(db, user.ID, ownerRoot.ID, yikeTargetRootName)
				if err != nil {
					t.Fatal(err)
				}
				connector, err := ensureMigrationDirectory(db, user.ID, syncRoot.ID, yikeTargetConnectorName)
				if err != nil {
					t.Fatal(err)
				}
				occupied := meta.Node{OwnerID: user.ID, ParentID: &connector.ID,
					Name: oldRoot.Name, Type: meta.NodeTypeDir, Revision: 1}
				if err := db.Create(&occupied).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var paused meta.Source
			var still meta.Node
			if err := db.First(&paused, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&still, oldRoot.ID).Error; err != nil {
				t.Fatal(err)
			}
			if paused.Status != meta.SourceStatusPaused || paused.TargetNodeID == nil ||
				*paused.TargetNodeID != oldRoot.ID || still.ParentID == nil ||
				*still.ParentID != *oldRoot.ParentID {
				t.Fatalf("blocked migration changed old Source or root: source=%+v root=%+v", paused, still)
			}
		})
	}
}
