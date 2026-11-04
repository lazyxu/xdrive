package main

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func buildLegacyYikeNestedMixedFixture(t *testing.T, db *gorm.DB) (meta.User, meta.Node, meta.Node, meta.Node, meta.Node, meta.Source) {
	t.Helper()
	user, _, _, root, source := createLegacyYikeMigrationFixture(t, db)
	rootID := root.ID
	album := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: "Album", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	albumID := album.ID
	day := meta.Node{OwnerID: user.ID, ParentID: &albumID, Name: "Day", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&day).Error; err != nil {
		t.Fatal(err)
	}
	dayID := day.ID
	photo := meta.Node{OwnerID: user.ID, ParentID: &dayID, Name: "a.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&photo).Error; err != nil {
		t.Fatal(err)
	}
	ordinary := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: "ordinary.txt", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&ordinary).Error; err != nil {
		t.Fatal(err)
	}
	for i, item := range []struct {
		n          meta.Node
		kind, path string
	}{
		{album, meta.SourceItemKindDirectory, "Album"},
		{day, meta.SourceItemKindDirectory, "Album/Day"},
		{photo, meta.SourceItemKindFile, "Album/Day/a.jpg"},
	} {
		id := item.n.ID
		entry := meta.SourceItem{SourceID: source.ID, ExternalID: "remote:" + item.path,
			NodeID: &id, NodeRevision: item.n.Revision, Kind: item.kind, Path: item.path,
			State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC()}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatalf("item[%d]: %v", i, err)
		}
	}
	return user, root, album, photo, ordinary, source
}

