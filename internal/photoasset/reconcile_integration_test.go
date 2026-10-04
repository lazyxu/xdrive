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

func TestReconcileOwnerBuildsLogicalAssetsResourcesAndCollections(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_asset_domain_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "photo-asset-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		ParentID: &root.ID, Name: "Camera", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &folder.ID, Name: "IMG_0001.HEIC", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "IMG_0001.MOV", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "single.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "archive.livp", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := []meta.File{
		{NodeID: nodes[0].ID, Size: 100, StorageKey: "still", SHA256: strings.Repeat("a", 64)},
		{NodeID: nodes[1].ID, Size: 200, StorageKey: "motion", SHA256: strings.Repeat("b", 64)},
		{NodeID: nodes[2].ID, Size: 300, StorageKey: "single", SHA256: strings.Repeat("c", 64)},
		{NodeID: nodes[3].ID, Size: 400, StorageKey: "livp", SHA256: strings.Repeat("d", 64)},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	captured := now.Add(-time.Hour).Truncate(time.Microsecond)
	metadata := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[0].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/heic",
			Width: 4032, Height: 3024, CapturedAt: &captured, IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[1].SHA256, MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			DurationMS: 2400, IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[2].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[2].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Width: 1200, Height: 800, IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[3].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[3].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "application/x-livp",
			ContainerKind: "livp", Width: 1024, Height: 768, DurationMS: 1800,
			IndexState: meta.MediaIndexStateReady,
		},
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	group := meta.MediaGroup{
		OwnerID: owner.ID, Kind: meta.MediaGroupKindLivePhoto,
		EvidenceKey: "apple-asset:test-live-photo",
	}
	if err := db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.MediaGroupItem{
		{GroupID: group.ID, NodeID: nodes[0].ID, Role: meta.MediaGroupRoleStill, Ordinal: 0},
		{GroupID: group.ID, NodeID: nodes[1].ID, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.MediaDerivedResource{
		{
			NodeID: nodes[3].ID, Role: meta.MediaDerivedResourceRoleStill,
			OwnerID: owner.ID, NodeRevision: 1, SHA256: files[3].SHA256,
			Name: "still.jpg", MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			ByteOffset: 32, ByteSize: 120,
		},
		{
			NodeID: nodes[3].ID, Role: meta.MediaDerivedResourceRoleMotion,
			OwnerID: owner.ID, NodeRevision: 1, SHA256: files[3].SHA256,
			Name: "motion.mov", MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			ByteOffset: 152, ByteSize: 220,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	source := meta.Source{
		OwnerID: owner.ID, Name: "Photos", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &folder.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	sourceItems := []meta.SourceItem{
		{
			SourceID: source.ID, ExternalID: "remote:still", NodeID: &nodes[0].ID,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, LastSeenAt: now,
		},
		{
			SourceID: source.ID, ExternalID: "remote:motion", NodeID: &nodes[1].ID,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, LastSeenAt: now,
		},
		{
			SourceID: source.ID, ExternalID: "remote:single", NodeID: &nodes[2].ID,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, LastSeenAt: now,
		},
	}
	if err := db.Create(&sourceItems).Error; err != nil {
		t.Fatal(err)
	}
	album := meta.SourceCollection{
		SourceID: source.ID, ExternalID: "album:one", Kind: "album", Name: "Imported",
		State: meta.SourceCollectionStateActive, LastSeenAt: now,
	}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.SourceCollectionItem{
		{
			CollectionID: album.ID, SourceItemID: sourceItems[0].ID,
			Position: 0, LastSeenRunID: "run", LastSeenAt: now,
		},
		{
			CollectionID: album.ID, SourceItemID: sourceItems[1].ID,
			Position: 1, LastSeenRunID: "run", LastSeenAt: now,
		},
		{
			CollectionID: album.ID, SourceItemID: sourceItems[2].ID,
			Position: 2, LastSeenRunID: "run", LastSeenAt: now,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	report, err := ReconcileOwner(context.Background(), db, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if report.Assets != 3 || report.Resources != 6 {
		t.Fatalf("report=%+v", report)
	}

	var assets []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).Order("primary_node_id ASC").Find(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if len(assets) != 3 {
		t.Fatalf("assets=%+v", assets)
	}
	var live meta.PhotoAsset
	if err := db.Where("owner_id = ? AND kind = ?", owner.ID, meta.PhotoAssetKindLivePhoto).
		First(&live).Error; err != nil {
		t.Fatal(err)
	}
	if live.PrimaryNodeID != nodes[0].ID {
		t.Fatalf("live primary=%d want=%d", live.PrimaryNodeID, nodes[0].ID)
	}
	var liveResources []meta.PhotoResource
	if err := db.Where("asset_id = ?", live.ID).Order("ordinal ASC").Find(&liveResources).Error; err != nil {
		t.Fatal(err)
	}
	if len(liveResources) != 2 ||
		liveResources[0].Role != meta.MediaGroupRoleStill ||
		liveResources[1].Role != meta.MediaGroupRoleMotion {
		t.Fatalf("live resources=%+v", liveResources)
	}

	var livp meta.PhotoAsset
	if err := db.Where("owner_id = ? AND primary_node_id = ?", owner.ID, nodes[3].ID).
		First(&livp).Error; err != nil {
		t.Fatal(err)
	}
	if livp.Kind != meta.PhotoAssetKindLivePhoto {
		t.Fatalf("livp kind=%q want=%q", livp.Kind, meta.PhotoAssetKindLivePhoto)
	}
	var livpResources []meta.PhotoResource
	if err := db.Where("asset_id = ?", livp.ID).Order("ordinal ASC").Find(&livpResources).Error; err != nil {
		t.Fatal(err)
	}
	if len(livpResources) != 3 ||
		livpResources[0].Role != meta.PhotoResourceRoleContainer ||
		livpResources[1].ResourceKind != meta.PhotoResourceKindDerived ||
		livpResources[2].ResourceKind != meta.PhotoResourceKindDerived {
		t.Fatalf("livp resources=%+v", livpResources)
	}

	var sourceCollection meta.PhotoCollection
	if err := db.Where("owner_id = ? AND external_key = ?", owner.ID, fmt.Sprintf("source:%d", album.ID)).
		First(&sourceCollection).Error; err != nil {
		t.Fatal(err)
	}
	var sourceMemberships []meta.PhotoCollectionAsset
	if err := db.Where("collection_id = ?", sourceCollection.ID).
		Order("position ASC").Find(&sourceMemberships).Error; err != nil {
		t.Fatal(err)
	}
	if len(sourceMemberships) != 2 {
		t.Fatalf("source memberships=%+v", sourceMemberships)
	}
	if sourceMemberships[0].AssetID != live.ID {
		t.Fatalf("first source membership asset=%d want live=%d", sourceMemberships[0].AssetID, live.ID)
	}

	var folderCollection meta.PhotoCollection
	if err := db.Where("owner_id = ? AND external_key = ?", owner.ID, fmt.Sprintf("folder:%d", folder.ID)).
		First(&folderCollection).Error; err != nil {
		t.Fatal(err)
	}
	var folderCount int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).
		Where("collection_id = ?", folderCollection.ID).Count(&folderCount).Error; err != nil {
		t.Fatal(err)
	}
	if folderCount != 3 {
		t.Fatalf("folder memberships=%d want=3", folderCount)
	}

	var assetMetadata meta.PhotoMetadata
	if err := db.First(&assetMetadata, "asset_id = ?", live.ID).Error; err != nil {
		t.Fatal(err)
	}
	if assetMetadata.Width != 4032 || assetMetadata.Height != 3024 ||
		assetMetadata.CapturedAt == nil || !assetMetadata.CapturedAt.Equal(captured) {
		t.Fatalf("photo metadata=%+v", assetMetadata)
	}

	idsBefore := make(map[uint64]uint64)
	for _, asset := range assets {
		idsBefore[asset.PrimaryNodeID] = asset.ID
	}
	if _, err := ReconcileOwner(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var again []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).Find(&again).Error; err != nil {
		t.Fatal(err)
	}
	for _, asset := range again {
		if idsBefore[asset.PrimaryNodeID] != asset.ID {
			t.Fatalf("asset id changed for primary node %d: %d -> %d",
				asset.PrimaryNodeID, idsBefore[asset.PrimaryNodeID], asset.ID)
		}
	}
}
