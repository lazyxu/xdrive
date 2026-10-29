//go:build linux

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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This verifies the unchanged production Owner/Cell/Anchor SQL with real
// disposable PostgreSQL17, not a synthetic JS Range or the provider SDK.
// It is independent of the shared React/Child protocol and browser tests.
func TestPlacesOwnerCell142AnchorPagesPG17(t *testing.T) {
	if os.Getenv("XD_PLACES_CELL_142_ANCHOR_PG17") != "1" {
		t.Skip("only dedicated Owner Cell 142 + anchor PostgreSQL17 test")
	}
	if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
		t.Fatal("refusing Owner Cell integration test outside disposable CI")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("missing disposable PostgreSQL connection")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("disposable PostgreSQL unavailable")
	}
	rootPool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootPool.SetMaxOpenConns(2)
	defer rootPool.Close()

	schema := "places_cell142_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal("failed to create isolated test schema")
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal("failed to open isolated test schema")
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(4)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.BaiduPhotoMapConsent{},
		&meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal("failed to migrate isolated map schema")
	}
	owner := meta.User{Username: "places-cell142-owner", PasswordHash: "fixture",
		Role: meta.UserRoleUser, SessionVersion: 1}
	stranger := meta.User{Username: "places-cell142-stranger", PasswordHash: "fixture",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&stranger).Error; err != nil {
		t.Fatal(err)
	}
	captured := time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC)
	// One distinct original Node/PhotoAsset/hash per item. Equal hashes could
	// exercise duplicate folding rather than the intended 142 logical photos.
	seed := func(userID uint64, serial int, realLat, realLon, bdLat, bdLon float64) uint64 {
		t.Helper()
		name := fmt.Sprintf("owner-cell-map-%d.jpg", serial)
		hash := fmt.Sprintf("%064x", serial+1000)
		node := meta.Node{OwnerID: userID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal("seed Node failed")
		}
		file := meta.File{NodeID: node.ID, Size: 12, StorageKey: name, SHA256: hash}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal("seed File failed")
		}
		indexed := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: userID, NodeRevision: 1, SHA256: hash,
			IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: &realLat, Longitude: &realLon,
			CapturedAt: &captured,
		}
		if err := db.Create(&indexed).Error; err != nil {
			t.Fatal("seed MediaMetadata failed")
		}
		asset := meta.PhotoAsset{
			OwnerID: userID, PrimaryNodeID: node.ID,
			EvidenceKey: "places-cell142:" + name, Kind: meta.MediaKindImage,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal("seed PhotoAsset failed")
		}
		photo := meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Latitude: &realLat, Longitude: &realLon, CapturedAt: &captured,
		}
		if err := db.Create(&photo).Error; err != nil {
			t.Fatal("seed PhotoMetadata failed")
		}
		resource := meta.PhotoResource{
			AssetID: asset.ID, NodeID: node.ID, ResourceKind: meta.PhotoResourceKindNode,
			Role: meta.PhotoResourceRolePrimary, Name: name,
			MediaKind: meta.MediaKindImage, Size: file.Size, MIMEType: "image/jpeg",
		}
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal("seed PhotoResource failed")
		}
		consent := meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: userID, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: 1,
			SourceMediaUpdatedAt: &indexed.UpdatedAt,
			SourceLatitude:       &realLat, SourceLongitude: &realLon,
		}
		if err := db.Create(&consent).Error; err != nil {
			t.Fatal("seed map derivation provenance failed")
		}
		position := meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: userID, PrimaryNodeID: node.ID,
			NodeRevision: node.Revision, MediaUpdatedAt: indexed.UpdatedAt,
			ConsentRevision: consent.Revision, SourceLatitude: realLat,
			SourceLongitude: realLon, Latitude: bdLat, Longitude: bdLon,
			CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
		}
		if err := db.Create(&position).Error; err != nil {
			t.Fatal("seed BD09 position failed")
		}
		return node.ID
	}
	const photoCount = 142
	const nearbyCount = 28
	for i := 0; i < photoCount; i++ {
		seed(owner.ID, i+1, 1.15, 103.15, 1.30, 103.30)
	}
	for i := 0; i < nearbyCount; i++ {
		seed(owner.ID, photoCount+i+1, 5.15, 106.15, 5.30, 106.30)
	}
	foreignNode := seed(stranger.ID, 10000, 1.15, 103.15, 1.30, 103.30)
	bounds := baiduPhotoMapBounds{
		West: 100, South: 0, East: 108, North: 8,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	// This disposable 142+28 Owner fixture executes several separate
	// fully sorted Range+Anchor SQL reads. A single 45s cumulative deadline
	// expires on slower shared runners after the GPS revocation is proven,
	// producing a false "stale anchor" result. Keep a finite 3m bound.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	summary, err := queryBaiduPhotoMapCells(ctx, db, owner.ID, bounds)
	if err != nil || summary.TotalCount != photoCount+nearbyCount || len(summary.Items) != 2 {
		t.Fatalf("distinct Owner Cell counts invalid: total=%d cells=%d err=%v",
			summary.TotalCount, len(summary.Items), err)
	}
	var selected baiduPhotoMapCellSelection
	for _, cell := range summary.Items {
		if cell.PhotoCount == photoCount {
			selected = baiduPhotoMapCellSelection{
				Bounds: bounds, CellX: cell.CellX, CellY: cell.CellY,
				RepresentativeAssetID: cell.AssetID, RepresentativeNodeID: cell.NodeID,
				RepresentativeRevision: cell.NodeRevision, PhotoCount: cell.PhotoCount,
			}
		}
	}
	if !baiduPhotoMapCellSelectionCurrent(selected, summary) ||
		selected.CellX != 3 || selected.CellY != 1 {
		t.Fatal("missing or mismatched signed 142-photo Owner Cell")
	}
	server := &Server{DB: db}
	options := mediaQueryOptions{BaiduCell: &selected, SortBy: "captured", SortDir: "desc"}
	var pages [3]mediaItemRangeDTO
	seen := make(map[uint64]struct{}, photoCount)
	for i, offset := range []int{0, 48, 96} {
		page, queryErr := server.queryMediaItemRange(ctx, owner.ID, options, "", 48, offset)
		expected := 48
		if offset == 96 {
			expected = 46
		}
		if queryErr != nil || page.TotalCount != photoCount || page.Offset != offset ||
			page.Limit != 48 || len(page.Items) != expected {
			t.Fatalf("Owner Cell page %d invalid count=%d items=%d err=%v",
				i, page.TotalCount, len(page.Items), queryErr)
		}
		for _, item := range page.Items {
			if item.Node.ID == 0 || item.Node.Revision == 0 {
				t.Fatal("invalid Owner Node on signed cell page")
			}
			if _, duplicate := seen[item.Node.ID]; duplicate {
				t.Fatal("duplicate Node across signed Owner pages")
			}
			seen[item.Node.ID] = struct{}{}
		}
		pages[i] = page
	}
	if len(seen) != photoCount {
		t.Fatal("missing or cross-cell signed Owner photo")
	}
	late := pages[2].Items[45]
	options.AnchorNodeID = late.Node.ID
	anchored, err := server.queryMediaItemRange(ctx, owner.ID, options, "", 48, 0)
	if err != nil || anchored.TotalCount != photoCount ||
		anchored.AnchorIndex == nil || *anchored.AnchorIndex != 141 {
		t.Fatalf("late Viewer anchor unavailable or wrong: count=%d anchor_valid=%t err=%v",
			anchored.TotalCount, anchored.AnchorIndex != nil, err)
	}
	// A clicked late item is authorized from its absolute server index, not
	// falsely restricted to page zero. The second bounded page checks identity.
	pageOffset := int(*anchored.AnchorIndex) / 48 * 48
	actual, err := server.queryMediaItemRange(ctx, owner.ID,
		mediaQueryOptions{BaiduCell: &selected, SortBy: "captured", SortDir: "desc"},
		"", 48, pageOffset)
	localIndex := int(*anchored.AnchorIndex) - pageOffset
	if err != nil || pageOffset != 96 || actual.TotalCount != photoCount ||
		len(actual.Items) != 46 || actual.Items[localIndex].Node.ID != late.Node.ID ||
		actual.Items[localIndex].Node.Revision != late.Node.Revision {
		t.Fatal("late Viewer Node did not survive separate scoped Owner revalidation")
	}
	// Foreign-Owner anchor cannot turn the same Cell URL into a global gallery.
	options.AnchorNodeID = foreignNode
	forbidden, err := server.queryMediaItemRange(ctx, owner.ID, options, "", 48, 0)
	if err != nil || forbidden.TotalCount != photoCount ||
		forbidden.AnchorIndex != nil {
		t.Fatal("foreign Owner Node was accepted as current Cell Viewer anchor")
	}
	options.AnchorNodeID = late.Node.ID
	foreignScope, err := server.queryMediaItemRange(ctx, stranger.ID, options, "", 48, 0)
	if err != nil || foreignScope.TotalCount != 1 || foreignScope.AnchorIndex != nil ||
		len(foreignScope.Items) != 1 || foreignScope.Items[0].Node.ID != foreignNode {
		t.Fatal("Owner identity was widened by foreign map Cell anchor")
	}
	// A source GPS mutation revokes the exact selected count and Node proof.
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", late.Node.ID).Update("latitude", 9.9).Error; err != nil {
		t.Fatal("failed to mutate disposable source GPS")
	}
	changed, err := queryBaiduPhotoMapCells(ctx, db, owner.ID, bounds)
	if err != nil || changed.TotalCount != photoCount+nearbyCount-1 ||
		baiduPhotoMapCellSelectionCurrent(selected, changed) {
		t.Fatal("stale 142-photo Cell survived source GPS revision mutation")
	}
	options.AnchorNodeID = late.Node.ID
	revoked, err := server.queryMediaItemRange(ctx, owner.ID, options, "", 48, 0)
	if err != nil || revoked.TotalCount != photoCount-1 ||
		revoked.AnchorIndex != nil {
		t.Fatal("changed source is still eligible as an Owner Cell Viewer anchor")
	}
	t.Log("Owner PG17 Cell142: 48+48+46 pages, 142nd anchor, foreign-owner exclusion and source-GPS invalidation verified")
}
