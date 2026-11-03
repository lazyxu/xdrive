package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func openYikeMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "yike_target_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}, &meta.Share{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func createLegacyYikeMigrationFixture(t *testing.T, db *gorm.DB) (meta.User, meta.Node, meta.Node, meta.Node, meta.Source) {
	t.Helper()
	user := meta.User{Username: "migration-" + uuid.NewString(), PasswordHash: "x", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: user.ID, Name: "root", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	rootID := root.ID
	legacyRoot := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: legacyYikeTargetRootName, Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&legacyRoot).Error; err != nil {
		t.Fatal(err)
	}
	legacyRootID := legacyRoot.ID
	connector := meta.Node{OwnerID: user.ID, ParentID: &legacyRootID, Name: yikeTargetConnectorName, Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&connector).Error; err != nil {
		t.Fatal(err)
	}
	connectorID := connector.ID
	target := meta.Node{OwnerID: user.ID, ParentID: &connectorID, Name: "uid_12345_张三", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	targetID := target.ID
	source := meta.Source{
		OwnerID: user.ID, Name: "一刻相册", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	return user, root, connector, target, source
}

func TestMigrateLegacyYikeTargetMovesTargetInPlace(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, root, _, target, source := createLegacyYikeMigrationFixture(t, db)

	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}

	var migrated meta.Node
	if err := db.First(&migrated, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.ID != target.ID || migrated.ParentID == nil {
		t.Fatalf("migrated target=%+v", migrated)
	}
	var connector meta.Node
	if err := db.First(&connector, *migrated.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if connector.Name != yikeTargetConnectorName || connector.ParentID == nil {
		t.Fatalf("connector=%+v", connector)
	}
	var syncRoot meta.Node
	if err := db.First(&syncRoot, *connector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if syncRoot.Name != yikeTargetRootName || syncRoot.ParentID == nil || *syncRoot.ParentID != root.ID {
		t.Fatalf("sync root=%+v", syncRoot)
	}
	var migratedSource meta.Source
	if err := db.First(&migratedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migratedSource.TargetNodeID == nil || *migratedSource.TargetNodeID != target.ID || migratedSource.OwnerID != user.ID {
		t.Fatalf("source target changed unexpectedly: %+v", migratedSource)
	}
}

func TestMigrateLegacyYikeTargetConflictPausesSourceWithoutFailingStartup(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)

	rootID := root.ID
	conflict := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: yikeTargetRootName, Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&conflict).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatalf("migration conflict should not fail startup: %v", err)
	}

	var paused meta.Source
	if err := db.First(&paused, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if paused.Status != meta.SourceStatusPaused || paused.LastError == "" || paused.Revision != source.Revision+1 {
		t.Fatalf("blocked source was not paused with an actionable error: %+v", paused)
	}
	var unchanged meta.Node
	if err := db.First(&unchanged, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.ParentID == nil || *unchanged.ParentID != connector.ID {
		t.Fatalf("blocked migration moved target unexpectedly: %+v", unchanged)
	}
}

func TestLegacyYikeMigrationVerifiedFilesKeepNodeAndShareIdentity(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, _, connector, target, source := createLegacyYikeMigrationFixture(t, db)

	targetID := target.ID
	photo := meta.Node{
		OwnerID: user.ID, ParentID: &targetID, Name: "photo.jpg",
		Type: meta.NodeTypeFile, Revision: 1,
	}
	if err := db.Create(&photo).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "yike:12345:photo", NodeID: &photo.ID,
		NodeRevision: photo.Revision, Path: photo.Name, Kind: meta.SourceItemKindFile,
		State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.File{NodeID: photo.ID, Size: 8, StorageKey: "blobs/example",
		SHA256: strings.Repeat("a", 64)}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	version := meta.FileVersion{NodeID: photo.ID, Revision: 1, Size: 7,
		StorageKey: "blobs/previous", SHA256: strings.Repeat("b", 64)}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	share := meta.Share{OwnerID: user.ID, NodeID: photo.ID,
		TokenHash: strings.Repeat("c", 64), Access: "read_only"}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var movedRoot, keptFile meta.Node
	if err := db.First(&movedRoot, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&keptFile, photo.ID).Error; err != nil {
		t.Fatal(err)
	}
	if movedRoot.ParentID == nil || *movedRoot.ParentID == connector.ID ||
		keptFile.ParentID == nil || *keptFile.ParentID != target.ID ||
		keptFile.Revision != photo.Revision {
		t.Fatalf("verified file/root IDs were modified instead of reparented: root=%+v file=%+v", movedRoot, keptFile)
	}
	var savedItem meta.SourceItem
	var savedVersion meta.FileVersion
	var savedShare meta.Share
	var savedFile meta.File
	for _, result := range []error{
		db.First(&savedItem, item.ID).Error,
		db.First(&savedFile, file.NodeID).Error,
		db.First(&savedVersion, version.ID).Error,
		db.First(&savedShare, share.ID).Error,
	} {
		if result != nil {
			t.Fatal(result)
		}
	}
	if savedItem.NodeID == nil || *savedItem.NodeID != photo.ID ||
		savedItem.Path != photo.Name || savedItem.NodeRevision != photo.Revision ||
		savedVersion.NodeID != photo.ID || savedVersion.StorageKey != version.StorageKey ||
		savedFile.StorageKey != file.StorageKey || savedShare.NodeID != photo.ID ||
		savedShare.TokenHash != share.TokenHash || savedShare.RevokedAt != nil {
		t.Fatalf("migration changed file/version/source/share identity: item=%+v file=%+v version=%+v share=%+v",
			savedItem, savedFile, savedVersion, savedShare)
	}
}

func TestLegacyYikeMigrationMixedTreePausesAndPreservesOriginalShare(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)
	targetID := target.ID
	photo := meta.Node{OwnerID: user.ID, ParentID: &targetID, Name: "tracked.jpg",
		Type: meta.NodeTypeFile, Revision: 1}
	ordinary := meta.Node{OwnerID: user.ID, ParentID: &targetID, Name: "ordinary.pdf",
		Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&photo).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItem{SourceID: source.ID,
		ExternalID: "yike:12345:tracked", NodeID: &photo.ID,
		NodeRevision: photo.Revision, Path: photo.Name, Kind: meta.SourceItemKindFile,
		State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	share := meta.Share{OwnerID: user.ID, NodeID: target.ID,
		TokenHash: strings.Repeat("d", 64), Access: "read_only"}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatalf("ambiguous tree must pause Source but not block startup: %v", err)
	}
	var unchangedRoot, untouchedOrdinary meta.Node
	var paused meta.Source
	var oldShare meta.Share
	for _, err := range []error{
		db.First(&unchangedRoot, target.ID).Error,
		db.First(&untouchedOrdinary, ordinary.ID).Error,
		db.First(&paused, source.ID).Error,
		db.First(&oldShare, share.ID).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if unchangedRoot.ParentID == nil || *unchangedRoot.ParentID != connector.ID ||
		untouchedOrdinary.ParentID == nil || *untouchedOrdinary.ParentID != target.ID ||
		paused.Status != meta.SourceStatusPaused || paused.Revision != source.Revision+1 ||
		paused.TargetNodeID == nil || *paused.TargetNodeID != target.ID ||
		oldShare.NodeID != target.ID || oldShare.TokenHash != share.TokenHash || oldShare.RevokedAt != nil {
		t.Fatalf("mixed-tree migration changed authorization/ordinary data: root=%+v ordinary=%+v source=%+v share=%+v",
			unchangedRoot, untouchedOrdinary, paused, oldShare)
	}
	var unexpected int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			user.ID, root.ID, yikeTargetRootName).Count(&unexpected).Error; err != nil {
		t.Fatal(err)
	}
	if unexpected != 0 {
		t.Fatal("blocked migration created a new managed root before validating ownership")
	}
}

func TestLegacyYikeMigrationOtherSourceOrRunningRunFailsClosed(t *testing.T) {
	for _, scenario := range []string{"shared-root", "active-run", "stale-node-revision"} {
		t.Run(scenario, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, _, connector, target, source := createLegacyYikeMigrationFixture(t, db)
			switch scenario {
			case "shared-root":
				other := meta.Source{OwnerID: user.ID, Name: "Foreign owner", Kind: "test",
					Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
					RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
					Revision: 1, TargetNodeID: &target.ID}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
			case "active-run":
				run := meta.SyncRun{ID: uuid.NewString(), SourceID: source.ID,
					Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
					Status: meta.SyncRunStatusRunning, StartedAt: time.Now().UTC()}
				if err := db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
			case "stale-node-revision":
				id := target.ID
				child := meta.Node{OwnerID: user.ID, ParentID: &id, Name: "changed.jpg",
					Type: meta.NodeTypeFile, Revision: 3}
				if err := db.Create(&child).Error; err != nil {
					t.Fatal(err)
				}
				item := meta.SourceItem{SourceID: source.ID, ExternalID: "tracked-but-stale",
					NodeID: &child.ID, NodeRevision: 2, Path: child.Name,
					Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
					LastSeenAt: time.Now().UTC()}
				if err := db.Create(&item).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var unchanged meta.Node
			var paused meta.Source
			if err := db.First(&unchanged, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&paused, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if unchanged.ParentID == nil || *unchanged.ParentID != connector.ID ||
				paused.Status != meta.SourceStatusPaused ||
				paused.TargetNodeID == nil || *paused.TargetNodeID != target.ID {
				t.Fatalf("unsafe migration was allowed: root=%+v source=%+v", unchanged, paused)
			}
		})
	}
}
