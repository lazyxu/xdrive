package api

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
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaPlacesFacetAndFilterShareOneGridContract(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_places_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "place-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "one.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "two.mov", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "three.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
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

	latOne, lonOne := 1.3521, 103.8198
	latTwo, lonTwo := 1.3599, 103.8112
	latThree, lonThree := 31.2304, 121.4737
	captured := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	metadata := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[0].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Latitude: &latOne, Longitude: &lonOne, CapturedAt: &captured,
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[1].SHA256, MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			Latitude: &latTwo, Longitude: &lonTwo, CapturedAt: &captured,
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[2].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[2].SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Latitude: &latThree, Longitude: &lonThree, CapturedAt: &captured,
			IndexState: meta.MediaIndexStateReady,
		},
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	assets := []meta.PhotoAsset{
		{OwnerID: owner.ID, PrimaryNodeID: nodes[0].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:1"},
		{OwnerID: owner.ID, PrimaryNodeID: nodes[1].ID, Kind: meta.PhotoAssetKindVideo, EvidenceKey: "node:2"},
		{OwnerID: owner.ID, PrimaryNodeID: nodes[2].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:3"},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	for index := range assets {
		row := metadata[index]
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: assets[index].ID, MediaKind: row.MediaKind, MIMEType: row.MIMEType,
			CapturedAt: row.CapturedAt, Latitude: row.Latitude, Longitude: row.Longitude,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: assets[index].ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: nodes[index].ID, Role: meta.PhotoResourceRolePrimary,
			Name: nodes[index].Name, MediaKind: row.MediaKind, MIMEType: row.MIMEType,
			Size: files[index].Size,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := db.Create(&meta.PhotoPlaceLabel{
		AssetID:         assets[0].ID,
		Resolver:        photointelligence.GeoNamesResolverName,
		ResolverVersion: "test-v1",
		Latitude:        latOne,
		Longitude:       lonOne,
		CountryCode:     "SG",
		Country:         "Singapore",
		City:            "Singapore",
		Locality:        "Singapore",
		Formatted:       "Singapore",
	}).Error; err != nil {
		t.Fatal(err)
	}

	places, err := queryMediaPlaces(context.Background(), db, owner.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	if len(places) != 2 {
		t.Fatalf("places=%+v", places)
	}

	var singapore mediaPlaceDTO
	for _, place := range places {
		if place.ID == "place:135:10381" {
			singapore = place
			break
		}
	}
	if singapore.ID == "" || singapore.ItemCount != 2 ||
		singapore.CoverNodeID == nil || *singapore.CoverNodeID != nodes[0].ID ||
		singapore.Name != "Singapore" ||
		singapore.Attribution != photointelligence.GeoNamesAttribution ||
		singapore.AttributionURL != "https://www.geonames.org/" {
		t.Fatalf("singapore facet=%+v", singapore)
	}

	cell, ok := parseMediaPlaceKey(singapore.ID)
	if !ok {
		t.Fatalf("invalid returned place id %q", singapore.ID)
	}
	server := &Server{DB: db}
	items, err := server.queryMediaItems(
		context.Background(),
		owner.ID,
		mediaQueryOptions{Place: &cell},
		"",
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("filtered items=%+v", items)
	}
	got := map[uint64]bool{}
	for _, item := range items {
		got[item.Node.ID] = true
	}
	if !got[nodes[0].ID] || !got[nodes[1].ID] || got[nodes[2].ID] {
		t.Fatalf("filtered ids=%v", got)
	}
}
