package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestQueryMediaItemsFilters(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_filters_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "gallery-filter-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		ParentID: &root.ID,
		Name:     "Camera",
		Type:     meta.NodeTypeDir,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &folder.ID, Name: "Singapore-trip.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "studio-render.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "family-video.mov", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := []meta.File{
		{NodeID: nodes[0].ID, Size: 100, StorageKey: "one", SHA256: strings.Repeat("1", 64)},
		{NodeID: nodes[1].ID, Size: 200, StorageKey: "two", SHA256: strings.Repeat("2", 64)},
		{NodeID: nodes[2].ID, Size: 300, StorageKey: "three", SHA256: strings.Repeat("3", 64)},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	capturedOne := time.Date(2026, 9, 1, 10, 30, 0, 0, time.UTC)
	capturedTwo := time.Date(2026, 9, 15, 8, 0, 0, 0, time.UTC)
	capturedThree := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	lat, lon := 1.3521, 103.8198
	metadata := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[0].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			CapturedAt: &capturedOne, Latitude: &lat, Longitude: &lon,
			CameraMake: "Apple", CameraModel: "iPhone 15 Pro", LensModel: "Main Camera",
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[1].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			CapturedAt: &capturedTwo,
			CameraMake: "Sony", CameraModel: "ILCE-7M4", LensModel: "FE 35mm",
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[2].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[2].SHA256, MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			CapturedAt: &capturedThree, Latitude: &lat, Longitude: &lon,
			CameraMake: "Apple", CameraModel: "iPhone 15 Pro",
			IndexState: meta.MediaIndexStateReady,
		},
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}

	assets := []meta.PhotoAsset{
		{OwnerID: owner.ID, PrimaryNodeID: nodes[0].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:1"},
		{OwnerID: owner.ID, PrimaryNodeID: nodes[1].ID, Kind: meta.PhotoAssetKindRAWPair, EvidenceKey: "group:2"},
		{OwnerID: owner.ID, PrimaryNodeID: nodes[2].ID, Kind: meta.PhotoAssetKindVideo, EvidenceKey: "node:3"},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	resources := []meta.PhotoResource{
		{AssetID: assets[0].ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: nodes[0].ID, Role: meta.PhotoResourceRolePrimary, Name: nodes[0].Name, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", Size: files[0].Size},
		{AssetID: assets[1].ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: nodes[1].ID, Role: meta.MediaGroupRoleRendered, Name: nodes[1].Name, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", Size: files[1].Size},
		{AssetID: assets[2].ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: nodes[2].ID, Role: meta.PhotoResourceRolePrimary, Name: nodes[2].Name, MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime", Size: files[2].Size},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}

	collection := meta.PhotoCollection{
		OwnerID:     owner.ID,
		ExternalKey: fmt.Sprintf("folder:%d", folder.ID),
		Kind:        meta.PhotoCollectionKindFolder,
		Name:        folder.Name,
		State:       meta.PhotoCollectionStateActive,
	}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.PhotoCollectionAsset{
		{CollectionID: collection.ID, AssetID: assets[0].ID, Position: 0},
		{CollectionID: collection.ID, AssetID: assets[1].ID, Position: 1},
	}).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	assertIDs := func(name string, options mediaQueryOptions, albumKind string, albumID uint64, want ...uint64) {
		t.Helper()
		t.Run(name, func(t *testing.T) {
			items, err := server.queryMediaItems(
				context.Background(),
				owner.ID,
				options,
				albumKind,
				albumID,
				100,
				0,
			)
			if err != nil {
				t.Fatal(err)
			}
			got := make([]uint64, 0, len(items))
			for _, item := range items {
				got = append(got, item.Node.ID)
			}
			sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
			sort.Slice(want, func(i, j int) bool { return want[i] < want[j] })
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("ids=%v want=%v", got, want)
			}
		})
	}

	assertIDs(
		"search filename camera lens",
		mediaQueryOptions{Search: "iphone"},
		"",
		0,
		nodes[0].ID,
		nodes[2].ID,
	)
	assertIDs(
		"asset kind",
		mediaQueryOptions{AssetKind: meta.PhotoAssetKindRAWPair},
		"",
		0,
		nodes[1].ID,
	)
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	assertIDs(
		"capture date",
		mediaQueryOptions{CapturedFrom: &from, CapturedTo: &to},
		"",
		0,
		nodes[0].ID,
	)
	withLocation := true
	assertIDs(
		"with location",
		mediaQueryOptions{HasLocation: &withLocation},
		"",
		0,
		nodes[0].ID,
		nodes[2].ID,
	)
	withoutLocation := false
	assertIDs(
		"without location",
		mediaQueryOptions{HasLocation: &withoutLocation},
		"",
		0,
		nodes[1].ID,
	)
	assertIDs(
		"album search",
		mediaQueryOptions{Search: "sony"},
		meta.PhotoCollectionKindFolder,
		folder.ID,
		nodes[1].ID,
	)
	assertIDs(
		"combined",
		mediaQueryOptions{
			Search:      "iphone",
			AssetKind:   meta.PhotoAssetKindImage,
			HasLocation: &withLocation,
		},
		"",
		0,
		nodes[0].ID,
	)
}
