package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func validBaiduCellRangeQuery() string {
	return "west=100&south=0&east=108&north=8&cell_x=3&cell_y=1&" +
		"asset_id=1&node_id=2&node_revision=3&photo_count=2&" +
		"limit=1&offset=0&range=true"
}

func TestBaiduCellRangeParserFailClosed(t *testing.T) {
	selection, limit, offset, options, err := parseBaiduNativeMapCellItems(
		validBaiduCellRangeQuery() + "&sort_by=added&sort_dir=asc&anchor_node_id=22")
	if err != nil || limit != 1 || offset != 0 ||
		selection.CellX != 3 || selection.CellY != 1 ||
		selection.RepresentativeAssetID != 1 || selection.RepresentativeNodeID != 2 ||
		selection.RepresentativeRevision != 3 || selection.PhotoCount != 2 ||
		options.BaiduCell == nil || options.SortBy != "added" ||
		options.SortDir != "asc" || options.AnchorNodeID != 22 ||
		selection.Bounds.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL {
		t.Fatalf("incorrect bounded BD09 range: %+v %+v %v", selection, options, err)
	}
	if _, _, _, _, err := parseBaiduNativeMapCellItems(
		validBaiduCellRangeQuery() + "&favorite=true&kind=image&captured_from=2026-01-01&captured_to=2027-01-01&time_zone=UTC&album=manual:trip",
	); err != nil {
		t.Fatalf("reviewed filtered Cell Range rejected: %v", err)
	}
	for _, text := range []string{
		"", "range=true", validBaiduCellRangeQuery() + "&ak=secret",
		validBaiduCellRangeQuery() + "&owner_id=1",
		validBaiduCellRangeQuery() + "&coordinate_space=wgs84ll",
		validBaiduCellRangeQuery() + "&favorite=true&favorite=false",
		validBaiduCellRangeQuery() + "&album=unknown",
		validBaiduCellRangeQuery() + "&album=manual:",
		validBaiduCellRangeQuery() + "&album=manual:" + strings.Repeat("x", 600),
		validBaiduCellRangeQuery() + "&fold_duplicates=true",
		validBaiduCellRangeQuery() + "&bbox=100,0,108,8",
		validBaiduCellRangeQuery() + "&favorite=%20true",
		validBaiduCellRangeQuery() + "&captured_from=",
		validBaiduCellRangeQuery() + "&cell_x=4",
		validBaiduCellRangeQuery() + "&west=102",
		validBaiduCellRangeQuery() + "&sort_by=random",
		validBaiduCellRangeQuery() + "&sort_dir=up",
		validBaiduCellRangeQuery() + "&anchor_node_id=0",
		strings.Replace(validBaiduCellRangeQuery(), "range=true", "range=false", 1),
		strings.Replace(validBaiduCellRangeQuery(), "cell_x=3", "cell_x=8", 1),
		strings.Replace(validBaiduCellRangeQuery(), "cell_y=1", "cell_y=-1", 1),
		strings.Replace(validBaiduCellRangeQuery(), "limit=1", "limit=101", 1),
		strings.Replace(validBaiduCellRangeQuery(), "offset=0", "offset=10000001", 1),
		strings.Replace(validBaiduCellRangeQuery(), "photo_count=2", "photo_count=0", 1),
		strings.Replace(validBaiduCellRangeQuery(), "node_revision=3", "node_revision=0", 1),
		strings.Replace(validBaiduCellRangeQuery(), "west=100", "west=NaN", 1),
		strings.Replace(validBaiduCellRangeQuery(), "north=8", "north=0", 1),
		strings.Replace(validBaiduCellRangeQuery(), "west=100", "west=100%ZZ", 1),
	} {
		if _, _, _, _, err := parseBaiduNativeMapCellItems(text); err == nil {
			t.Fatalf("accepted unaudited map media scope %q", text)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := baiduPhotoMapCellMemberNodes(ctx, nil, 1, selection); err == nil {
		t.Fatal("accepted canceled or nil DB")
	}
	if _, err := baiduPhotoMapCellMemberNodes(context.Background(), nil, 1, selection); err == nil {
		t.Fatal("accepted nil DB")
	}
}

func TestBaiduCellRangeActualAuthenticatedRouteDeniesAbsentRelease(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	router := gin.New()
	router.GET("/api/v1/media/places/baidu-jsapi/cell-items", server.listBaiduNativeMapCellItems)
	for _, query := range []string{validBaiduCellRangeQuery(), validBaiduCellRangeQuery() + "&ak=canary"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet,
			"/api/v1/media/places/baidu-jsapi/cell-items?"+query, nil)
		req.Header.Set("Authorization", "Bearer secret_bearer_canary")
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable ||
			!strings.Contains(rec.Body.String(), "map_runtime_unavailable") ||
			strings.Contains(rec.Body.String(), "secret_bearer_canary") ||
			strings.Contains(rec.Body.String(), "canary") ||
			rec.Header().Get("Set-Cookie") != "" ||
			rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("unsafe absent-release map wall response: %d %s", rec.Code, rec.Body.String())
		}
	}
	found := false
	for _, route := range server.Router().Routes() {
		if route.Method == http.MethodGet &&
			route.Path == "/api/v1/media/places/baidu-jsapi/cell-items" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing original authed Router map wall endpoint")
	}
}