func TestLegacyYikeVerifiedNestedMixedSplitPreservesIdentity(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, oldRoot, album, photo, ordinary, source := buildLegacyYikeNestedMixedFixture(t, db)
	rootShare := meta.Share{OwnerID: user.ID, NodeID: oldRoot.ID, TokenHash: strings.Repeat("a", 64), Access: "read_only"}
	albumShare := meta.Share{OwnerID: user.ID, NodeID: album.ID, TokenHash: strings.Repeat("b", 64), Access: "read_only"}
	version := meta.FileVersion{NodeID: photo.ID, Revision: 1, Size: 12, StorageKey: "nested/version", SHA256: strings.Repeat("d", 64)}
	file := meta.File{NodeID: photo.ID, Size: 13, StorageKey: "nested/current", SHA256: strings.Repeat("c", 64)}
	for _, err := range []error{db.Create(&rootShare).Error, db.Create(&albumShare).Error,
		db.Create(&file).Error, db.Create(&version).Error} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var migrated meta.Source
	if err := db.First(&migrated, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.TargetNodeID == nil || *migrated.TargetNodeID == oldRoot.ID || !migrated.TargetManaged || migrated.Revision != source.Revision+1 {
		t.Fatalf("nested migration lost source binding: %+v", migrated)
	}
	var oldAfter, albumAfter, photoAfter, ordinaryAfter meta.Node
	for _, entry := range []struct {
		id  uint64
		out *meta.Node
	}{
		{oldRoot.ID, &oldAfter}, {album.ID, &albumAfter}, {photo.ID, &photoAfter}, {ordinary.ID, &ordinaryAfter},
	} {
		if err := db.First(entry.out, entry.id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if oldAfter.ParentID == nil || *oldAfter.ParentID != *oldRoot.ParentID ||
		albumAfter.ParentID == nil || *albumAfter.ParentID != *migrated.TargetNodeID ||
		albumAfter.Revision != album.Revision+1 ||
		photoAfter.ParentID == nil || *photoAfter.ParentID == album.ID ||
		ordinaryAfter.ParentID == nil || *ordinaryAfter.ParentID != oldRoot.ID {
		t.Fatalf("nested split moved wrong identities: old=%+v album=%+v photo=%+v ordinary=%+v", oldAfter, albumAfter, photoAfter, ordinaryAfter)
	}
	var day meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ? AND name = ?", user.ID, album.ID, "Day").Take(&day).Error; err != nil {
		t.Fatal(err)
	}
	if photoAfter.ParentID == nil || *photoAfter.ParentID != day.ID || day.Revision != 1 {
		t.Fatalf("nested descendants moved or revised: day=%+v photo=%+v", day, photoAfter)
	}
	var items []meta.SourceItem
	if err := db.Where("source_id = ?", source.ID).Order("id ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || items[0].Path != "Album" || items[0].NodeRevision != 2 ||
		items[1].Path != "Album/Day" || items[1].NodeRevision != 1 ||
		items[2].Path != "Album/Day/a.jpg" || items[2].NodeRevision != 1 {
		t.Fatalf("nested SourceItem paths/revisions changed unexpectedly: %+v", items)
	}
	var preservedRootShare, preservedAlbumShare meta.Share
	if err := db.First(&preservedRootShare, rootShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&preservedAlbumShare, albumShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preservedRootShare.NodeID != oldRoot.ID || preservedRootShare.TokenHash != rootShare.TokenHash ||
		preservedAlbumShare.NodeID != album.ID || preservedAlbumShare.TokenHash != albumShare.TokenHash {
		t.Fatal("direct Share identity was rebound")
	}
	var preservedFile meta.File
	var preservedVersion meta.FileVersion
	if err := db.First(&preservedFile, photo.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&preservedVersion, version.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preservedFile.StorageKey != file.StorageKey || preservedVersion.StorageKey != version.StorageKey {
		t.Fatal("CAS/FileVersion identity changed")
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var restarted meta.Source
	if err := db.First(&restarted, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if restarted.Revision != migrated.Revision || restarted.TargetNodeID == nil || *restarted.TargetNodeID != *migrated.TargetNodeID {
		t.Fatalf("nested migration is not idempotent: %+v", restarted)
	}
}

func TestLegacyYikeNestedMixedSplitFailsClosedOnUnprovenDescendant(t *testing.T) {
	for _, scenario := range []string{"untracked", "stale-revision", "foreign-claim"} {
		t.Run(scenario, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			user, oldRoot, album, photo, _, source := buildLegacyYikeNestedMixedFixture(t, db)
			var day meta.Node
			if err := db.Where("owner_id = ? AND parent_id = ? AND name = ?", user.ID, album.ID, "Day").Take(&day).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "untracked":
				unknown := meta.Node{OwnerID: user.ID, ParentID: &day.ID, Name: "private.txt", Type: meta.NodeTypeFile, Revision: 1}
				if err := db.Create(&unknown).Error; err != nil {
					t.Fatal(err)
				}
			case "stale-revision":
				if err := db.Model(&meta.Node{}).Where("id = ?", photo.ID).Update("revision", 2).Error; err != nil {
					t.Fatal(err)
				}
			case "foreign-claim":
				other := meta.Source{OwnerID: user.ID, Name: "Other nested", Kind: "synology_files", Direction: meta.SourceDirectionPull,
					SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
				claim := meta.SourceItem{SourceID: other.ID, ExternalID: "foreign", NodeID: &photo.ID, NodeRevision: 1,
					Kind: meta.SourceItemKindFile, Path: "Album/Day/a.jpg", State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC()}
				if err := db.Create(&claim).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var oldAfter, albumAfter meta.Node
			var paused meta.Source
			if err := db.First(&oldAfter, oldRoot.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&albumAfter, album.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&paused, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if paused.Status != meta.SourceStatusPaused || paused.TargetNodeID == nil || *paused.TargetNodeID != oldRoot.ID ||
				albumAfter.ParentID == nil || *albumAfter.ParentID != oldRoot.ID ||
				oldAfter.ParentID == nil || *oldAfter.ParentID != *oldRoot.ParentID {
				t.Fatalf("unproven nested branch was moved: source=%+v root=%+v album=%+v", paused, oldAfter, albumAfter)
			}
		})
	}
}
