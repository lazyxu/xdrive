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

func TestBaiduPhotoMapAutoPlanRejectsUnsafeAndUnboundedInputs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		ctx   context.Context
		owner uint64
		limit int
	}{
		{nil, 1, 1}, {ctx, 1, 1}, {context.Background(), 0, 1},
		{context.Background(), 1, 0},
		{context.Background(), 1, baiduPhotoMapAutoPlanMaxItems + 1},
	} {
		if ids, more, err := queryBaiduPhotoMapAutoCandidates(tc.ctx, nil, tc.owner, 0, tc.limit); err == nil || len(ids) != 0 || more {
			t.Fatalf("unsafe AutoPlan query accepted: %v, %v, %v", ids, more, err)
		}
		if progress, err := planBaiduPhotoMapOwnerBackfillBatch(tc.ctx, nil, tc.owner, 4, tc.limit); err == nil || progress.Queued != 0 || progress.NextAfter != 4 {
			t.Fatalf("unsafe AutoPlan enqueue accepted: %+v, %v", progress, err)
		}
	}
}

// Pure clock edges are testable even without a PostgreSQL fixture.
func TestBaiduPhotoMapFailedRetryCooldown(t *testing.T) {
	now := time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
	before := now.Add(-23 * time.Hour)
	due := now.Add(-baiduPhotoMapAutoFailedRetryCooldown)
	future := now.Add(time.Minute)
	past := now.Add(-time.Minute)
	for _, tc := range []struct {
		name    string
		updated time.Time
		retry   *time.Time
		want    bool
	}{
		{"recent", before, nil, false},
		{"due", due, nil, true},
		{"zero", time.Time{}, nil, false},
		{"future", now.Add(time.Hour), nil, false},
		{"retry_after_future", due, &future, false},
		{"retry_after_expired", due, &past, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := baiduPhotoMapFailedRetryDue(now, tc.updated, tc.retry); got != tc.want {
				t.Fatalf("retry due=%t want=%t", got, tc.want)
			}
		})
	}
}

