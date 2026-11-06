package photoasset

import (
	"context"
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

func contentIdentityTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := "photo_content_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error })
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
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}, &meta.PhotoAsset{}, &meta.PhotoAssetOccurrence{}, &meta.PhotoAssetIdentityAlias{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{}); err != nil {
		t.Fatal(err)
	}
	if err := InstallContentIdentitySchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func createContentIdentitySource(t *testing.T, db *gorm.DB, owner meta.User, parent uint64, name, sha string) meta.Node {
	t.Helper()
	node := meta.Node{OwnerID: owner.ID, Name: name, ParentID: &parent, Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: node.ID, Size: 100, StorageKey: "fixture/" + name, SHA256: sha}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{NodeID: node.ID, OwnerID: owner.ID, NodeRevision: node.Revision, SHA256: sha, MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady, MIMEType: "image/jpeg"}).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func TestPhotoContentBundleRejectsChangedOrMissingMotion(t *testing.T) {
	db := contentIdentityTestDB(t)
	owner := meta.User{Username: "bundle-owner", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Type: meta.NodeTypeDir, Name: "Bundle", Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	stillHash, motionHash := strings.Repeat("a", 64), strings.Repeat("b", 64)
	still := createContentIdentitySource(t, db, owner, root.ID, "still.jpg", stillHash)
	motion := createContentIdentitySource(t, db, owner, root.ID, "motion.mov", motionHash)
	identity, err := IdentifyOriginals(meta.PhotoAssetKindLivePhoto, []OriginalResource{
		{Role: "still", SHA256: stillHash, Size: 100}, {Role: "motion", SHA256: motionHash, Size: 100},
	})
	if err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{OwnerID: owner.ID, PrimaryNodeID: still.ID, Kind: meta.PhotoAssetKindLivePhoto,
		ContentKey: identity.Key, EvidenceKey: identity.Key, ContentManifest: identity.Manifest}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	resources := []meta.PhotoResource{
		{AssetID: asset.ID, ResourceKind: "node", NodeID: still.ID, Role: "still", SHA256: stillHash, Size: 100},
		{AssetID: asset.ID, ResourceKind: "node", NodeID: motion.ID, Role: "motion", SHA256: motionHash, Size: 100},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	check := func(want int64) {
		t.Helper()
		var count int64
		if err := db.Table("xd_photo_assets pa").Where("pa.id = ?", asset.ID).Where(CurrentContentBindingSQL("pa")).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("current bundle count=%d want=%d", count, want)
		}
	}
	check(1)
	// Still bytes and primary Node are unchanged; motion alone invalidates the bundle.
	if err := db.Model(&meta.File{}).Where("node_id = ?", motion.ID).Update("sha256", strings.Repeat("c", 64)).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
	if err := db.Model(&meta.File{}).Where("node_id = ?", motion.ID).Update("sha256", motionHash).Error; err != nil {
		t.Fatal(err)
	}
	check(1)
	if err := db.Delete(&resources[1]).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
	if err := db.Create(&resources[1]).Error; err != nil {
		t.Fatal(err)
	}
	check(1)
	if err := db.Model(&meta.Node{}).Where("id = ?", motion.ID).Update("deleted_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
}

func TestPhotoContentReconcileSourcesAlbumsReplacementAndRestore(t *testing.T) {
	db := contentIdentityTestDB(t)
	owner := meta.User{Username: "content-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	folders := []meta.Node{{OwnerID: owner.ID, Name: "Camera", Type: meta.NodeTypeDir, Revision: 1}, {OwnerID: owner.ID, Name: "Imported", Type: meta.NodeTypeDir, Revision: 1}}
	if err := db.Create(&folders).Error; err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("a", 64)
	first := createContentIdentitySource(t, db, owner, folders[0].ID, "first.jpg", sha)
	second := createContentIdentitySource(t, db, owner, folders[1].ID, "second.jpg", sha)
	reconcile := func() {
		t.Helper()
		if _, err := ReconcileOwner(context.Background(), db, owner.ID); err != nil {
			t.Fatal(err)
		}
	}
	reconcile()
	var assets []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).Find(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if len(assets) != 1 || assets[0].ContentKey != "sha256:"+sha {
		t.Fatalf("duplicate content not canonical: %+v", assets)
	}
	canonical := assets[0]
	var occurrences int64
	if err := db.Model(&meta.PhotoAssetOccurrence{}).Where("asset_id = ? AND active", canonical.ID).Count(&occurrences).Error; err != nil {
		t.Fatal(err)
	}
	if occurrences != 2 {
		t.Fatalf("occurrences=%d", occurrences)
	}
	var folderMemberships int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).Where("asset_id = ?", canonical.ID).Count(&folderMemberships).Error; err != nil {
		t.Fatal(err)
	}
	if folderMemberships != 2 {
		t.Fatalf("folder provenance lost: %d", folderMemberships)
	}
	album := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:content", Kind: meta.PhotoCollectionKindManual, Name: "Keep", State: meta.PhotoCollectionStateActive}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoCollectionAsset{CollectionID: album.ID, AssetID: canonical.ID}).Error; err != nil {
		t.Fatal(err)
	}
	person := meta.PhotoPerson{OwnerID: owner.ID, PersonKey: "person:v1:" + uuid.NewString(), Name: "Saved person", CoverAssetID: &canonical.ID}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{PersonID: person.ID, AssetID: canonical.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).Where("asset_id = ?", canonical.ID).Updates(map[string]any{"favorite": true, "description": "belongs to original A"}).Error; err != nil {
		t.Fatal(err)
	}
	// Hard-deleting the current locator must not cascade into the shared photo.
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("node_id = ?", first.ID).Delete(&meta.File{}).Error; err != nil {
			return err
		}
		return tx.Delete(&meta.Node{}, first.ID).Error
	}); err != nil {
		t.Fatal(err)
	}
	reconcile()
	var current meta.PhotoAsset
	if err := db.First(&current, canonical.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.ContentKey != canonical.ContentKey || current.PrimaryNodeID != second.ID {
		t.Fatalf("content lost after deleting one source: %+v", current)
	}
	var membership int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).Where("collection_id = ? AND asset_id = ?", album.ID, canonical.ID).Count(&membership).Error; err != nil {
		t.Fatal(err)
	}
	if membership != 1 {
		t.Fatal("manual album followed removed source rather than content")
	}
	if err := db.Model(&meta.PhotoPersonAsset{}).Where("person_id = ? AND asset_id = ?", person.ID, canonical.ID).Count(&membership).Error; err != nil {
		t.Fatal(err)
	}
	if membership != 1 {
		t.Fatal("saved person lost on source handoff")
	}
	// Last source goes to Trash: absent from the active Gallery, recoverable on undo.
	now := time.Now().UTC()
	if err := db.Model(&meta.Node{}).Where("id = ?", second.ID).Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	reconcile()
	if err := db.Model(&meta.PhotoAssetOccurrence{}).Where("asset_id = ? AND active", canonical.ID).Count(&occurrences).Error; err != nil {
		t.Fatal(err)
	}
	if occurrences != 0 {
		t.Fatal("last deleted source still active")
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", second.ID).Update("deleted_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	reconcile()
	if err := db.First(&current, canonical.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.PrimaryNodeID != second.ID {
		t.Fatal("Trash restore failed to recover canonical content")
	}
	// Same Node, different bytes: a new photo, with no inherited annotations.
	newSHA := strings.Repeat("b", 64)
	if err := db.Model(&meta.Node{}).Where("id = ?", second.ID).Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Where("node_id = ?", second.ID).Update("sha256", newSHA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", second.ID).Updates(map[string]any{"sha256": newSHA, "node_revision": 2}).Error; err != nil {
		t.Fatal(err)
	}
	reconcile()
	var replacement meta.PhotoAsset
	if err := db.Where("owner_id = ? AND content_key = ?", owner.ID, "sha256:"+newSHA).First(&replacement).Error; err != nil {
		t.Fatal(err)
	}
	if replacement.ID == canonical.ID {
		t.Fatal("replacement reused old photo identity")
	}
	var annotation meta.PhotoMetadata
	if err := db.First(&annotation, "asset_id = ?", replacement.ID).Error; err != nil {
		t.Fatal(err)
	}
	if annotation.Favorite || annotation.Description != "" {
		t.Fatalf("new content inherited old annotations: %+v", annotation)
	}
	if err := db.First(&current, canonical.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.PrimaryNodeID != 0 {
		t.Fatal("old content still points to overwritten Node")
	}
	if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", replacement.ID).Update("content_key", canonical.ContentKey).Error; err == nil {
		t.Fatal("canonical identity is mutable")
	}
	// Equal content across Owners does not merge ownership or metadata.
	other := meta.User{Username: "other-content-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: other.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	createContentIdentitySource(t, db, other, root.ID, "foreign.jpg", newSHA)
	if _, err := ReconcileOwner(context.Background(), db, other.ID); err != nil {
		t.Fatal(err)
	}
	var foreign meta.PhotoAsset
	if err := db.Where("owner_id = ? AND content_key = ?", other.ID, replacement.ContentKey).First(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	if foreign.ID == replacement.ID {
		t.Fatal("same hash merged private Owner rows")
	}
}

func TestPhotoContentUpgradePreservesLegacyAnnotations(t *testing.T) {
	db := contentIdentityTestDB(t)
	owner := meta.User{Username: "legacy-content-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("c", 64)
	album := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:legacy", Kind: meta.PhotoCollectionKindManual, State: meta.PhotoCollectionStateActive, Name: "Both copies"}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		node := createContentIdentitySource(t, db, owner, root.ID, fmt.Sprintf("legacy-%d.jpg", i), sha)
		asset := meta.PhotoAsset{OwnerID: owner.ID, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", node.ID)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: node.ID, Role: "primary", Name: node.Name, MediaKind: meta.MediaKindImage, Size: 100, SHA256: sha}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, Favorite: i == 1, TagsJSON: fmt.Sprintf(`["tag-%d"]`, i), Description: fmt.Sprintf("description-%d", i)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoCollectionAsset{CollectionID: album.ID, AssetID: asset.ID, Position: int64(i)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if _, err := ReconcileOwner(context.Background(), db, owner.ID); err != nil {
			t.Fatal(err)
		}
	}
	var canonical meta.PhotoAsset
	if err := db.Where("owner_id = ? AND content_key = ?", owner.ID, "sha256:"+sha).First(&canonical).Error; err != nil {
		t.Fatal(err)
	}
	var annotation meta.PhotoMetadata
	if err := db.First(&annotation, "asset_id = ?", canonical.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !annotation.Favorite || annotation.TagsJSON != `["tag-0","tag-1"]` || !strings.Contains(annotation.Description, "description-0") || !strings.Contains(annotation.Description, "description-1") {
		t.Fatalf("legacy annotations lost: %+v", annotation)
	}
	var aliases []meta.PhotoAssetIdentityAlias
	if err := db.Where("owner_id = ?", owner.ID).Find(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if len(aliases) != 1 || aliases[0].ContentKey != canonical.ContentKey || !strings.Contains(aliases[0].SnapshotJSON, "description-1") {
		t.Fatalf("legacy snapshot lost: %+v", aliases)
	}
	var count int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).Where("collection_id = ?", album.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("duplicate album membership remains: %d", count)
	}
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND type = ?", owner.ID, meta.NodeTypeFile).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("identity migration removed original files")
	}
}

func TestPhotoContentLegacyLocatorSchemaUpgradeIsIdempotent(t *testing.T) {
	db := contentIdentityTestDB(t)
	owner := meta.User{Username: "schema-upgrade", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("f", 64)
	first := createContentIdentitySource(t, db, owner, root.ID, "old.jpg", sha)
	second := createContentIdentitySource(t, db, owner, root.ID, "copy.jpg", sha)
	legacy := meta.PhotoAsset{OwnerID: owner.ID, PrimaryNodeID: first.ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", first.ID)}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoResource{AssetID: legacy.ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: first.ID, Role: "primary", Name: first.Name, MediaKind: meta.MediaKindImage, Size: 100, SHA256: sha}).Error; err != nil {
		t.Fatal(err)
	}
	// Recreate the actual pre-content schema constraints before upgrading.
	for _, sql := range []string{
		`ALTER TABLE xd_photo_assets ADD CONSTRAINT fk_xd_photo_assets_primary_node FOREIGN KEY (primary_node_id) REFERENCES xd_nodes(id) ON DELETE CASCADE`,
		`CREATE UNIQUE INDEX idx_xd_photo_assets_owner_primary ON xd_photo_assets(owner_id, primary_node_id)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := InstallContentIdentitySchema(db); err != nil {
			t.Fatal(err)
		}
		if _, err := ReconcileOwner(context.Background(), db, owner.ID); err != nil {
			t.Fatal(err)
		}
	}
	var before meta.PhotoAsset
	if err := db.Where("owner_id = ? AND content_key = ?", owner.ID, "sha256:"+sha).First(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before.ID != legacy.ID {
		t.Fatal("matching legacy identity was not preserved")
	}
	if err := db.Delete(&meta.File{}, "node_id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Unscoped().Delete(&first).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", before.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("legacy cascade removed content identity: %d %v", count, err)
	}
	if _, err := ReconcileOwner(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var after meta.PhotoAsset
	if err := db.First(&after, before.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.ContentKey != before.ContentKey || after.PrimaryNodeID != second.ID {
		t.Fatal("remaining original did not retain content identity")
	}
}
