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
	finished := time.Now().UTC()
	run := meta.SyncRun{ID: uuid.NewString(), SourceID: source.ID, SourceRevision: source.Revision,
		TargetNodeID: &oldRoot.ID, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusCompleted,
		StartedAt: finished.Add(-time.Minute), FinishedAt: &finished}
	for _, err := range []error{
		db.Create(&rootShare).Error, db.Create(&childShare).Error,
		db.Create(&file).Error, db.Create(&version).Error, db.Create(&run).Error,
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
	var runAfter meta.SyncRun
	for _, err := range []error{
		db.First(&oldAfter, oldRoot.ID).Error,
		db.First(&ordinaryAfter, ordinary.ID).Error,
		db.First(&photoAfter, photoID).Error,
		db.First(&sourceAfter, source.ID).Error,
		db.First(&itemAfter, item.ID).Error,
		db.First(&rootShareAfter, rootShare.ID).Error,
		db.First(&childShareAfter, childShare.ID).Error,
		db.First(&fileAfter, file.NodeID).Error,
		db.First(&versionAfter, version.ID).Error, db.Where("id = ?", run.ID).First(&runAfter).Error,
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
		fileAfter.StorageKey != file.StorageKey || versionAfter.StorageKey != version.StorageKey ||
		runAfter.TargetNodeID == nil || *runAfter.TargetNodeID != oldRoot.ID ||
		runAfter.SourceRevision != source.Revision {
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
	for _, scenario := range []string{"upload", "batch", "foreign-source", "foreign-root", "occupied"} {
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
			case "foreign-root":
				other := meta.Source{OwnerID: user.ID, Name: "Root tracker",
					Kind: "synology_files", Direction: meta.SourceDirectionPull,
					SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
					Status: meta.SourceStatusPaused, Revision: 1}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
				claim := meta.SourceItem{SourceID: other.ID, ExternalID: "old-root",
					NodeID: &oldRoot.ID, NodeRevision: oldRoot.Revision,
					Kind: meta.SourceItemKindDirectory, Path: "old-root",
					State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC()}
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

func TestLegacyYikeFlatMixedSplitRejectsForeignOwnerDirectChild(t *testing.T) {
	for _, kind := range []string{meta.NodeTypeFile, meta.NodeTypeDir} {
		t.Run(kind, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, oldRoot, ordinary, item, source := setupLegacyYikeFlatMixed(t, db)
			foreignUser := meta.User{
				Username: "migration-foreign-child-" + uuid.NewString(),
				PasswordHash: "x", Role: meta.UserRoleUser,
			}
			if err := db.Create(&foreignUser).Error; err != nil {
				t.Fatal(err)
			}
			// The production parent/Owner FK was installed NOT VALID to
			// preserve historical corrupt edges for fail-closed review.
			// Model an old cross-Owner edge in this isolated migration
			// fixture: an Owner-scoped child query must not hide it.
			alien := meta.Node{
				OwnerID: foreignUser.ID, ParentID: &oldRoot.ID,
				Name: "foreign-direct-" + kind, Type: kind, Revision: 1,
			}
			if err := db.Create(&alien).Error; err != nil {
				t.Fatal(err)
			}
			rootShare := meta.Share{
				OwnerID: user.ID, NodeID: oldRoot.ID,
				TokenHash: strings.Repeat("f", 64), Access: "read_only",
			}
			if err := db.Create(&rootShare).Error; err != nil {
				t.Fatal(err)
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatalf("malformed legacy Source must pause, not stop migration startup: %v", err)
			}
			var afterSource meta.Source
			var afterRoot, afterOrdinary, afterPhoto, afterAlien meta.Node
			var afterItem meta.SourceItem
			var afterShare meta.Share
			for _, err := range []error{
				db.First(&afterSource, source.ID).Error,
				db.First(&afterRoot, oldRoot.ID).Error,
				db.First(&afterOrdinary, ordinary.ID).Error,
				db.First(&afterPhoto, *item.NodeID).Error,
				db.First(&afterAlien, alien.ID).Error,
				db.First(&afterItem, item.ID).Error,
				db.First(&afterShare, rootShare.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if afterSource.Status != meta.SourceStatusPaused ||
				afterSource.LastError == "" ||
				afterSource.TargetNodeID == nil || *afterSource.TargetNodeID != oldRoot.ID ||
				afterRoot.ParentID == nil || *afterRoot.ParentID != *oldRoot.ParentID ||
				afterOrdinary.ParentID == nil || *afterOrdinary.ParentID != oldRoot.ID ||
				afterPhoto.ParentID == nil || *afterPhoto.ParentID != oldRoot.ID ||
				afterPhoto.Revision != 1 ||
				afterAlien.ParentID == nil || *afterAlien.ParentID != oldRoot.ID ||
				afterAlien.OwnerID != foreignUser.ID ||
				afterItem.NodeID == nil || *afterItem.NodeID != *item.NodeID ||
				afterItem.NodeRevision != item.NodeRevision ||
				afterShare.NodeID != rootShare.NodeID ||
				afterShare.TokenHash != rootShare.TokenHash {
				t.Fatalf("cross-Owner direct child was ignored or split mutated identities: source=%+v root=%+v ordinary=%+v photo=%+v alien=%+v item=%+v share=%+v",
					afterSource, afterRoot, afterOrdinary, afterPhoto, afterAlien, afterItem, afterShare)
			}
		})
	}
}

func TestLegacyYikeCleanTargetRejectsForeignOwnerDescendant(t *testing.T) {
	for _, tc := range []struct {
		name, foreignType string
		nested            bool
	}{
		{name: "direct foreign file", foreignType: meta.NodeTypeFile},
		{name: "nested foreign directory", foreignType: meta.NodeTypeDir, nested: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			owner, _, connector, target, source := createLegacyYikeMigrationFixture(t, db)
			photoParentID := target.ID
			photoPath := "photo.jpg"
			if tc.nested {
				album := meta.Node{
					OwnerID: owner.ID, ParentID: &target.ID,
					Name: "Album", Type: meta.NodeTypeDir, Revision: 1,
				}
				if err := db.Create(&album).Error; err != nil {
					t.Fatal(err)
				}
				photoParentID = album.ID
				photoPath = "Album/photo.jpg"
				albumClaim := meta.SourceItem{
					SourceID: source.ID, ExternalID: "legacy:album",
					NodeID: &album.ID, NodeRevision: album.Revision,
					Kind: meta.SourceItemKindDirectory, Path: album.Name,
					State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
				}
				if err := db.Create(&albumClaim).Error; err != nil {
					t.Fatal(err)
				}
			}
			photo := meta.Node{
				OwnerID: owner.ID, ParentID: &photoParentID,
				Name: "photo.jpg", Type: meta.NodeTypeFile, Revision: 1,
			}
			if err := db.Create(&photo).Error; err != nil {
				t.Fatal(err)
			}
			claim := meta.SourceItem{
				SourceID: source.ID, ExternalID: "legacy:photo",
				NodeID: &photo.ID, NodeRevision: photo.Revision,
				Kind: meta.SourceItemKindFile, Path: photoPath,
				State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
			}
			if err := db.Create(&claim).Error; err != nil {
				t.Fatal(err)
			}
			foreignOwner := meta.User{
				Username: "legacy-other-owner-" + uuid.NewString(),
				PasswordHash: "x", Role: meta.UserRoleUser,
			}
			if err := db.Create(&foreignOwner).Error; err != nil {
				t.Fatal(err)
			}
			// Old databases can contain this edge because parent/Owner FK
			// adoption is NOT VALID. Neither clean nor mixed migration may
			// move a root whose descendants belong to another Owner.
			alien := meta.Node{
				OwnerID: foreignOwner.ID, ParentID: &photoParentID,
				Name: "foreign-legacy", Type: tc.foreignType, Revision: 1,
			}
			if err := db.Create(&alien).Error; err != nil {
				t.Fatal(err)
			}
			share := meta.Share{
				OwnerID: owner.ID, NodeID: target.ID,
				TokenHash: strings.Repeat("b", 64), Access: "read_only",
			}
			if err := db.Create(&share).Error; err != nil {
				t.Fatal(err)
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatalf("invalid legacy Source must pause without aborting startup: %v", err)
			}
			var afterSource meta.Source
			var afterTarget, afterPhoto, afterAlien meta.Node
			var afterClaim meta.SourceItem
			var afterShare meta.Share
			for _, err := range []error{
				db.First(&afterSource, source.ID).Error,
				db.First(&afterTarget, target.ID).Error,
				db.First(&afterPhoto, photo.ID).Error,
				db.First(&afterAlien, alien.ID).Error,
				db.First(&afterClaim, claim.ID).Error,
				db.First(&afterShare, share.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if afterSource.Status != meta.SourceStatusPaused ||
				afterSource.LastError == "" ||
				afterSource.TargetNodeID == nil ||
				*afterSource.TargetNodeID != target.ID ||
				afterTarget.ParentID == nil ||
				*afterTarget.ParentID != connector.ID ||
				afterPhoto.ParentID == nil ||
				*afterPhoto.ParentID != photoParentID ||
				afterPhoto.Revision != photo.Revision ||
				afterAlien.ParentID == nil ||
				*afterAlien.ParentID != photoParentID ||
				afterAlien.OwnerID != foreignOwner.ID ||
				afterClaim.NodeID == nil || *afterClaim.NodeID != photo.ID ||
				afterClaim.NodeRevision != claim.NodeRevision ||
				afterShare.NodeID != target.ID ||
				afterShare.TokenHash != share.TokenHash {
				t.Fatalf("foreign descendants were ignored: source=%+v target=%+v photo=%+v alien=%+v item=%+v share=%+v",
					afterSource, afterTarget, afterPhoto, afterAlien, afterClaim, afterShare)
			}
		})
	}
}

func TestLegacyYikeCleanTargetRejectsOtherSourceItemClaim(t *testing.T) {
	for _, claimed := range []string{"root", "verified-file"} {
		t.Run(claimed, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, _, connector, target, source := createLegacyYikeMigrationFixture(t, db)
			photo := meta.Node{OwnerID: user.ID, ParentID: &target.ID,
				Name: "photo.jpg", Type: meta.NodeTypeFile, Revision: 1}
			if err := db.Create(&photo).Error; err != nil {
				t.Fatal(err)
			}
			verified := meta.SourceItem{
				SourceID: source.ID, ExternalID: "current:photo", NodeID: &photo.ID,
				NodeRevision: photo.Revision, Kind: meta.SourceItemKindFile,
				Path: photo.Name, State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
			}
			if err := db.Create(&verified).Error; err != nil {
				t.Fatal(err)
			}
			other := meta.Source{
				OwnerID: user.ID, Name: "Retained other provenance",
				Kind: "synology_files", Direction: meta.SourceDirectionPull,
				SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
				Status: meta.SourceStatusArchived, Revision: 1,
			}
			if err := db.Create(&other).Error; err != nil {
				t.Fatal(err)
			}
			claimedID := photo.ID
			claimKind := meta.SourceItemKindFile
			if claimed == "root" {
				claimedID = target.ID
				claimKind = meta.SourceItemKindDirectory
			}
			claim := meta.SourceItem{
				SourceID: other.ID, ExternalID: "other:" + claimed,
				NodeID: &claimedID, NodeRevision: 1,
				Kind: claimKind, Path: "older-provenance",
				State: meta.SourceItemStatePending, LastSeenAt: time.Now().UTC(),
			}
			if err := db.Create(&claim).Error; err != nil {
				t.Fatal(err)
			}
			// An archived/pending record remains a conflicting claim until
			// explicitly reconciled. Do not reparent a clean-looking root
			// merely because the other Source has no TargetNodeID binding.
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatalf("ambiguous SourceItem provenance must pause only this Source: %v", err)
			}
			var afterSource meta.Source
			var afterTarget, afterPhoto meta.Node
			var afterVerified, afterClaim meta.SourceItem
			for _, err := range []error{
				db.First(&afterSource, source.ID).Error,
				db.First(&afterTarget, target.ID).Error,
				db.First(&afterPhoto, photo.ID).Error,
				db.First(&afterVerified, verified.ID).Error,
				db.First(&afterClaim, claim.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if afterSource.Status != meta.SourceStatusPaused ||
				afterSource.LastError == "" ||
				afterSource.TargetNodeID == nil ||
				*afterSource.TargetNodeID != target.ID ||
				afterTarget.ParentID == nil || *afterTarget.ParentID != connector.ID ||
				afterPhoto.ParentID == nil || *afterPhoto.ParentID != target.ID ||
				afterPhoto.Revision != photo.Revision ||
				afterVerified.NodeRevision != verified.NodeRevision ||
				afterClaim.NodeID == nil || *afterClaim.NodeID != claimedID {
				t.Fatalf("competing SourceItem ignored or original identities changed: source=%+v root=%+v photo=%+v originalItem=%+v otherItem=%+v",
					afterSource, afterTarget, afterPhoto, afterVerified, afterClaim)
			}
		})
	}
}
