package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduPhotoMapIndexIntentFailClosedInputs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, input := range []struct {
		ctx               context.Context
		db                *gorm.DB
		owner, asset, rev uint64
	}{
		{nil, nil, 1, 2, 1},
		{ctx, nil, 1, 2, 1},
		{context.Background(), nil, 0, 2, 1},
		{context.Background(), nil, 1, 0, 1},
		{context.Background(), nil, 1, 2, 0},
	} {
		if err := enqueueBaiduPhotoMapIndexIntent(input.ctx, input.db, input.owner, input.asset, input.rev); !errors.Is(err, errBaiduMapIndexIntentDenied) {
			t.Fatalf("unsafe queue accepted: %v", err)
		}
		if _, err := claimBaiduPhotoMapIndexIntent(input.ctx, input.db, input.owner, input.asset); !errors.Is(err, errBaiduMapIndexIntentDenied) {
			t.Fatalf("unsafe claim accepted: %v", err)
		}
		if err := cancelBaiduPhotoMapIndexIntent(input.ctx, input.db, input.owner, input.asset); !errors.Is(err, errBaiduMapIndexIntentDenied) {
			t.Fatalf("unsafe cancellation accepted: %v", err)
		}
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), nil, baiduMapIndexLease{}); err == nil {
		t.Fatal("empty, unauthenticated lease accepted")
	}
}

