package api

import (
	"context"
	"fmt"
	"math"
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

func TestBaiduPhotoMapBoundsAndCancellationFailClosed(t *testing.T) {
	good := baiduPhotoMapBounds{West: -180, South: -90, East: 180, North: 90, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	if !good.valid() {
		t.Fatal("valid BD09 map view rejected")
	}
	for _, b := range []baiduPhotoMapBounds{
		{West: 0, East: 0, South: -1, North: 1, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL},
		{West: math.NaN(), East: 1, South: -1, North: 1, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL},
		{West: -181, East: 1, South: -1, North: 1, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL},
		{West: -1, East: 1, South: 10, North: 0, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL},
		{West: -1, East: 1, South: -1, North: 1, CoordinateSpace: "gcj02"},
		{West: 180, East: -180, South: -1, North: 1, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL},
	} {
		if b.valid() {
			t.Fatalf("accepted invalid map envelope: %+v", b)
		}
	}
	if _, err := queryBaiduPhotoMapViewport(context.Background(), nil, 1, good, 1, 0); err == nil {
		t.Fatal("nil DB accepted")
	}
	if _, err := queryBaiduPhotoMapViewport(context.Background(), nil, 0, good, 1, 0); err == nil {
		t.Fatal("missing owner accepted")
	}
	for _, size := range []int{0, 101} {
		if _, err := queryBaiduPhotoMapViewport(context.Background(), nil, 1, good, size, 0); err == nil {
			t.Fatal("unbounded page accepted")
		}
	}
	if _, err := queryBaiduPhotoMapViewport(context.Background(), nil, 1, good, 1, baiduPhotoMapViewportMaxOffset+1); err == nil {
		t.Fatal("unbounded offset accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := queryBaiduPhotoMapViewport(ctx, nil, 1, good, 1, 0); err == nil {
		t.Fatal("cancelled context accepted")
	}
}

func TestBaiduPhotoMapReadRechecksOwnerSourceRevisionsAndDeletion(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	// Do not leave idle connections in the shared Go/API race-test shard.
	// Existing unrelated upload tests also use the same 100-connection
	// PostgreSQL fixture. Our new indexed-map tests must release both pools.
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	rootSQL.SetMaxIdleConns(0)
	defer rootSQL.Close()
	schema := "bd09_map_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
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
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	dbSQL.SetMaxOpenConns(2)
	dbSQL.SetMaxIdleConns(0)
	defer dbSQL.Close()
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.PhotoAsset{}, &meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{}); err != nil {
		t.Fatal(err)
	}
	alice := meta.User{Username: "bd09-alice", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "bd09-bob", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	create := func(owner uint64, name string, sourceLat, sourceLng, mapLat, mapLng float64, space string) (meta.Node, meta.PhotoAsset, meta.BaiduPhotoMapPosition) {
		t.Helper()
		node := meta.Node{OwnerID: owner, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		metadata := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner, NodeRevision: node.Revision,
			MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
			Latitude: &sourceLat, Longitude: &sourceLng,
		}
		if err := db.Create(&metadata).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&metadata, "node_id = ?", node.ID).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: owner, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: name}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		grant := meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: owner, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt: time.Now().UTC().Add(time.Hour),
		}
		if err := db.Create(&grant).Error; err != nil {
			t.Fatal(err)
		}
		version, ok := meta.BaiduPhotoMapProjectionForSpace(space)
		if !ok {
			t.Fatal("unsupported fixture space")
		}
		position := meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: owner, PrimaryNodeID: node.ID,
			NodeRevision: node.Revision, MediaUpdatedAt: metadata.UpdatedAt, ConsentRevision: 1,
			SourceLatitude: sourceLat, SourceLongitude: sourceLng,
			Latitude: mapLat, Longitude: mapLng,
			CoordinateSpace: space, ProjectionVersion: version,
		}
		if err := db.Create(&position).Error; err != nil {
			t.Fatal(err)
		}
		return node, asset, position
	}
	first, firstAsset, _ := create(alice.ID, "one.jpg", 0, 0, 0.0065, 0.0065, meta.BaiduPhotoMapSpaceBD09LL)
	second, secondAsset, _ := create(alice.ID, "two.jpg", 2, 179.8, 2.005, 179.95, meta.BaiduPhotoMapSpaceBD09LL)
	bobNode, bobAsset, _ := create(bob.ID, "other.jpg", -1, -179.8, -1, -179.95, meta.BaiduPhotoMapSpaceBD09LL)

	world := baiduPhotoMapBounds{West: -180, South: -90, East: 180, North: 90, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	page, err := queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, world, 1, 0)
	if err != nil || page.TotalCount != 2 || len(page.Items) != 1 || !page.HasMore || page.Items[0].AssetID != firstAsset.ID {
		t.Fatalf("first owner page incorrect: %+v, %v", page, err)
	}
	next, err := queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, world, 1, 1)
	if err != nil || len(next.Items) != 1 || next.Items[0].AssetID != secondAsset.ID || next.HasMore {
		t.Fatalf("second page incorrect: %+v, %v", next, err)
	}
	peer, err := queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 1 || len(peer.Items) != 1 || peer.Items[0].AssetID != bobAsset.ID {
		t.Fatalf("other owner leaked: %+v, %v", peer, err)
	}
	wrongSpace := world
	wrongSpace.CoordinateSpace = meta.BaiduPhotoMapSpaceWGS84LL
	if got, err := queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, wrongSpace, 100, 0); err != nil || got.TotalCount != 0 {
		t.Fatalf("unconverted GPS incorrectly used for BD09: %+v, %v", got, err)
	}
	wrap := baiduPhotoMapBounds{West: 179.9, South: -2, East: -179.9, North: 3, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	got, err := queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, wrap, 100, 0)
	if err != nil || got.TotalCount != 1 || got.Items[0].AssetID != secondAsset.ID {
		t.Fatalf("antimeridian owner query incorrect: %+v, %v", got, err)
	}

	// A trashed/deleted source Node cannot survive merely because its
	// derived index row has not yet been garbage collected.
	deletedAt := time.Now().UTC()
	if err := db.Model(&meta.Node{}).Where("id = ?", bobNode.ID).Update("deleted_at", deletedAt).Error; err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 0 {
		t.Fatalf("deleted source remained visible: %+v, %v", peer, err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", bobNode.ID).Update("deleted_at", nil).Error; err != nil {
		t.Fatal(err)
	}

	// Consent expiry invalidates existing coordinates even without an index
	// cleanup; extending expiry allows only the SAME revision to return.
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Where("asset_id = ?", bobAsset.ID).
		Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 0 {
		t.Fatalf("expired grant remained visible: %+v %v", peer, err)
	}
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Where("asset_id = ?", bobAsset.ID).
		Updates(map[string]any{"expires_at": time.Now().UTC().Add(time.Hour), "revision": uint64(2)}).Error; err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 0 {
		t.Fatalf("stale position reappeared after grant revision: %+v %v", peer, err)
	}
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Where("asset_id = ?", bobAsset.ID).
		Update("consent_revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 1 {
		t.Fatalf("current grant revision did not permit synthetic row: %+v %v", peer, err)
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), db, bob.ID, bobAsset.ID, 2); err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 0 {
		t.Fatalf("revoked position remained visible: %+v %v", peer, err)
	}
	var deletedPositions int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Where("asset_id = ?", bobAsset.ID).
		Count(&deletedPositions).Error; err != nil || deletedPositions != 0 {
		t.Fatalf("revocation did not purge derived GPS: %d %v", deletedPositions, err)
	}

	// Editing only the ORIGINAL GPS makes derived points invisible immediately.
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", first.ID).Update("latitude", 0.5).Error; err != nil {
		t.Fatal(err)
	}
	page, err = queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, world, 100, 0)
	if err != nil || page.TotalCount != 1 || page.Items[0].AssetID != secondAsset.ID {
		t.Fatalf("stale GPS remained visible: %+v, %v", page, err)
	}
	// A changed node/metadata revision must fail even if original GPS is unchanged.
	if err := db.Model(&meta.Node{}).Where("id = ?", second.ID).Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	page, err = queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, world, 100, 0)
	if err != nil || page.TotalCount != 0 || len(page.Items) != 0 {
		t.Fatalf("stale node revision remained visible: %+v, %v", page, err)
	}
	// Disabled users cannot be read even by an internal query with their ID.
	when := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", bob.ID).Update("disabled_at", when).Error; err != nil {
		t.Fatal(err)
	}
	peer, err = queryBaiduPhotoMapViewport(context.Background(), db, bob.ID, world, 100, 0)
	if err != nil || peer.TotalCount != 0 {
		t.Fatalf("disabled owner appeared: %+v, %v", peer, err)
	}
	// Deleting a logical asset destroys its derived position via the FK.
	if err := db.Delete(&meta.PhotoAsset{}, firstAsset.ID).Error; err != nil {
		t.Fatal(err)
	}
	var remaining int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Where("asset_id = ?", firstAsset.ID).Count(&remaining).Error; err != nil || remaining != 0 {
		t.Fatalf("asset cascade failed: %d, %v", remaining, err)
	}
}
