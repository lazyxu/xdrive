package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
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
	gormlogger "gorm.io/gorm/logger"
)

func TestBaiduMapQuotaAdmissionRejectsUntrustedInputs(t *testing.T) {
	reject := func(context.Context, uint64) error { return errors.New("no operator account approval") }
	synthetic := func(context.Context, baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
		t.Fatal("unsafe converter invoked")
		return baidumapjsapi.BD09Coordinate{}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, item := range []struct {
		ctx   context.Context
		owner uint64
		asset uint64
	}{
		{nil, 1, 2}, {ctx, 1, 2},
		{context.Background(), 0, 2}, {context.Background(), 1, 0},
	} {
		if err := executeBaiduPhotoMapIndexQuotaAdmitted(item.ctx, nil,
			item.owner, item.asset, reject, synthetic); err == nil {
			t.Fatal("unsafe dispatch preflight accepted")
		}
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), nil,
		1, 2, nil, synthetic); err == nil {
		t.Fatal("missing account permit accepted")
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), nil,
		1, 2, reject, nil); err == nil {
		t.Fatal("missing trusted converter accepted")
	}
}

func TestBaiduMapQuotaAdmissionRealPostgresTwoReplicas(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlRoot, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlRoot.SetMaxOpenConns(2)
	defer sqlRoot.Close()
	schema := "baidu_quota_dispatch_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	open := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDB.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = sqlDB.Close() })
		return db
	}
	db, peer := open(), open()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.BaiduPhotoMapConsent{},
		&meta.BaiduPhotoMapIndexIntent{}, &meta.BaiduPhotoMapPosition{},
		&meta.BaiduGeoconvQuotaBucket{}, &meta.BaiduGeoconvFlight{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "baidu-quota-owner", PasswordHash: "test",
		Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "baidu-quota-other", PasswordHash: "test",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	addPhoto := func(name string, lat, lng float64) meta.PhotoAsset {
		t.Helper()
		node := meta.Node{OwnerID: owner.ID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		media := meta.MediaMetadata{
			OwnerID: owner.ID, NodeID: node.ID, NodeRevision: 1,
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
			Kind: meta.PhotoAssetKindImage, EvidenceKey: "dispatch:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		sourceTime := media.UpdatedAt
		consent := meta.BaiduPhotoMapConsent{
			OwnerID: owner.ID, AssetID: asset.ID, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
			SourceMediaUpdatedAt: &sourceTime,
			SourceLatitude:       &lat, SourceLongitude: &lng,
		}
		if err := db.Create(&consent).Error; err != nil {
			t.Fatal(err)
		}
		if err := enqueueBaiduPhotoMapIndexIntent(context.Background(),
			db, owner.ID, asset.ID, 1); err != nil {
			t.Fatal(err)
		}
		return asset
	}
	first := addPhoto("zero-zero.jpg", 0, 0)
	second := addPhoto("second.jpg", 35.243951, 119.612345)
	third := addPhoto("quota-denied.jpg", 35.4, 119.8)
	licenceRevoked := addPhoto("licence-denied.jpg", 36.3, 120.2)
	changed := addPhoto("source-changed.jpg", 38.5, 122.3)

	licence := func(ctx context.Context, id uint64) error {
		if ctx == nil || ctx.Err() != nil || id != owner.ID {
			return errors.New("unlicensed account")
		}
		return nil // test-only; NOT actual third-party Baidu entitlement
	}
	var sent atomic.Int32
	converter := func(ctx context.Context, point baidumapjsapi.WGS84Coordinate) (baidumapjsapi.BD09Coordinate, error) {
		if ctx.Err() != nil {
			t.Fatal("cancelled context reached offline converter")
		}
		sent.Add(1)
		return baidumapjsapi.BD09Coordinate{
			Longitude: point.Longitude + 0.006,
			Latitude:  point.Latitude + 0.006,
		}, nil // synthetic only, NEVER an external Baidu result
	}
	countQuota := func(want int64) {
		t.Helper()
		var rows []meta.BaiduGeoconvQuotaBucket
		if err := peer.Order("scope_id").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		if want == 0 {
			if len(rows) != 0 {
				t.Fatalf("quota charged before account proof: %d rows", len(rows))
			}
			return
		}
		if len(rows) != 2 || rows[0].Requests != want || rows[1].Requests != want ||
			rows[0].Points != want || rows[1].Points != want {
			t.Fatalf("unexpected actual fleet+Owner quota accounting, count=%d", len(rows))
		}
	}
	countFlights := func(want int64) {
		t.Helper()
		var got int64
		if err := peer.Model(&meta.BaiduGeoconvFlight{}).Count(&got).Error; err != nil || got != want {
			t.Fatalf("in-flight capacity leaked: count=%d want=%d err=%v", got, want, err)
		}
	}
	deny := func(context.Context, uint64) error {
		return errors.New("reviewed provider licence unavailable")
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), peer,
		owner.ID, licenceRevoked.ID, deny, converter); err == nil {
		t.Fatal("unlicensed map conversion accepted")
	}
	var original meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", licenceRevoked.ID).Take(&original).Error; err != nil ||
		original.Status != baiduMapIndexQueued || original.Attempts != 0 {
		t.Fatal("denied account was incorrectly claimed")
	}
	countQuota(0)
	if sent.Load() != 0 {
		t.Fatal("converter was invoked on denied licence")
	}
	countFlights(0)
	// Capacity rejection happens AFTER the real account check but BEFORE any
	// queue claim, permit recheck, PostgreSQL quota or converter invocation.
	holding, err := acquireBaiduGeoconvFlight(context.Background(), db, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), peer,
		owner.ID, licenceRevoked.ID, licence, converter); err == nil {
		t.Fatal("Owner saturated flight was still dispatched")
	}
	if err := db.Where("asset_id = ?", licenceRevoked.ID).Take(&original).Error; err != nil ||
		original.Status != baiduMapIndexQueued || original.Attempts != 0 {
		t.Fatal("capacity denial prematurely claimed the queued job")
	}
	countQuota(0)
	countFlights(1)
	if sent.Load() != 0 {
		t.Fatal("capacity denial invoked converter")
	}
	if err := releaseBaiduGeoconvFlight(context.Background(), peer, holding); err != nil {
		t.Fatal(err)
	}
	countFlights(0)

	// Revocation during claim must still deny before charging the quota.
	var checks atomic.Int32
	revokeOnSecondCheck := func(ctx context.Context, id uint64) error {
		if checks.Add(1) == 2 {
			return errors.New("account release revoked after initial check")
		}
		return licence(ctx, id)
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), db,
		owner.ID, licenceRevoked.ID, revokeOnSecondCheck, converter); err == nil {
		t.Fatal("revoked account admitted before quota")
	}
	countQuota(0)
	if sent.Load() != 0 || checks.Load() != 2 {
		t.Fatal("licence was not verified twice")
	}
	countFlights(0)

	// No client-provided coordinate: both real sources come only from the
	// current PostgreSQL Owner/Asset/Node/Ready Media/consent lock chain.
	var sqlLog bytes.Buffer
	verbose := db.Session(&gorm.Session{Logger: gormlogger.New(
		log.New(&sqlLog, "", 0), gormlogger.Config{LogLevel: gormlogger.Info},
	)})
	var secretReads atomic.Int32
	var forwardCalls atomic.Int32
	serverAK := func(ctx context.Context, id uint64) (string, error) {
		if ctx.Err() != nil || id != owner.ID {
			return "", errors.New("untrusted Owner")
		}
		secretReads.Add(1)
		return "synthetic-owner-server-ak-no-network", nil
	}
	offlineForward := func(
		ctx context.Context, ak string, points []baidumapjsapi.WGS84Coordinate,
	) ([]baidumapjsapi.BD09Coordinate, error) {
		if ctx.Err() != nil || ak != "synthetic-owner-server-ak-no-network" ||
			len(points) != 1 || points[0].Longitude != 0 || points[0].Latitude != 0 {
			t.Fatal("untrusted source/AK reached offline forwarding")
		}
		forwardCalls.Add(1)
		got, err := converter(ctx, points[0])
		if err != nil {
			return nil, err
		}
		return []baidumapjsapi.BD09Coordinate{got}, nil
	}
	// The private one-shot selector chooses exactly one already-queued Owner
	// intent, never reads PhotoAsset GPS or Browser-provided map viewport.
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id != first.ID {
		t.Fatalf("first explicit Owner job was not selected: %d %v", id, err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, other.ID); err == nil ||
		id != 0 {
		t.Fatal("Owner with no queued map job enumerated another Owner")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), db,
		owner.ID, deny, serverAK, offlineForward); err == nil {
		t.Fatal("unlicensed one-shot demand admitted")
	}
	if secretReads.Load() != 0 || forwardCalls.Load() != 0 {
		t.Fatal("denied one-shot demand accessed Server AK or exported GPS")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), verbose,
		owner.ID, licence, serverAK, offlineForward); err != nil {
		t.Fatalf("first quota-limited Owner one-shot demand failed: %v", err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id != second.ID {
		t.Fatalf("completed photo remained selected, or next Owner job skipped: %d %v", id, err)
	}
	if secretReads.Load() != 1 || forwardCalls.Load() != 1 {
		t.Fatal("exact single Server AK read and forward send required after quota")
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), peer,
		owner.ID, second.ID, licence, converter); err != nil {
		t.Fatalf("second cross-replica conversion rejected: %v", err)
	}
	if sent.Load() != 2 {
		t.Fatalf("conversion call count=%d want=2", sent.Load())
	}
	// A future PostgreSQL retry clock must not be bypassed by selecting the
	// smallest pending asset. The other queued jobs remain eligible instead.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", third.ID).
		Update("retry_after", time.Now().UTC().Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id == third.ID {
		t.Fatal("early PostgreSQL retry cooldown was selected")
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", third.ID).Update("retry_after", nil).Error; err != nil {
		t.Fatal(err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id != third.ID {
		t.Fatalf("ready third Owner job not selected: %d %v", id, err)
	}
	countQuota(2)
	countFlights(0)
	var rows []meta.BaiduPhotoMapPosition
	if err := peer.Order("asset_id").Find(&rows).Error; err != nil || len(rows) != 2 {
		t.Fatalf("derived photo index count=%d err=%v", len(rows), err)
	}
	var index meta.BaiduPhotoMapPosition
	if err := peer.Where("asset_id = ?", first.ID).Take(&index).Error; err != nil ||
		index.Latitude != 0.006 || index.Longitude != 0.006 {
		t.Fatalf("zero GPS pair was discarded or swapped: %+v %v", index, err)
	}
	if err := executeBaiduPhotoMapIndexWithTrustedForward(context.Background(), db,
		owner.ID, third.ID, licence, serverAK, offlineForward); err == nil {
		t.Fatal("third same-minute Owner quota overrun was accepted")
	}
	if secretReads.Load() != 1 || forwardCalls.Load() != 1 {
		t.Fatal("quota denial must not read Server AK or send exact source GPS")
	}
	countQuota(2)
	if sent.Load() != 2 {
		t.Fatal("quota denial reached external conversion callback")
	}
	if strings.Contains(sqlLog.String(), "35.243951") || strings.Contains(sqlLog.String(), "119.612345") ||
		strings.Contains(sqlLog.String(), "synthetic-owner-server-ak-no-network") {
		t.Fatal("source GPS escaped private GORM SQL logging")
	}
	// Cross-owner and expired-source revisions never bypass current consent.
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), peer,
		other.ID, third.ID, licence, converter); err == nil {
		t.Fatal("different Owner reached map conversion")
	}
	countQuota(2)
	var asset meta.PhotoAsset
	if err := db.Where("id = ?", changed.ID).Take(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", asset.PrimaryNodeID).
		Update("latitude", 38.6).Error; err != nil {
		t.Fatal(err)
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(context.Background(), peer,
		owner.ID, changed.ID, licence, converter); err == nil {
		t.Fatal("GPS-edited photo bypassed source revision and owner consent")
	}
	countQuota(2)
	if sent.Load() != 2 {
		t.Fatal("changed source triggered conversion")
	}

	// A crashed Server leaves an expired intent, not renewed permission to
	// immediately export GPS. The next explicit one-shot demand performs
	// repair ONLY and never touches the current Server AK or fleet quota.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", third.ID).
		Updates(map[string]any{
			"status": baiduMapIndexLeased, "attempts": 1,
			"lease_token": "offline-expired-lease", "retry_after": nil,
			"lease_until": time.Now().UTC().Add(-time.Minute),
		}).Error; err != nil {
		t.Fatal(err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id != third.ID {
		t.Fatalf("expired lease not prioritized for repair: %d %v", id, err)
	}
	// Quotas exhausted from the two previous photo conversions. Expired
	// repair happens before quota and must not invoke our offline sender.
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), peer,
		owner.ID, licence, serverAK, offlineForward); err == nil {
		t.Fatal("expired lease repair incorrectly reported a conversion")
	}
	if secretReads.Load() != 1 || forwardCalls.Load() != 1 {
		t.Fatal("expired lease repair read Server AK or exported a photo")
	}
	var repaired meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", third.ID).Take(&repaired).Error; err != nil ||
		repaired.Status != baiduMapIndexQueued || repaired.RetryAfter == nil ||
		repaired.LeaseToken != "" || repaired.LeaseUntil != nil {
		t.Fatalf("one-shot did not durably repair its expired intent: %+v %v", repaired, err)
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), peer, owner.ID); err != nil ||
		id == third.ID {
		t.Fatal("post-crash cooldown was selected immediately")
	}
	countQuota(2)
	countFlights(0)
}
