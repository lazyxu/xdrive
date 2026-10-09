package mediagroup

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// A second synchronization-folder import produces new Nodes, but byte-identical
// originals must not make an already supported Live/RAW relationship disappear.
func TestDuplicateByteImportsDoNotBreakLocalMediaRelations(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "duplicate_relation_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "duplicate-" + uuid.NewString(), PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	imageHash := strings.Repeat("a", 64)
	motionHash := strings.Repeat("b", 64)
	rawHash := strings.Repeat("c", 64)
	renderedHash := strings.Repeat("d", 64)
	add := func(name, kind, mime, sha, liveID, imageID string) uint64 {
		t.Helper()
		node := meta.Node{ParentID: &root.ID, Name: name, Type: meta.NodeTypeFile,
			OwnerID: owner.ID, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: node.ID, StorageKey: "cas/" + sha,
			SHA256: sha, Size: 256}).Error; err != nil {
			t.Fatal(err)
		}
		evidence := ""
		version := 0
		if imageID != "" {
			evidence = fmt.Sprintf(`{"image_unique_id":%q}`, imageID)
			version = media.RelationEvidenceVersion
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: sha,
			MediaKind: kind, MIMEType: mime, IndexState: meta.MediaIndexStateReady,
			LivePhotoAssetIdentifier: liveID, RelationJSON: evidence,
			RelationEvidenceVersion: version,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}
	still := add("one.heic", meta.MediaKindImage, "image/heic", imageHash, "live-dup", "")
	motion := add("one.mov", meta.MediaKindVideo, "video/quicktime", motionHash, "live-dup", "")
	raw := add("one.dng", meta.MediaKindImage, "image/x-adobe-dng", rawHash, "", "raw-dup")
	rendered := add("one.jpg", meta.MediaKindImage, "image/jpeg", renderedHash, "", "raw-dup")
	check := func(kind string, first, second uint64) uint64 {
		t.Helper()
		var groups []meta.MediaGroup
		if err := db.Where("owner_id = ? AND kind = ?", owner.ID, kind).Find(&groups).Error; err != nil {
			t.Fatal(err)
		}
		if len(groups) != 1 {
			t.Fatalf("%s groups=%+v", kind, groups)
		}
		var members []meta.MediaGroupItem
		if err := db.Where("group_id = ?", groups[0].ID).Order("ordinal ASC").Find(&members).Error; err != nil {
			t.Fatal(err)
		}
		if len(members) != 2 || members[0].NodeID != first || members[1].NodeID != second {
			t.Fatalf("%s pair=%+v expected %d,%d", kind, members, first, second)
		}
		return groups[0].ID
	}
	if err := ReconcileOwnerLocalGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	liveGroupID := check(meta.MediaGroupKindLivePhoto, still, motion)
	rawGroupID := check(meta.MediaGroupKindRAWPair, rendered, raw)

	// Each copy retains an independent Node/Source path and exactly the same bytes.
	add("two.heic", meta.MediaKindImage, "image/heic", imageHash, "live-dup", "")
	add("two.mov", meta.MediaKindVideo, "video/quicktime", motionHash, "live-dup", "")
	add("two.dng", meta.MediaKindImage, "image/x-adobe-dng", rawHash, "", "raw-dup")
	add("two.jpg", meta.MediaKindImage, "image/jpeg", renderedHash, "", "raw-dup")
	if err := ReconcileOwnerLocalGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	if got := check(meta.MediaGroupKindLivePhoto, still, motion); got != liveGroupID {
		t.Fatalf("Live group ID changed %d to %d", liveGroupID, got)
	}
	if got := check(meta.MediaGroupKindRAWPair, rendered, raw); got != rawGroupID {
		t.Fatalf("RAW group ID changed %d to %d", rawGroupID, got)
	}
	stale, err := LocalEvidenceGroupsStale(context.Background(), db, owner.ID)
	if err != nil || stale {
		t.Fatalf("stable duplicate copies stale=%v err=%v", stale, err)
	}

	// A third genuinely different motion or RAW has the same embedded evidence.
	// The hash conflict must stay fail-closed, not guessed by name or folder.
	add("conflict.mov", meta.MediaKindVideo, "video/quicktime",
		strings.Repeat("e", 64), "live-dup", "")
	add("conflict.dng", meta.MediaKindImage, "image/x-adobe-dng",
		strings.Repeat("f", 64), "", "raw-dup")
	if err := ReconcileOwnerLocalGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{meta.MediaGroupKindLivePhoto, meta.MediaGroupKindRAWPair} {
		var count int64
		if err := db.Model(&meta.MediaGroup{}).Where("owner_id = ? AND kind = ?", owner.ID, kind).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("ambiguous %s retained %d groups", kind, count)
		}
	}
}