func TestBaiduPhotoMapAutoPlanOwnerGPSNoConsentPostgres(t *testing.T) {
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
	schema := "map_auto_plan_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(3)
	pool.SetMaxIdleConns(0)
	defer pool.Close()

	// The per-photo consent table is deliberately NOT migrated at all.
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.BaiduPhotoMapPosition{}, &meta.BaiduPhotoMapIndexIntent{}); err != nil {
		t.Fatal(err)
	}
	forbidden := db.Migrator().HasTable(&meta.BaiduPhotoMapConsent{})
	if forbidden {
		t.Fatal("fixture accidentally depends on legacy map consent table")
	}
	alice := meta.User{Username: "map-auto-alice", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "map-auto-bob", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, owner := range []*meta.User{&alice, &bob} {
		if err := db.Create(owner).Error; err != nil {
			t.Fatal(err)
		}
	}
	type photo struct {
		asset meta.PhotoAsset
		node  meta.Node
		media meta.MediaMetadata
	}
	makePhoto := func(owner uint64, name string, lat, lon *float64) photo {
		t.Helper()
		node := meta.Node{OwnerID: owner, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		media := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner, NodeRevision: node.Revision,
			IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
			Latitude: lat, Longitude: lon,
		}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&media, "node_id = ?", node.ID).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "map:auto:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		return photo{asset: asset, node: node, media: media}
	}
	lat, lon := 35.0, 139.0
	absent := makePhoto(alice.ID, "missing.jpg", &lat, &lon)
	current := makePhoto(alice.ID, "current.jpg", &lat, &lon)
	stale := makePhoto(alice.ID, "stale.jpg", &lat, &lon)
	foreign := makePhoto(bob.ID, "other.jpg", &lat, &lon)
	makePhoto(alice.ID, "no-gps.jpg", nil, nil)
	outsideLat := 86.0
	makePhoto(alice.ID, "outside-bd09.jpg", &outsideLat, &lon)
	// Live Photo is a single logical GPS asset, but a sidecar must not
	// generate a separate map location for the same original photo.
	if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", absent.asset.ID).
		Update("kind", meta.PhotoAssetKindLivePhoto).Error; err != nil {
		t.Fatal(err)
	}
	sidecar := makePhoto(alice.ID, "sidecar.jpg", &lat, &lon)
	if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", sidecar.asset.ID).
		Update("kind", meta.PhotoAssetKindSidecar).Error; err != nil {
		t.Fatal(err)
	}

	position := func(p photo, sourceLat float64, revision uint64) meta.BaiduPhotoMapPosition {
		return meta.BaiduPhotoMapPosition{
			AssetID: p.asset.ID, OwnerID: p.asset.OwnerID,
			PrimaryNodeID: p.node.ID, NodeRevision: p.node.Revision,
			MediaUpdatedAt: p.media.UpdatedAt, ConsentRevision: revision,
			SourceLatitude: sourceLat, SourceLongitude: lon,
			CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
			Latitude:          lat + 0.006, Longitude: lon + 0.006,
		}
	}
	// A current point stays visible even with a nonzero legacy consent revision.
	for _, p := range []meta.BaiduPhotoMapPosition{
		position(current, lat, 99), position(stale, lat+1, 8),
	} {
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}

	ctx := context.Background()
	ids, more, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 1)
	if err != nil || !more || len(ids) != 1 || ids[0] != absent.asset.ID {
		t.Fatalf("first Owner cursor was wrong: ids=%v more=%t err=%v", ids, more, err)
	}
	first, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 1)
	if err != nil || first.Queued != 1 || first.NextAfter != absent.asset.ID || !first.HasMore {
		t.Fatalf("first bounded batch invalid: %+v, %v", first, err)
	}
	second, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, first.NextAfter, 1)
	if err != nil || second.Queued != 1 || second.NextAfter != stale.asset.ID || second.HasMore {
		t.Fatalf("second batch did not resume at stale derivative: %+v %v", second, err)
	}
	again, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || again.Queued != 0 || again.HasMore {
		t.Fatalf("already queued Owner work was duplicated: %+v %v", again, err)
	}
	var jobs []meta.BaiduPhotoMapIndexIntent
	if err := db.Order("asset_id ASC").Find(&jobs).Error; err != nil ||
		len(jobs) != 2 || jobs[0].AssetID != absent.asset.ID || jobs[1].AssetID != stale.asset.ID ||
		jobs[0].ConsentRevision != 0 || jobs[1].ConsentRevision != 0 {
		t.Fatalf("AutoPlan wrote an unexpected consent/job state: %+v %v", jobs, err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(ctx, db, alice.ID, foreign.asset.ID, 0); err == nil {
		t.Fatal("foreign Owner could enqueue an unrelated photo")
	}
	peer, _, err := queryBaiduPhotoMapAutoCandidates(ctx, db, bob.ID, 0, 32)
	if err != nil || len(peer) != 1 || peer[0] != foreign.asset.ID {
		t.Fatalf("Owner-scoped scan leaked a photo: %+v %v", peer, err)
	}

	// A completed receipt with no matching BD09 derivative is eligible
	// for one more bounded plan, not permanently hidden from the map.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).
		Update("status", baiduMapIndexCompleted).Error; err != nil {
		t.Fatal(err)
	}
	repaired, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || repaired.Queued != 1 {
		t.Fatalf("missing derivative after completed receipt was not repaired: %+v %v", repaired, err)
	}
	// An in-flight old consent-era lease must NOT starve or be stolen by the
	// new automatic planner. Once it expires on the PostgreSQL clock, the
	// existing Owner/source transaction can safely replace that generation.
	oldLeaseUntil := time.Now().UTC().Add(time.Hour)
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).
		Updates(map[string]any{
			"status": baiduMapIndexLeased, "consent_revision": uint64(7),
			"lease_token": "legacy-worker", "lease_until": oldLeaseUntil,
			"attempts": uint32(1),
		}).Error; err != nil {
		t.Fatal(err)
	}
	activeIDs, activeMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || activeMore || len(activeIDs) != 0 {
		t.Fatalf("live old lease must be excluded from automatic planning: ids=%v more=%t err=%v", activeIDs, activeMore, err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).
		Update("lease_until", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	legacy, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || legacy.Queued != 1 {
		t.Fatalf("expired consent-era lease stranded current Owner GPS: %+v %v", legacy, err)
	}
	var migrated meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", stale.asset.ID).Take(&migrated).Error; err != nil ||
		migrated.Status != baiduMapIndexQueued || migrated.ConsentRevision != 0 ||
		migrated.LeaseToken != "" || migrated.LeaseUntil != nil || migrated.Attempts != 0 {
		t.Fatalf("old lease was not safely reset: %+v %v", migrated, err)
	}

	// A real GPS edit makes the previous queued generation stale. Planning
	// revalidates and updates its source snapshot without a grant, not a second
	// row or an external provider call.
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", absent.node.ID).
		Update("latitude", 35.5).Error; err != nil {
		t.Fatal(err)
	}
	edit, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || edit.Queued != 1 {
		t.Fatalf("new source was not queued: %+v %v", edit, err)
	}
	var newJob meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", absent.asset.ID).Take(&newJob).Error; err != nil ||
		newJob.ConsentRevision != 0 || newJob.Status != baiduMapIndexQueued ||
		!newJob.MediaUpdatedAt.After(jobs[0].MediaUpdatedAt) {
		t.Fatalf("source revision did not replace the old queue generation: %+v %v", newJob, err)
	}
	var count int64
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("unexpected duplicate intent: %d, %v", count, err)
	}
	// The startup Owner reconciliation also uses bounded, private batches.
	// It must queue the other Owner's missing GPS under that other Owner only.
	server := &Server{DB: db}
	ownerCursor := uint64(0)
	drained := make(map[uint64]struct{})
	if err := server.planBaiduPhotoMapAutoOwnersOnce(ctx, &ownerCursor, drained); err != nil {
		t.Fatal(err)
	}
	var bobJob meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ? AND owner_id = ?", foreign.asset.ID, bob.ID).
		Take(&bobJob).Error; err != nil || bobJob.ConsentRevision != 0 ||
		bobJob.Status != baiduMapIndexQueued {
		t.Fatalf("startup did not plan the other Owner's GPS independently: %+v %v", bobJob, err)
	}
	if _, ok := drained[alice.ID]; !ok {
		t.Fatal("completed Owner scan was not marked drained")
	}
	if _, ok := drained[bob.ID]; !ok {
		t.Fatal("second Owner scan was not marked drained")
	}
	// The consumption stage must rotate Owners and select only existing
	// durable queued IDs. This callback is entirely offline: no Server AK,
	// external conversion or original WGS84 escapes this fixture.
	consumeCursor := uint64(0)
	observed := make(map[uint64]uint64)
	for i := 0; i < 2; i++ {
		if err := server.consumeBaiduPhotoMapAutoOwnersOnceWithExecutor(
			ctx, &consumeCursor,
			func(runCtx context.Context, ownerID, assetID uint64) error {
				if runCtx.Err() != nil || ownerID == 0 || assetID == 0 {
					return errBaiduGeoconvDispatchUnavailable
				}
				observed[ownerID] = assetID
				return nil
			},
		); err != nil {
			t.Fatalf("bounded Owner queue consumption failed: %v", err)
		}
	}
	if len(observed) != 2 || observed[alice.ID] != absent.asset.ID ||
		observed[bob.ID] != foreign.asset.ID {
		t.Fatalf("bounded consumer widened Owner membership: %+v", observed)
	}
	// A missing/disabled Server AK must never trigger the real provider or
	// lease a queued task. Disabling the service is not a photo opt-out.
	consumeCursor = 0
	if err := server.consumeBaiduPhotoMapAutoOwnersOnce(ctx, &consumeCursor); err != nil {
		t.Fatalf("disabled Server service should quietly retain the queue: %v", err)
	}
	var stillQueued meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", absent.asset.ID).Take(&stillQueued).Error; err != nil ||
		stillQueued.Status != baiduMapIndexQueued || stillQueued.LeaseToken != "" {
		t.Fatalf("disabled service unexpectedly claimed durable photo task: %+v %v", stillQueued, err)
	}
	// No conversion ran in this test, nor were coordinates serialized.

	// A failing provider has only 3 immediate attempts; it does not strand
	// a valid Owner photo forever now that manual index POST was removed.
	failedNow := time.Now().UTC()
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", absent.asset.ID).UpdateColumns(map[string]any{
		"status": baiduMapIndexFailed, "attempts": uint32(baiduMapIndexMaxClaims),
		"lease_token": "", "lease_until": nil, "retry_after": nil,
		"updated_at": failedNow,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(ctx, db, alice.ID, absent.asset.ID, 0); err == nil {
		t.Fatal("exhausted work was requeued before the failure cooldown")
	}
	blocked, blockedMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || blockedMore || len(blocked) != 0 {
		t.Fatalf("failed cooldown bypassed: %v %t %v", blocked, blockedMore, err)
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", absent.asset.ID).
		UpdateColumn("updated_at", failedNow.Add(-25*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	eligible, eligibleMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || eligibleMore || len(eligible) != 1 || eligible[0] != absent.asset.ID {
		t.Fatalf("exhausted work remained permanently hidden: %v %t %v", eligible, eligibleMore, err)
	}
	recovered, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || recovered.Queued != 1 || recovered.HasMore {
		t.Fatalf("exhausted job not retried safely: %+v %v", recovered, err)
	}
	var newReceipt meta.BaiduPhotoMapIndexIntent
	if err := db.Where("asset_id = ?", absent.asset.ID).Take(&newReceipt).Error; err != nil ||
		newReceipt.Status != baiduMapIndexQueued || newReceipt.Attempts != 0 ||
		newReceipt.ConsentRevision != 0 || newReceipt.LeaseToken != "" ||
		newReceipt.LeaseUntil != nil {
		t.Fatalf("exhausted retry lost source/attempt fence: %+v %v", newReceipt, err)
	}
	// A previously cancelled Owner job must never be resurrected by age.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).UpdateColumns(map[string]any{
		"status": baiduMapIndexCancelled, "updated_at": failedNow.Add(-48 * time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	cancelledIDs, cancelledMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || cancelledMore || len(cancelledIDs) != 0 {
		t.Fatalf("cancelled photo was re-admitted: %v %t %v", cancelledIDs, cancelledMore, err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(ctx, db, alice.ID, stale.asset.ID, 0); err == nil {
		t.Fatal("cancelled Owner job was replayed")
	}

	// Historical consent-era cancelled intents must not be reactivated
	// on upgrade solely because their consent_revision differs from zero.
	// A genuine new GPS source generation may re-enter the map planner.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).UpdateColumns(map[string]any{
		"status":           baiduMapIndexCancelled,
		"consent_revision": uint64(7),
		"updated_at":       failedNow.Add(-48 * time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	legacyCancelled, legacyMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || legacyMore || len(legacyCancelled) != 0 {
		t.Fatalf("migration-era cancellation was silently restored: %v %t %v", legacyCancelled, legacyMore, err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(ctx, db, alice.ID, stale.asset.ID, 0); err == nil {
		t.Fatal("legacy cancellation could be replayed with zero consent revision")
	}
	// A legacy failed intent respects the same 24h global cooldown.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).UpdateColumns(map[string]any{
		"status":           baiduMapIndexFailed,
		"consent_revision": uint64(7),
		"attempts":         uint32(baiduMapIndexMaxClaims),
		"updated_at":       failedNow,
	}).Error; err != nil {
		t.Fatal(err)
	}
	legacyFailed, legacyFailedMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || legacyFailedMore || len(legacyFailed) != 0 {
		t.Fatalf("legacy failure bypassed cooldown: %v %t %v", legacyFailed, legacyFailedMore, err)
	}
	if err := enqueueBaiduPhotoMapIndexIntent(ctx, db, alice.ID, stale.asset.ID, 0); err == nil {
		t.Fatal("legacy failed job ignored cooldown")
	}
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).
		UpdateColumn("updated_at", failedNow.Add(-25*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	legacyDue, legacyDueMore, err := queryBaiduPhotoMapAutoCandidates(ctx, db, alice.ID, 0, 32)
	if err != nil || legacyDueMore || len(legacyDue) != 1 || legacyDue[0] != stale.asset.ID {
		t.Fatalf("legacy failure permanently prevented Owner GPS: %v %t %v", legacyDue, legacyDueMore, err)
	}
	migratedFailed, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || migratedFailed.Queued != 1 {
		t.Fatalf("legacy failed job did not recover: %+v %v", migratedFailed, err)
	}
	// The now-queued same-source intent can be cancelled again, and a GPS
	// source revision change can independently begin a new generation.
	if err := db.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", stale.asset.ID).
		Update("status", baiduMapIndexCancelled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", stale.node.ID).
		Update("latitude", 35.75).Error; err != nil {
		t.Fatal(err)
	}
	changedSource, err := planBaiduPhotoMapOwnerBackfillBatch(ctx, db, alice.ID, 0, 32)
	if err != nil || changedSource.Queued != 1 {
		t.Fatalf("new GPS generation remained permanently cancelled: %+v %v", changedSource, err)
	}

	// A broken durable queue is not an empty Owner. Fail with a private,
	// bounded error so the production consumer backs off instead of silently
	// polling the unavailable table every second. Never invoke the executor.
	if err := db.Migrator().DropTable(&meta.BaiduPhotoMapIndexIntent{}); err != nil {
		t.Fatal(err)
	}
	consumeCursor = 0
	dispatched := false
	err = server.consumeBaiduPhotoMapAutoOwnersOnceWithExecutor(
		ctx, &consumeCursor, func(context.Context, uint64, uint64) error {
			dispatched = true
			return nil
		})
	if err != errBaiduGeoconvDispatchUnavailable || dispatched {
		t.Fatalf("missing durable queue was treated as idle: err=%v dispatched=%t", err, dispatched)
	}
}
