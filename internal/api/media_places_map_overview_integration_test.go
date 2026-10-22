package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Reproduce the screenshot against real PostgreSQL rows: dozens of distinct
// 0.01-degree photo locations around Jinhua used to occupy ONE world bin.
// The adaptive Owner envelope must yield multiple distinct SDK markers without
// changing original GPS, PhotoAsset counts, Owner ACL or total membership.
func TestMediaMapOverviewRealPostgresJinhuaDistribution(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_overview_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
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
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}
	makeOwner := func(name string) (uint64, uint64) {
		t.Helper()
		user := meta.User{Username: name, PasswordHash: "unused",
			Role: meta.UserRoleUser, SessionVersion: 1}
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&root).Error; err != nil {
			t.Fatal(err)
		}
		return user.ID, root.ID
	}
	addPoint := func(ownerID, rootID uint64, name string, lat, lon float64) {
		t.Helper()
		node := meta.Node{ParentID: &rootID, Name: name, Type: meta.NodeTypeFile,
			OwnerID: ownerID, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		sha := fmt.Sprintf("%064x", node.ID)
		metadata := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: ownerID, NodeRevision: 1,
			SHA256: sha, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Latitude: &lat, Longitude: &lon, IndexState: meta.MediaIndexStateReady,
		}
		if err := db.Create(&metadata).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: ownerID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", node.ID)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	owner, root := makeOwner("jinhua-owner")
	foreign, foreignRoot := makeOwner("jinhua-other-owner")
	for row := 0; row < 8; row++ {
		for col := 0; col < 4; col++ {
			latitude := 29.02 + float64(row)*0.045
			longitude := 119.25 + float64(col)*0.18
			addPoint(owner, root, fmt.Sprintf("jinhua-%d-%d.jpg", row, col),
				latitude, longitude)
		}
	}
	addPoint(owner, root, "duplicate-real-gps.jpg", 29.02, 119.25)
	addPoint(foreign, foreignRoot, "foreign-jinhua.jpg", 29.35, 119.6)
	world := mediaPlaceViewportBounds{West: -180, South: -85, East: 180, North: 85}
	page, err := queryMediaPlacesMapOverview(context.Background(), db, owner, world, false)
	if err != nil {
		t.Fatal(err)
	}
	if !page.Aggregated || page.TotalPhotoCount != 33 ||
		len(page.Items) < 12 || len(page.Items) > mediaMapOverviewMaxPoints {
		t.Fatalf("same-city GPS should produce many bounded Owner pins, not one: items=%d count=%d err=%v",
			len(page.Items), page.TotalPhotoCount, err)
	}
	sum := int64(0)
	positions := map[[2]float64]bool{}
	ids := map[string]bool{}
	for _, item := range page.Items {
		sum += item.ItemCount
		positions[[2]float64{item.SampleLatitude, item.SampleLongitude}] = true
		if ids[item.ID] || item.CoordinateKind != "map_region_sample" ||
			item.CoverNodeID == nil || !strings.HasPrefix(item.ID, "map-region:") {
			t.Fatalf("duplicate or forged Owner region %+v", item)
		}
		ids[item.ID] = true
		parts := strings.Split(item.ID, ":")
		if len(parts) != 7 {
			t.Fatalf("region ID lost real fitted bounds: %q", item.ID)
		}
		coords := make([]float64, 4)
		for i := range coords {
			coords[i], err = strconv.ParseFloat(parts[i+1], 64)
			if err != nil {
				t.Fatal(err)
			}
		}
		fitted := mediaPlaceViewportBounds{West: coords[0], South: coords[1],
			East: coords[2], North: coords[3]}
		if !fitted.valid() || fitted.East-fitted.West >= 2 ||
			fitted.North-fitted.South >= 2 {
			t.Fatalf("world-size bucket still masks actual locality: %+v", fitted)
		}
		row, err := strconv.Atoi(parts[5])
		if err != nil {
			t.Fatal(err)
		}
		col, err := strconv.Atoi(parts[6])
		if err != nil {
			t.Fatal(err)
		}
		if testMediaOverviewBucket(fitted, item.SampleLatitude, item.SampleLongitude) !=
			[2]int{row, col} {
			t.Fatalf("representative GPS outside its own server bucket: %+v", item)
		}
	}
	if sum != 33 || len(positions) < 12 {
		t.Fatalf("distinct Source GPS or PhotoAsset count collapsed: sum=%d positions=%d",
			sum, len(positions))
	}
	// Moving the map to an empty box must not return the world overview or
	// another Owner's photos.
	emptyBounds := mediaPlaceViewportBounds{West: -75, South: 39,
		East: -70, North: 43}
	empty, err := queryMediaPlacesMapOverview(context.Background(), db,
		owner, emptyBounds, false)
	if err != nil || len(empty.Items) != 0 || empty.TotalPhotoCount != 0 {
		t.Fatalf("empty visible Owner area produced pins: %+v err=%v", empty, err)
	}
	foreignOnly, err := queryMediaPlacesMapOverview(context.Background(), db,
		foreign, world, false)
	if err != nil || foreignOnly.TotalPhotoCount != 1 ||
		len(foreignOnly.Items) != 1 {
		t.Fatalf("Owner boundary not preserved: %+v err=%v", foreignOnly, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := queryMediaPlacesMapOverview(ctx, db, owner, world, false); err == nil {
		t.Fatal("cancelled Owner overview was not rejected")
	}

	// Dateline is a separate Owner's genuine narrow viewport. No 360-degree
	// fabricated center or WGS84-to-BD09 approximation is ever introduced.
	addPoint(foreign, foreignRoot, "dateline-east.jpg", 10, 179.7)
	addPoint(foreign, foreignRoot, "dateline-west.jpg", 11, -179.8)
	nearDateline := mediaPlaceViewportBounds{West: 170, South: 9,
		East: -170, North: 12}
	wrapped, err := queryMediaPlacesMapOverview(context.Background(), db,
		foreign, nearDateline, false)
	if err != nil || len(wrapped.Items) != 2 || wrapped.TotalPhotoCount != 2 {
		t.Fatalf("date-line Owner GPS merged or lost: %+v err=%v", wrapped, err)
	}
}
