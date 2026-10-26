package api

import (
	"context"
	"errors"
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

func TestBaiduPhotoMapWriteRejectsInvalidAndUnapprovedCandidates(t *testing.T) {
	valid := baiduPhotoMapWriteCandidate{
		OwnerID: 1, AssetID: 2, PrimaryNodeID: 3, NodeRevision: 1,
		MediaUpdatedAt: time.Now().UTC(),
		SourceLatitude: 0, SourceLongitude: 0,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		DerivedLatitude: 0.006, DerivedLongitude: 0.006,
	}
	if _, ok := validBaiduPhotoMapWriteCandidate(valid); !ok {
		t.Fatal("valid original GPS candidate rejected")
	}
	for _, mutate := range []func(*baiduPhotoMapWriteCandidate){
		func(c *baiduPhotoMapWriteCandidate) { c.OwnerID = 0 },
		func(c *baiduPhotoMapWriteCandidate) { c.AssetID = 0 },
		func(c *baiduPhotoMapWriteCandidate) { c.PrimaryNodeID = 0 },
		func(c *baiduPhotoMapWriteCandidate) { c.NodeRevision = 0 },
		func(c *baiduPhotoMapWriteCandidate) { c.MediaUpdatedAt = time.Time{} },
		func(c *baiduPhotoMapWriteCandidate) { c.SourceLatitude = math.NaN() },
		func(c *baiduPhotoMapWriteCandidate) { c.SourceLongitude = math.Inf(1) },
		func(c *baiduPhotoMapWriteCandidate) { c.DerivedLatitude = 95 },
		func(c *baiduPhotoMapWriteCandidate) { c.DerivedLongitude = -181 },
		func(c *baiduPhotoMapWriteCandidate) { c.CoordinateSpace = "bd09" },
		func(c *baiduPhotoMapWriteCandidate) {
			c.CoordinateSpace = meta.BaiduPhotoMapSpaceWGS84LL
			c.DerivedLongitude = 0.006
		},
	} {
		sample := valid
		mutate(&sample)
		if _, ok := validBaiduPhotoMapWriteCandidate(sample); ok {
			t.Fatal("accepted invalid photo location source or coordinate frame")
		}
	}
	allow := func(context.Context, *gorm.DB, uint64, uint64) error { return nil }
	if err := upsertBaiduPhotoMapPosition(context.Background(), nil, valid, allow); err == nil {
		t.Fatal("nil DB accepted")
	}
	if err := upsertBaiduPhotoMapPosition(context.Background(), nil, valid, nil); err == nil {
		t.Fatal("missing privacy verifier accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := upsertBaiduPhotoMapPosition(ctx, nil, valid, allow); err == nil {
		t.Fatal("cancelled write accepted")
	}
	if err := purgeBaiduPhotoMapPosition(context.Background(), nil, 1, 2); err == nil {
		t.Fatal("nil cleanup database accepted")
	}
	if err := purgeBaiduPhotoMapPosition(ctx, nil, 1, 2); err == nil {
		t.Fatal("cancelled cleanup accepted")
	}
}

func TestBaiduPhotoMapWriteTransactionOwnerPrivacyAndRevision(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	rootSQL.SetMaxIdleConns(0)
	defer rootSQL.Close()
	schema := "baidu_index_write_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	values := parsed.Query()
	values.Set("search_path", schema)
	parsed.RawQuery = values.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
		&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	alice := meta.User{Username: "map-writer-alice", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "map-writer-bob", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{OwnerID: alice.ID, Name: "real-original.jpg",
		Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	lat, lng := 31.2304, 121.4737
	media := meta.MediaMetadata{
		NodeID: node.ID, OwnerID: alice.ID, NodeRevision: node.Revision,
		MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
		Latitude: &lat, Longitude: &lng,
	}
	if err := db.Create(&media).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("node_id = ?", node.ID).Take(&media).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{OwnerID: alice.ID, PrimaryNodeID: node.ID,
		Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:original"}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	candidate := baiduPhotoMapWriteCandidate{
		OwnerID: alice.ID, AssetID: asset.ID, PrimaryNodeID: node.ID,
		NodeRevision: node.Revision, MediaUpdatedAt: media.UpdatedAt,
		SourceLatitude: lat, SourceLongitude: lng,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		DerivedLatitude: 31.236, DerivedLongitude: 121.481,
	}
	allowedChecks := 0
	approved := func(ctx context.Context, tx *gorm.DB, ownerID, assetID uint64) error {
		allowedChecks++
		if ctx.Err() != nil || tx == nil || ownerID != alice.ID || assetID != asset.ID {
			return errors.New("test privacy policy denied")
		}
		return nil
	}
	world := baiduPhotoMapBounds{West: 120, South: 30, East: 123, North: 33,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	assertVisible := func(wantCount int64, wantLongitude float64) {
		t.Helper()
		p, err := queryBaiduPhotoMapViewport(context.Background(), db, alice.ID, world, 100, 0)
		if err != nil || p.TotalCount != wantCount || len(p.Items) != int(wantCount) {
			t.Fatalf("incorrect current index result: %+v, %v", p, err)
		}
		if wantCount == 1 && p.Items[0].Longitude != wantLongitude {
			t.Fatalf("wrong derived longitude: %+v", p.Items[0])
		}
	}
	// No verifier means NO write, not a default permission to expose GPS.
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, candidate, nil); !errors.Is(err, errBaiduPhotoMapWriteDenied) {
		t.Fatal("missing durable privacy authorization accepted")
	}
	assertVisible(0, 0)
	// Owner, current media source and trusted in-transaction queue proof are
	// sufficient. No BaiduPhotoMapConsent row is created or required.
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, candidate, approved); err != nil {
		t.Fatalf("valid Owner GPS could not be indexed without photo consent: %v", err)
	}
	assertVisible(1, candidate.DerivedLongitude)
	var row meta.BaiduPhotoMapPosition
	if err := db.First(&row, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.OwnerID != alice.ID || row.SourceLongitude != lng ||
		row.ConsentRevision != 0 || row.MediaUpdatedAt.IsZero() ||
		row.ProjectionVersion != meta.BaiduPhotoMapProjectionGeoconvV2 {
		t.Fatalf("lost original Owner and source provenance: %+v", row)
	}

	// Current source overwrites the single disposable derivative, without
	// creating a duplicate row or needing a new photo-map grant.
	revised := candidate
	revised.DerivedLongitude = 121.482
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, revised, approved); err != nil {
		t.Fatal(err)
	}
	assertVisible(1, revised.DerivedLongitude)
	revised.DerivedLongitude = 121.483
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, revised, func(
		context.Context, *gorm.DB, uint64, uint64,
	) error {
		return errors.New("lease is no longer valid")
	}); err == nil {
		t.Fatal("lost trusted transaction proof overwrote derived location")
	}
	assertVisible(1, 121.482)

	crossOwner := candidate
	crossOwner.OwnerID = bob.ID
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, crossOwner, approved); err == nil {
		t.Fatal("foreign Owner inserted a map point")
	}
	crossNode := candidate
	crossNode.PrimaryNodeID++
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, crossNode, approved); err == nil {
		t.Fatal("different primary Node was accepted")
	}
	stale := candidate
	stale.NodeRevision++
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, stale, approved); err == nil {
		t.Fatal("stale Node revision was accepted")
	}

	// Original GPS edits immediately hide old positions and reject stale writes.
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", node.ID).
		Update("latitude", 31.5001).Error; err != nil {
		t.Fatal(err)
	}
	assertVisible(0, 0)
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, candidate, approved); err == nil {
		t.Fatal("old original GPS resurrected its derived position")
	}
	var newMedia meta.MediaMetadata
	if err := db.Where("node_id = ?", node.ID).Take(&newMedia).Error; err != nil {
		t.Fatal(err)
	}
	fresh := candidate
	fresh.SourceLatitude = *newMedia.Latitude
	fresh.MediaUpdatedAt = newMedia.UpdatedAt
	fresh.DerivedLatitude = 31.506
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, fresh, approved); err != nil {
		t.Fatalf("current GPS needed a second photo-map authorization: %v", err)
	}
	assertVisible(1, fresh.DerivedLongitude)
	if allowedChecks != 3 {
		t.Fatalf("expected current source check each trusted write, got %d", allowedChecks)
	}

	// A disabled Owner is invisible; only that Owner's cleanup can purge rows.
	when := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", alice.ID).
		Update("disabled_at", when).Error; err != nil {
		t.Fatal(err)
	}
	assertVisible(0, 0)
	if err := upsertBaiduPhotoMapPosition(context.Background(), db, fresh, approved); err == nil {
		t.Fatal("disabled account wrote a location")
	}
	if err := purgeBaiduPhotoMapPosition(context.Background(), db, bob.ID, asset.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Where("asset_id = ?", asset.ID).
		Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("another Owner purged private location: %d %v", count, err)
	}
	if err := purgeBaiduPhotoMapPosition(context.Background(), db, alice.ID, asset.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Where("asset_id = ?", asset.ID).
		Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("Owner cleanup did not remove derivative: %d %v", count, err)
	}
	var grants int64
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Count(&grants).Error; err != nil || grants != 0 {
		t.Fatalf("new index path unexpectedly generated map consent: %d %v", grants, err)
	}
}