func TestBaiduCellRangeOriginalGalleryScopeAndRevocation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real PostgreSQL fixture is unavailable")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootPool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootPool.SetMaxOpenConns(2)
	rootPool.SetMaxIdleConns(0)
	defer rootPool.Close()
	schema := "bd09_cell_wall_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(0)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.BaiduPhotoMapConsent{},
		&meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal(err)
	}
	alice := meta.User{Username: "a3h-cell-alice", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "a3h-cell-bob", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	baseTime := time.Date(2026, 10, 20, 1, 0, 0, 0, time.UTC)
	makePhoto := func(owner uint64, name, kind string, realLat, realLon, derivedLat, derivedLon float64) (meta.Node, meta.PhotoAsset) {
		t.Helper()
		node := meta.Node{Name: name, OwnerID: owner, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{NodeID: node.ID, Size: 12, StorageKey: name, SHA256: strings.Repeat("a", 64)}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		metaRow := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner, NodeRevision: 1, SHA256: file.SHA256,
			IndexState: meta.MediaIndexStateReady, MediaKind: kind,
			MIMEType: map[string]string{meta.MediaKindImage: "image/jpeg", meta.MediaKindVideo: "video/quicktime"}[kind],
			Latitude: &realLat, Longitude: &realLon, CapturedAt: &baseTime,
		}
		if err := db.Create(&metaRow).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&metaRow, "node_id = ?", node.ID).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner, PrimaryNodeID: node.ID, EvidenceKey: "map-cell:" + name,
			Kind: kind,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: kind, MIMEType: metaRow.MIMEType,
			Latitude: &realLat, Longitude: &realLon, CapturedAt: &baseTime,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, NodeID: node.ID, ResourceKind: meta.PhotoResourceKindNode,
			Role: meta.PhotoResourceRolePrimary, Name: name, MediaKind: kind, Size: file.Size,
			MIMEType: metaRow.MIMEType,
		}).Error; err != nil {
			t.Fatal(err)
		}
		consent := meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: owner, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: 1,
			SourceMediaUpdatedAt: &metaRow.UpdatedAt,
			SourceLatitude:       &realLat, SourceLongitude: &realLon,
		}
		if err := db.Create(&consent).Error; err != nil {
			t.Fatal(err)
		}
		position := meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: owner, PrimaryNodeID: node.ID,
			NodeRevision: node.Revision, MediaUpdatedAt: metaRow.UpdatedAt,
			ConsentRevision: consent.Revision, SourceLatitude: realLat,
			SourceLongitude: realLon, Latitude: derivedLat, Longitude: derivedLon,
			CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
		}
		if err := db.Create(&position).Error; err != nil {
			t.Fatal(err)
		}
		return node, asset
	}
	n1, a1 := makePhoto(alice.ID, "first.jpg", meta.MediaKindImage, 1.19, 103.19, 1.20, 103.20)
	n2, a2 := makePhoto(alice.ID, "video.mov", meta.MediaKindVideo, 1.29, 103.29, 1.30, 103.30)
	n3, _ := makePhoto(alice.ID, "far.jpg", meta.MediaKindImage, 1.20, 106.20, 1.21, 106.21)
	_, _ = makePhoto(bob.ID, "not-yours.jpg", meta.MediaKindImage, 1.19, 103.19, 1.20, 103.20)
	bounds := baiduPhotoMapBounds{
		West: 100, South: 0, East: 108, North: 8, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	summary, err := queryBaiduPhotoMapCells(context.Background(), db, alice.ID, bounds)
	if err != nil || summary.TotalCount != 3 || len(summary.Items) != 2 {
		t.Fatalf("owner map cells=%+v %v", summary, err)
	}
	for _, cell := range summary.Items {
		if cell.MediaKind != meta.MediaKindImage && cell.MediaKind != meta.MediaKindVideo {
			t.Fatalf("untrusted Owner map representative kind: %+v", cell)
		}
	}
	// World-fixed grouping must preserve the middle two authenticated
	// PhotoAssets across a same-zoom camera pan. Each Cell Range reuses the
	// SAME SQL quantization and the exact viewport/Owner predicates.
	moved := bounds
	moved.West, moved.East = 100.6, 108.6
	stableA, err := queryBaiduPhotoMapCellsScopedGrid(
		context.Background(), db, alice.ID, bounds, nil, mediaQueryOptions{}, true)
	if err != nil || stableA.GridScheme != baiduPhotoMapWorldStableGrid || stableA.TotalCount != 3 {
		t.Fatalf("stable Owner first viewport failed: %+v %v", stableA, err)
	}
	stableB, err := queryBaiduPhotoMapCellsScopedGrid(
		context.Background(), db, alice.ID, moved, nil, mediaQueryOptions{}, true)
	if err != nil || stableB.GridScheme != baiduPhotoMapWorldStableGrid || stableB.TotalCount != 3 {
		t.Fatalf("stable Owner moved viewport failed: %+v %v", stableB, err)
	}
	var firstStable, secondStable baiduPhotoMapCell
	for _, item := range stableA.Items {
		if item.PhotoCount == 2 {
			firstStable = item
		}
	}
	for _, item := range stableB.Items {
		if item.PhotoCount == 2 {
			secondStable = item
		}
	}
	if firstStable.NodeID != n1.ID || secondStable.NodeID != n1.ID ||
		firstStable.CellX != secondStable.CellX || firstStable.CellY != secondStable.CellY ||
		firstStable.PhotoCount != secondStable.PhotoCount {
		t.Fatalf("middle world tile regrouped on pan: %+v vs %+v", firstStable, secondStable)
	}
	selectedStable := baiduPhotoMapCellSelection{
		Bounds: moved, CellX: secondStable.CellX, CellY: secondStable.CellY,
		RepresentativeAssetID:  secondStable.AssetID,
		RepresentativeNodeID:   secondStable.NodeID,
		RepresentativeRevision: secondStable.NodeRevision,
		PhotoCount:             secondStable.PhotoCount, GridScheme: baiduPhotoMapWorldStableGrid,
	}
	if !baiduPhotoMapCellSelectionCurrent(selectedStable, stableB) {
		t.Fatal("fresh stable Owner Cell not current")
	}
	stableNodes, err := baiduPhotoMapCellMemberNodes(context.Background(), db, alice.ID, selectedStable)
	if err != nil {
		t.Fatalf("stable member nodes: %v", err)
	}
	var stableIDs []uint64
	if err := stableNodes.Scan(&stableIDs).Error; err != nil || len(stableIDs) != 2 {
		t.Fatalf("stable Cell Range must contain two authorized Nodes: %v %+v", err, stableIDs)
	}
	if (stableIDs[0] != n1.ID && stableIDs[1] != n1.ID) ||
		(stableIDs[0] != n2.ID && stableIDs[1] != n2.ID) {
		t.Fatalf("stable Owner Cell member identity changed: %+v", stableIDs)
	}
	// A legacy Cell cannot accidentally borrow a world-stable selection.
	selectedLegacy := selectedStable
	selectedLegacy.GridScheme = ""
	if baiduPhotoMapCellSelectionCurrent(selectedLegacy, stableB) {
		t.Fatal("legacy Cell selection borrowed a stable grouping snapshot")
	}
	// A video-only subset must return the real Owner-authenticated kind,
	// not infer it from an SDK point, guessed MIME or arbitrary filename.
	videoNodes := db.Model(&meta.Node{}).Select("id").
		Where("id = ? AND owner_id = ?", n2.ID, alice.ID)
	videoOnly, err := queryBaiduPhotoMapCellsScoped(
		context.Background(), db, alice.ID, bounds, videoNodes, mediaQueryOptions{})
	if err != nil || videoOnly.TotalCount != 1 || len(videoOnly.Items) != 1 ||
		videoOnly.Items[0].NodeID != n2.ID || videoOnly.Items[0].MediaKind != meta.MediaKindVideo {
		t.Fatalf("video-only Owner map cover kind invalid: %+v err=%v", videoOnly, err)
	}
	var target baiduPhotoMapCellSelection
	for _, c := range summary.Items {
		if c.PhotoCount == 2 {
			target = baiduPhotoMapCellSelection{
				Bounds: bounds, CellX: c.CellX, CellY: c.CellY,
				RepresentativeAssetID: c.AssetID, RepresentativeNodeID: c.NodeID,
				RepresentativeRevision: c.NodeRevision, PhotoCount: c.PhotoCount,
			}
		}
	}
	if !baiduPhotoMapCellSelectionCurrent(target, summary) || target.RepresentativeAssetID != a1.ID ||
		target.RepresentativeNodeID != n1.ID || target.CellX != 3 || target.CellY != 1 {
		t.Fatalf("wrong current representative: %+v %+v", target, summary)
	}
	if baiduPhotoMapCellSelectionCurrent(target, baiduPhotoMapCellPage{}) {
		t.Fatal("missing proof approved")
	}
	ownerServer := &Server{DB: db}
	// The selected Cell must be revalidated against the SAME filtered
	// Gallery members as the Map /cells summary. Here both original media
	// share one Cell, while only the image is an Owner favorite.
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", a1.ID).Update("favorite", true).Error; err != nil {
		t.Fatal(err)
	}
	favorite := true
	filter := mediaQueryOptions{Favorite: &favorite, SortBy: "captured", SortDir: "desc"}
	filteredCells, err := ownerServer.baiduMapCellFilteredSummary(
		context.Background(), alice.ID, target, filter, "")
	if err != nil || filteredCells.TotalCount != 1 || len(filteredCells.Items) != 1 ||
		filteredCells.Items[0].AssetID != a1.ID {
		t.Fatalf("filtered Cell not equal Owner map membership: %+v %v", filteredCells, err)
	}
	filteredCell := target
	filteredCell.PhotoCount = 1
	if !baiduPhotoMapCellSelectionCurrent(filteredCell, filteredCells) ||
		baiduPhotoMapCellSelectionCurrent(target, filteredCells) {
		t.Fatal("stale unfiltered Cell identity accepted under favorite query")
	}
	filter.BaiduCell = &filteredCell
	filteredRange, err := ownerServer.queryMediaItemRange(
		context.Background(), alice.ID, filter, "", 10, 0)
	if err != nil || filteredRange.TotalCount != 1 || len(filteredRange.Items) != 1 ||
		filteredRange.Items[0].Node.ID != n1.ID || filteredRange.Items[0].Node.ID == n2.ID {
		t.Fatalf("filtered Cell sparse Range widens membership: %+v %v", filteredRange, err)
	}
	first, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduCell: &target}, "", 1, 0)
	if err != nil || first.TotalCount != 2 || len(first.Items) != 1 || !target.valid() {
		t.Fatalf("first sparse map cell Gallery range=%+v err=%v", first, err)
	}
	second, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduCell: &target}, "", 1, 1)
	if err != nil || second.TotalCount != 2 || len(second.Items) != 1 ||
		first.Items[0].Node.ID == second.Items[0].Node.ID {
		t.Fatalf("second sparse map cell Gallery range=%+v err=%v", second, err)
	}
	ids := map[uint64]bool{first.Items[0].Node.ID: true, second.Items[0].Node.ID: true}
	if !ids[n1.ID] || !ids[n2.ID] || ids[n3.ID] {
		t.Fatalf("cross-cell or missing image/video: %+v", ids)
	}
	// Full camera view is ONE sparse original Gallery Range, not 64 client
	// Cell requests or a full 100k media-ID list. Both primary media kinds and
	// different cities are admitted only within the exact trusted BD09 camera.
	viewportFirst, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduViewport: &bounds}, "", 2, 0)
	if err != nil || viewportFirst.TotalCount != 3 || len(viewportFirst.Items) != 2 {
		t.Fatalf("first complete camera Range incorrect: %+v %v", viewportFirst, err)
	}
	viewportNext, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduViewport: &bounds}, "", 2, 2)
	if err != nil || viewportNext.TotalCount != 3 || len(viewportNext.Items) != 1 {
		t.Fatalf("second complete camera Range incorrect: %+v %v", viewportNext, err)
	}
	cameraNodes := map[uint64]bool{}
	for _, item := range append(viewportFirst.Items, viewportNext.Items...) {
		cameraNodes[item.Node.ID] = true
	}
	if len(cameraNodes) != 3 || !cameraNodes[n1.ID] || !cameraNodes[n2.ID] ||
		!cameraNodes[n3.ID] {
		t.Fatalf("wrong Owner map-camera membership: %+v", cameraNodes)
	}
	if authorized, err := baiduMapViewportPageMembersStillAuthorized(
		context.Background(), db, alice.ID, bounds, viewportFirst); err != nil || !authorized {
		t.Fatalf("current camera range unexpectedly denied: %v", err)
	}
	peerViewport, err := ownerServer.queryMediaItemRange(context.Background(), bob.ID,
		mediaQueryOptions{BaiduViewport: &bounds}, "", 100, 0)
	if err != nil || peerViewport.TotalCount != 1 || len(peerViewport.Items) != 1 ||
		peerViewport.Items[0].Node.ID == n1.ID {
		t.Fatalf("cross-Owner BD09 camera membership leaked: %+v %v", peerViewport, err)
	}
	peer, err := ownerServer.queryMediaItemRange(context.Background(), bob.ID,
		mediaQueryOptions{BaiduCell: &target}, "", 100, 0)
	if err != nil || peer.TotalCount != 1 || peer.Items[0].Node.ID == n1.ID {
		t.Fatalf("map cell crossed Owner boundary: %+v %v", peer, err)
	}
	peerSummary, err := queryBaiduPhotoMapCells(context.Background(), db, bob.ID, bounds)
	if err != nil || baiduPhotoMapCellSelectionCurrent(target, peerSummary) {
		t.Fatal("other owner's representative incorrectly verified")
	}
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Where("asset_id = ?", a2.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	if authorized, err := baiduMapViewportPageMembersStillAuthorized(
		context.Background(), db, alice.ID, bounds, viewportFirst); err != nil || !authorized {
		t.Fatalf("legacy consent edit incorrectly invalidated Owner map page: allowed=%t err=%v", authorized, err)
	}
	if next, err := queryBaiduPhotoMapCells(context.Background(), db, alice.ID, bounds); err != nil || !baiduPhotoMapCellSelectionCurrent(target, next) {
		t.Fatalf("legacy consent edit unexpectedly invalidated Owner cell: %+v %v", next, err)
	}
	revoked, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduCell: &target}, "", 100, 0)
	if err != nil || revoked.TotalCount != 2 || len(revoked.Items) != 2 {
		t.Fatalf("legacy consent edit unexpectedly changed Owner Cell Range: %+v %v", revoked, err)
	}
	// Gallery sorting is not an authorization predicate. Both originals
	// must remain present regardless of list order, with no foreign Node.
	afterLegacyConsent := map[uint64]bool{
		revoked.Items[0].Node.ID: true, revoked.Items[1].Node.ID: true,
	}
	if len(afterLegacyConsent) != 2 || !afterLegacyConsent[n1.ID] || !afterLegacyConsent[n2.ID] {
		t.Fatalf("legacy consent edit changed original Owner membership: %+v", revoked)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", n1.ID).
		Update("latitude", 2.1).Error; err != nil {
		t.Fatal(err)
	}
	invalid, err := ownerServer.queryMediaItemRange(context.Background(), alice.ID,
		mediaQueryOptions{BaiduCell: &target}, "", 100, 0)
	if err != nil || invalid.TotalCount != 1 || len(invalid.Items) != 1 ||
		invalid.Items[0].Node.ID != n2.ID {
		t.Fatalf("edited source was not excluded or untouched Owner media was lost: %+v %v", invalid, err)
	}
	// The SQL also supports real antimeridian choices without reverse coords.
	wrap := baiduPhotoMapBounds{
		West: 179.9, South: -2, East: -179.9, North: 3,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).
		Where("asset_id = ?", a1.ID).
		Updates(map[string]any{"latitude": 1.2, "longitude": 179.95}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", n1.ID).Update("latitude", 1.19).Error; err != nil {
		t.Fatal(err)
	}
	// A provenance mutation keeps the point hidden even when BD09 longitude
	// is in the wrapped viewport; no fabricated WGS84 replacement is allowed.
	hidden, err := queryBaiduPhotoMapCells(context.Background(), db, alice.ID, wrap)
	if err != nil || hidden.TotalCount != 0 {
		t.Fatalf("stale original-GPS proof incorrectly visible: %+v %v", hidden, err)
	}
	// The selection parse doesn't trust account supplied coordinates or IDs.
	_, _, _, _, err = parseBaiduNativeMapCellItems(validBaiduCellRangeQuery() +
		"&offset=" + strconv.FormatUint(n1.ID, 10))
	if err == nil {
		t.Fatal("duplicated URL parameters accepted")
	}
}
