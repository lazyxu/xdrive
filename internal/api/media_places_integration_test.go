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
	"github.com/lazyxu/xdrive/internal/geoquery"
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
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
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
	nearSelection, err := geoquery.Parse("1.3521,103.8198,5", "")
	if err != nil {
		t.Fatal(err)
	}
	nearRange, err := server.queryMediaItemRange(
		context.Background(), owner.ID, mediaQueryOptions{Geo: nearSelection}, "", 10, 0)
	if err != nil || nearRange.TotalCount != 2 || len(nearRange.Items) != 2 {
		t.Fatalf("nearby WGS84 ranged count=%+v err=%v", nearRange, err)
	}
	bboxSelection, err := geoquery.Parse("", "103.8,1.3,103.9,1.4")
	if err != nil {
		t.Fatal(err)
	}
	bboxRange, err := server.queryMediaItemRange(
		context.Background(), owner.ID, mediaQueryOptions{Geo: bboxSelection}, "", 1, 0)
	if err != nil || bboxRange.TotalCount != 2 || len(bboxRange.Items) != 1 {
		t.Fatalf("bounded bbox ranged count=%+v err=%v", bboxRange, err)
	}
	emptySelection, err := geoquery.Parse("0,0,1", "")
	if err != nil {
		t.Fatal(err)
	}
	emptyRange, err := server.queryMediaItemRange(
		context.Background(), owner.ID, mediaQueryOptions{Geo: emptySelection}, "", 10, 0)
	if err != nil || emptyRange.TotalCount != 0 || len(emptyRange.Items) != 0 {
		t.Fatalf("empty nearby range=%+v err=%v", emptyRange, err)
	}
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

	// P0-Places-A1: the legacy top-24 collection is deliberately incomplete.
	// The page endpoint must count EVERY owner-scoped valid GPS cell and let
	// Web/Mobile Web/Desktop reach cells beyond the first and thousandth.
	firstPage, err := queryMediaPlacesPage(context.Background(), db, owner.ID, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if firstPage.TotalCount != 2 || len(firstPage.Items) != 1 ||
		!firstPage.HasMore || firstPage.Offset != 0 {
		t.Fatalf("initial page=%+v", firstPage)
	}
	if firstPage.Items[0].CoordinateKind != "grid_cell_center" ||
		firstPage.Items[0].SampleLatitude == firstPage.Items[0].Latitude &&
			firstPage.Items[0].SampleLongitude == firstPage.Items[0].Longitude {
		t.Fatalf("must distinguish a real representative GPS from grid center: %+v", firstPage.Items[0])
	}

	addGPSAsset := func(label string, lat, lon *float64, userID, rootID uint64) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &rootID, Name: label, Type: meta.NodeTypeFile,
			OwnerID: userID, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID: node.ID, Size: 100, StorageKey: "gps-" + label,
			SHA256: fmt.Sprintf("%064x", node.ID),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		mm := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: userID, NodeRevision: 1,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: lat, Longitude: lon,
			CapturedAt: &captured, IndexState: meta.MediaIndexStateReady,
		}
		if err := db.Create(&mm).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: userID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", node.ID),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", CapturedAt: &captured,
			Latitude: lat, Longitude: lon,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: label, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: 100,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}
	for i := 0; i < 27; i++ {
		lat, lon := 10.001+float64(i)*0.1, 20.002
		addGPSAsset(fmt.Sprintf("cell-%02d.jpg", i), &lat, &lon, owner.ID, root.ID)
	}
	zero := 0.0
	zeroID := addGPSAsset("zero.jpg", &zero, &zero, owner.ID, root.ID)
	edgeLat, edgeLon := 90.0, 180.0
	addGPSAsset("valid-edge.jpg", &edgeLat, &edgeLon, owner.ID, root.ID)
	invalidLat, invalidLon := 91.0, 11.0
	invalidID := addGPSAsset("invalid-lat.jpg", &invalidLat, &invalidLon, owner.ID, root.ID)
	partialLat := 12.0
	partialID := addGPSAsset("partial-gps.jpg", &partialLat, nil, owner.ID, root.ID)
	other := meta.User{
		Username: "another-place-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	otherRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: other.ID, Revision: 1}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	otherLat, otherLon := 45.013, -73.456
	addGPSAsset("other-owner.jpg", &otherLat, &otherLon, other.ID, otherRoot.ID)

	// A3b3a1: the same Owner-filtered 0.01-degree cell grouping is now
	// selectable by map viewport without ever materializing every photo.
	fullViewport := mediaPlaceViewportBounds{West: -180, South: -90, East: 180, North: 90}
	visible, err := queryMediaPlacesViewport(context.Background(), db, owner.ID, fullViewport, 5, 0)
	if err != nil || visible.TotalCount != 31 || visible.TotalPhotoCount != 32 ||
		len(visible.Items) != 5 || !visible.HasMore {
		t.Fatalf("full viewport=%+v error=%v", visible, err)
	}
	empty, err := queryMediaPlacesViewport(context.Background(), db, owner.ID,
		mediaPlaceViewportBounds{West: -74, South: 44, East: -72, North: 46}, 64, 0)
	if err != nil || empty.TotalCount != 0 || empty.TotalPhotoCount != 0 ||
		len(empty.Items) != 0 || empty.HasMore {
		t.Fatalf("foreign-owner viewport=%+v error=%v", empty, err)
	}
	foreign, err := queryMediaPlacesViewport(context.Background(), db, other.ID,
		mediaPlaceViewportBounds{West: -74, South: 44, East: -72, North: 46}, 64, 0)
	if err != nil || foreign.TotalCount != 1 || foreign.TotalPhotoCount != 1 {
		t.Fatalf("second owner viewport=%+v error=%v", foreign, err)
	}
	zeroViewport, err := queryMediaPlacesViewport(context.Background(), db, owner.ID,
		mediaPlaceViewportBounds{West: -1, South: -1, East: 1, North: 1}, 64, 0)
	if err != nil || zeroViewport.TotalCount != 1 || zeroViewport.TotalPhotoCount != 1 ||
		len(zeroViewport.Items) != 1 || zeroViewport.Items[0].ID != "place:0:0" {
		t.Fatalf("zero-location viewport=%+v error=%v", zeroViewport, err)
	}
	wrapped, err := queryMediaPlacesViewport(context.Background(), db, owner.ID,
		mediaPlaceViewportBounds{West: 170, South: 89, East: -170, North: 90}, 64, 0)
	if err != nil || wrapped.TotalCount != 1 || wrapped.TotalPhotoCount != 1 ||
		len(wrapped.Items) != 1 || wrapped.Items[0].ID != "place:9000:18000" ||
		wrapped.Items[0].SampleLatitude != 90 || wrapped.Items[0].SampleLongitude != 180 {
		t.Fatalf("wrapped dateline viewport=%+v error=%v", wrapped, err)
	}

	const expectedCells = 31 // 2 existing, 27 extra, zero and 90/180
	gotCells := make(map[string]bool)
	for offset := 0; offset < expectedCells; offset += 24 {
		page, err := queryMediaPlacesPage(context.Background(), db, owner.ID, 24, offset)
		if err != nil {
			t.Fatal(err)
		}
		if page.TotalCount != expectedCells || page.Offset != offset || page.Limit != 24 ||
			page.HasMore != (offset+len(page.Items) < expectedCells) {
			t.Fatalf("page at offset %d: %+v", offset, page)
		}
		for _, place := range page.Items {
			if gotCells[place.ID] {
				t.Fatalf("duplicate place page member %q", place.ID)
			}
			gotCells[place.ID] = true
			if place.CoordinateKind != "grid_cell_center" ||
				place.SampleLatitude < -90 || place.SampleLatitude > 90 ||
				place.SampleLongitude < -180 || place.SampleLongitude > 180 {
				t.Fatalf("invalid representative point %+v", place)
			}
		}
	}
	if len(gotCells) != expectedCells || !gotCells["place:0:0"] ||
		!gotCells["place:9000:18000"] {
		t.Fatalf("missing valid zero/edge cells: %v", gotCells)
	}
	afterEnd, err := queryMediaPlacesPage(context.Background(), db, owner.ID, 24, 500)
	if err != nil || afterEnd.TotalCount != expectedCells ||
		len(afterEnd.Items) != 0 || afterEnd.HasMore {
		t.Fatalf("past-last page=%+v error=%v", afterEnd, err)
	}
	withGPS, withoutGPS := true, false
	present, err := server.queryMediaItems(
		context.Background(), owner.ID, mediaQueryOptions{HasLocation: &withGPS},
		"", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	absent, err := server.queryMediaItems(
		context.Background(), owner.ID, mediaQueryOptions{HasLocation: &withoutGPS},
		"", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	seenWith := map[uint64]bool{}
	for _, item := range present {
		seenWith[item.Node.ID] = true
	}
	seenWithout := map[uint64]bool{}
	for _, item := range absent {
		seenWithout[item.Node.ID] = true
	}
	if !seenWith[zeroID] || seenWith[invalidID] || seenWith[partialID] ||
		seenWithout[zeroID] || !seenWithout[invalidID] || !seenWithout[partialID] {
		t.Fatalf("GPS presence must use same valid predicate as Places: with=%v without=%v", seenWith, seenWithout)
	}

}
