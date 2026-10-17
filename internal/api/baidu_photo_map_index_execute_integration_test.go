package api

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduMapExecutorRejectsUnsafeInputs(t *testing.T) {
	permit := func(context.Context, uint64) error { return nil }
	converter := func(context.Context, baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
		return baidumapjsapi.BD09Coordinate{}, nil
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), nil, 1, 2, permit, converter); err == nil {
		t.Fatal("nil DB accepted")
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), nil, 1, 2, nil, converter); err == nil {
		t.Fatal("nil release permit accepted")
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), nil, 1, 2, permit, nil); err == nil {
		t.Fatal("nil converter accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := executeBaiduPhotoMapIndexIntent(ctx, nil, 1, 2, permit, converter); err == nil {
		t.Fatal("cancelled execution accepted")
	}
	if err := completeBaiduPhotoMapIndexIntent(context.Background(), nil, baiduMapIndexLease{}, baidumapjsapi.BD09Coordinate{}); err == nil {
		t.Fatal("missing real leased transaction accepted")
	}
}

func TestBaiduMapExecutorRealPostgresCompletionCancellationAndPrivacy(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL service required")
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
	defer rootSQL.Close()
	schema := "baidu_map_executor_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	openDB := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		pool, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		pool.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = pool.Close() })
		return db
	}
	db, peer := openDB(), openDB()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.BaiduPhotoMapConsent{},
		&meta.BaiduPhotoMapPosition{}, &meta.BaiduPhotoMapIndexIntent{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "real-baido-map-exec", PasswordHash: "test",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	addPhoto := func(name string, lat, lng float64) meta.PhotoAsset {
		t.Helper()
		node := meta.Node{OwnerID: owner.ID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		media := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
			Latitude: &lat, Longitude: &lng,
		}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("node_id = ?", node.ID).Take(&media).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		mediaTime := media.UpdatedAt
		consent := meta.BaiduPhotoMapConsent{
			OwnerID: owner.ID, AssetID: asset.ID, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: 1,
			SourceMediaUpdatedAt: &mediaTime,
			SourceLatitude:       &lat, SourceLongitude: &lng,
		}
		if err := db.Create(&consent).Error; err != nil {
			t.Fatal(err)
		}
		if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), db, owner.ID, asset.ID, 1); err != nil {
			t.Fatal(err)
		}
		return asset
	}
	approve := func(ctx context.Context, id uint64) error {
		if ctx.Err() != nil || id != owner.ID {
			return errors.New("private Owner denied")
		}
		return nil
	}
	var converted atomic.Int32
	convert := func(ctx context.Context, point baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
		if ctx.Err() != nil {
			return baidumapjsapi.BD09Coordinate{}, ctx.Err()
		}
		converted.Add(1)
		return baidumapjsapi.BD09Coordinate{
			Longitude: point.Longitude + 0.006,
			Latitude:  point.Latitude + 0.006,
		}, nil // synthetic offline converter: NEVER an official Baidu result
	}
	first := addPhoto("gps-zero-zero.jpg", 0, 0)
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, first.ID, nil, convert); err == nil {
		t.Fatal("unapproved callback executed")
	}
	if converted.Load() != 0 {
		t.Fatal("unapproved conversion invoked")
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, first.ID, approve, convert); err != nil {
		t.Fatalf("authorized offline conversion failed: %v", err)
	}
	if converted.Load() != 1 {
		t.Fatal("source was converted more than once")
	}
	var firstJob meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", first.ID).Take(&firstJob).Error; err != nil ||
		firstJob.Status != baiduMapIndexCompleted || firstJob.LeaseToken != "" ||
		firstJob.LeaseUntil != nil || firstJob.Attempts != 1 {
		t.Fatalf("nonterminal or leaked lease: %+v err=%v", firstJob, err)
	}
	view, err := queryBaiduPhotoMapViewport(context.Background(), peer, owner.ID,
		baiduPhotoMapBounds{
			West: -1, East: 1, South: -1, North: 1,
			CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		}, 10, 0)
	if err != nil || view.TotalCount != 1 || len(view.Items) != 1 ||
		view.Items[0].AssetID != first.ID || view.Items[0].Latitude != 0.006 ||
		view.Items[0].Longitude != 0.006 {
		t.Fatalf("terminal row did not atomically commit one indexed point: %+v %v", view, err)
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("asset_id = ?", first.ID).Take(&firstJob).Error; err != nil ||
		firstJob.Status != baiduMapIndexCompleted {
		t.Fatal("cancel-after-completion retroactively altered terminal receipt")
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, owner.ID, first.ID); err == nil {
		t.Fatal("completed job could be claimed twice")
	}

	// A separate Server cancelling a running job must cancel the Context
	// passed to the provider and prevent a stale BD09 write.
	second := addPhoto("cancel-in-flight.jpg", 25.1, 120.3)
	started := make(chan struct{})
	errCh := make(chan error, 1)
	go func() {
		errCh <- executeBaiduPhotoMapIndexIntent(context.Background(), db, owner.ID, second.ID,
			approve, func(ctx context.Context, point baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
				close(started)
				<-ctx.Done()
				return baidumapjsapi.BD09Coordinate{}, ctx.Err()
			})
	}()
	select {
	case <-started:
	case <-time.After(4 * time.Second):
		t.Fatal("private converter did not start")
	}
	startCancel := time.Now()
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("cancelled worker succeeded")
		}
		if time.Since(startCancel) > 3*time.Second {
			t.Fatal("running worker did not promptly propagate cancellation")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("remote cancellation did not propagate to provider context")
	}
	var secondJob meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", second.ID).Take(&secondJob).Error; err != nil ||
		secondJob.Status != baiduMapIndexCancelled || secondJob.LeaseToken != "" {
		t.Fatal("cross-replica cancellation receipt not durable")
	}
	var count int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("cancelled worker resurrected coordinates, count=%d, err=%v", count, err)
	}

	// Owner revocation (rather than job cancel) must also terminate a
	// blocked conversion and prevent any stale index reappearance.
	third := addPhoto("revoke-in-flight.jpg", 26.1, 121.3)
	revokeStarted := make(chan struct{})
	revokeResult := make(chan error, 1)
	go func() {
		revokeResult <- executeBaiduPhotoMapIndexIntent(context.Background(), db, owner.ID, third.ID,
			approve, func(ctx context.Context, point baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
				close(revokeStarted)
				<-ctx.Done()
				return baidumapjsapi.BD09Coordinate{}, ctx.Err()
			})
	}()
	select {
	case <-revokeStarted:
	case <-time.After(4 * time.Second):
		t.Fatal("revocation fixture failed to enter provider")
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), peer, owner.ID, third.ID, 1); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-revokeResult:
		if err == nil {
			t.Fatal("revoked consent did not terminate provider")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("revocation did not cancel the provider context")
	}
	if err := peer.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("revocation let unapproved derived coordinates persist")
	}

	// An uncooperative converter returning after cancellation still cannot
	// commit its result; the postconversion transactional check is decisive.
	fourth := addPhoto("uncooperative-provider.jpg", 27.1, 122.3)
	uncooperativeStarted := make(chan struct{})
	release := make(chan struct{})
	uncooperativeResult := make(chan error, 1)
	go func() {
		uncooperativeResult <- executeBaiduPhotoMapIndexIntent(context.Background(), db, owner.ID, fourth.ID,
			approve, func(ctx context.Context, point baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
				close(uncooperativeStarted)
				<-release
				return baidumapjsapi.BD09Coordinate{Latitude: 27.11, Longitude: 122.31}, nil
			})
	}()
	select {
	case <-uncooperativeStarted:
	case <-time.After(4 * time.Second):
		t.Fatal("uncooperative fixture did not start")
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, fourth.ID); err != nil {
		t.Fatal(err)
	}
	close(release)
	select {
	case err := <-uncooperativeResult:
		if err == nil {
			t.Fatal("uncooperative provider committed after cancellation")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("uncooperative converter did not finish")
	}
	if err := peer.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("uncooperative provider wrote GPS after cancellation")
	}

	// Source version, invalid BD09 output and stale session must fail
	// even if the permit callback itself approves.
	fifth := addPhoto("invalid-bd09.jpg", 28.1, 123.3)
	badBD09 := func(context.Context, baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
		return baidumapjsapi.BD09Coordinate{Latitude: math.NaN(), Longitude: 123.3}, nil
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, fifth.ID, approve, badBD09); err == nil {
		t.Fatal("invalid upstream BD09 was committed")
	}
	if err := peer.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("invalid BD09 altered index")
	}
	var failedReceipt meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", fifth.ID).Take(&failedReceipt).Error; err != nil ||
		failedReceipt.Status != baiduMapIndexQueued || failedReceipt.Attempts != 1 ||
		failedReceipt.RetryAfter == nil || failedReceipt.LeaseToken != "" ||
		failedReceipt.LeaseUntil != nil {
		t.Fatalf("provider failure must settle with durable retry cooldown: %+v %v", failedReceipt, err)
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), db,
		owner.ID, fifth.ID, approve, convert); err == nil {
		t.Fatal("retry cooldown permitted immediate second upstream call")
	}
	sixth := addPhoto("session-rotated.jpg", 29.1, 124.3)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := executeBaiduPhotoMapIndexIntent(context.Background(), peer, owner.ID, sixth.ID, approve, convert); err == nil {
		t.Fatal("stale session intent dispatched")
	}
}