func TestBaiduPhotoMapIndexIntentAcrossPostgresReplicas(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real isolated PostgreSQL required")
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
	schema := "baidu_map_intent_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	newDB := func() *gorm.DB {
		t.Helper()
		db, e := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
		if e != nil {
			t.Fatal(e)
		}
		pool, e := db.DB()
		if e != nil {
			t.Fatal(e)
		}
		pool.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = pool.Close() })
		return db
	}
	db, peer := newDB(), newDB()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.PhotoAsset{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
		&meta.BaiduPhotoMapIndexIntent{},
	); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"latitude", "longitude", "source_latitude", "source_longitude", "server_ak", "browser_ak"} {
		if db.Migrator().HasColumn(&meta.BaiduPhotoMapIndexIntent{}, column) {
			t.Fatalf("private job persists forbidden credential or GPS column: %s", column)
		}
	}
	var initialCount int64
	if err := peer.Model(&meta.BaiduPhotoMapIndexIntent{}).Count(&initialCount).Error; err != nil || initialCount != 0 {
		t.Fatalf("migration dispatched work: %d, %v", initialCount, err)
	}
	alice := meta.User{Username: "private-map-alice", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "private-map-bob", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	addPhoto := func(name string, lat, lng float64) meta.PhotoAsset {
		t.Helper()
		node := meta.Node{OwnerID: alice.ID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
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
		asset := meta.PhotoAsset{
			OwnerID: alice.ID, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage,
			EvidenceKey: "original:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		sourceTime := media.UpdatedAt
		grant := meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: alice.ID, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
			SourceMediaUpdatedAt: &sourceTime,
			SourceLatitude:       &lat, SourceLongitude: &lng,
		}
		if err := db.Create(&grant).Error; err != nil {
			t.Fatal(err)
		}
		return asset
	}
	first := addPhoto("original-zero-zero.jpg", 0, 0)
	if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), db, bob.ID, first.ID, 1); !errors.Is(err, errBaiduMapIndexIntentDenied) {
		t.Fatal("different Owner can enqueue foreign photo")
	}
	if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, first.ID, 2); !errors.Is(err, errBaiduMapIndexIntentDenied) {
		t.Fatal("consent revision spoof accepted")
	}
	// Real concurrent admission on two independent connection pools must
	// produce one persisted intent and must never read AK or export GPS.
	var queueErrors atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			conn := db
			if i%2 == 1 {
				conn = peer
			}
			if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), conn, alice.ID, first.ID, 1); err != nil {
				queueErrors.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if queueErrors.Load() != 0 {
		t.Fatalf("concurrent duplicate queue was not idempotent: %d", queueErrors.Load())
	}
	var row meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", first.ID).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != baiduMapIndexQueued || row.Attempts != 0 ||
		row.OwnerID != alice.ID || row.ConsentRevision != 1 || row.SessionVersion != 1 ||
		row.PrimaryNodeID != first.PrimaryNodeID || row.LeaseToken != "" {
		t.Fatalf("invalid durable snapshot: %+v", row)
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, bob.ID, first.ID); !errors.Is(err, errBaiduMapIndexIntentDenied) {
		t.Fatal("cross-owner cancellation accepted")
	}
	// A fleet of independently connected claimants must get exactly one
	// currently valid lease. The other calls cannot double-dispatch.
	var admitted atomic.Int32
	var wrong atomic.Int32
	var winner baiduMapIndexLease
	var mu sync.Mutex
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			conn := db
			if i%2 == 1 {
				conn = peer
			}
			lease, err := claimBaiduPhotoMapIndexIntent(context.Background(), conn, alice.ID, first.ID)
			if err == nil {
				admitted.Add(1)
				mu.Lock()
				winner = lease
				mu.Unlock()
			} else if !errors.Is(err, errBaiduMapIndexIntentDenied) {
				wrong.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if admitted.Load() != 1 || wrong.Load() != 0 || winner.source.latitude != 0 || winner.source.longitude != 0 {
		t.Fatalf("lease not exclusive or true GPS (0,0) lost: admitted=%d wrong=%d", admitted.Load(), wrong.Load())
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), peer, winner); err != nil {
		t.Fatalf("valid separate-pool lease rejected: %v", err)
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), db, winner); err == nil {
		t.Fatal("cancelled in-flight lease remained valid")
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, first.ID); err == nil {
		t.Fatal("cancelled work was re-claimed")
	}
	if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, first.ID, 1); err == nil {
		t.Fatal("cancelled job was re-enqueued without a newer explicit grant")
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, first.ID); err != nil {
		t.Fatal("idempotent cancel failed")
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), db, alice.ID, first.ID, 1); err != nil {
		t.Fatalf("existing Owner consent revocation failed: %v", err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, first.ID, 1); err == nil {
		t.Fatal("revoked consent permitted new job")
	}
	var cancelled meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", first.ID).Take(&cancelled).Error; err != nil ||
		cancelled.Status != baiduMapIndexCancelled || cancelled.LeaseToken != "" ||
		cancelled.CancelRequestedAt == nil {
		t.Fatalf("cancellation was not durable: %+v %v", cancelled, err)
	}
	// Lease expiration is based on PostgreSQL time; stale generations must
	// not be able to write or dispatch, even after another replica reclaims.
	second := addPhoto("another-current-photo.jpg", 35.12, 139.61)
	if err := enqueueBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID, 1); err != nil {
		t.Fatal(err)
	}
	lease1, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Where("asset_id = ?", second.ID).
		Update("lease_until", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), db, lease1); err == nil {
		t.Fatal("expired lease still usable")
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, second.ID); err == nil {
		t.Fatal("expired claim must repair only, never bypass retry delay")
	}
	var repaired meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", second.ID).Take(&repaired).Error; err != nil ||
		repaired.Status != baiduMapIndexQueued || repaired.RetryAfter == nil ||
		repaired.LeaseToken != "" || repaired.LeaseUntil != nil {
		t.Fatalf("expired lease lacked durable cooldown: %+v %v", repaired, err)
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID); err == nil {
		t.Fatal("PostgreSQL-clock cooldown bypassed")
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Where("asset_id = ?", second.ID).
		Update("retry_after", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	lease2, err := claimBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, second.ID)
	if err != nil || lease2.token == lease1.token || lease2.attempt != 2 {
		t.Fatalf("expired cross-replica retry invalid: %+v, %v", lease2, err)
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), db, lease1); err == nil {
		t.Fatal("stale generation retained dispatch authority")
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), peer, lease2); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Where("asset_id = ?", second.ID).
		Update("lease_until", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID); err == nil {
		t.Fatal("second expired lease bypassed explicit cooldown")
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Where("asset_id = ?", second.ID).
		Update("retry_after", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	lease3, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID)
	if err != nil || lease3.attempt != 3 {
		t.Fatalf("third and last bounded claim not admitted: %v", err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Where("asset_id = ?", second.ID).
		Update("lease_until", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, second.ID); err == nil {
		t.Fatal("unbounded retries accepted")
	}
	var exhausted meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", second.ID).Take(&exhausted).Error; err != nil ||
		exhausted.Status != baiduMapIndexFailed || exhausted.RetryAfter != nil ||
		exhausted.LeaseToken != "" || exhausted.LeaseUntil != nil || exhausted.Attempts != 3 {
		t.Fatalf("third expired lease did not become durable terminal failure: %+v %v", exhausted, err)
	}
	if err := cancelBaiduPhotoMapIndexIntent(context.Background(), peer, alice.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := claimBaiduPhotoMapIndexIntent(context.Background(), db, alice.ID, second.ID); err == nil {
		t.Fatal("terminal failed attempt re-dispatched")
	}
	// Session rotation invalidates even a previously valid consent-linked
	// claim. No raw GPS/AK or derived index is created by this test.
	if err := db.Model(&meta.User{}).Where("id = ?", alice.ID).
		Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := validateBaiduPhotoMapIndexLease(context.Background(), peer, lease3); err == nil {
		t.Fatal("rotated Owner session retained a lease")
	}
	var positions int64
	if err := peer.Model(&meta.BaiduPhotoMapPosition{}).Count(&positions).Error; err != nil || positions != 0 {
		t.Fatalf("queue-only phase unexpectedly created derived coordinates: %d %v", positions, err)
	}
}
