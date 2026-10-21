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

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduGeoconvQuotaPreflightRejectsUnsafeAdmission(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	limits := baiduGeoconvQuotaLimits{
		OwnerRequests: 2, FleetRequests: 4,
		OwnerPoints: 4, FleetPoints: 6,
	}
	for _, item := range []struct {
		ctx   context.Context
		owner uint64
		count int
		caps  baiduGeoconvQuotaLimits
	}{
		{nil, 1, 1, limits},
		{ctx, 1, 1, limits},
		{context.Background(), 0, 1, limits},
		{context.Background(), uint64(1) << 63, 1, limits},
		{context.Background(), 1, 0, limits},
		{context.Background(), 1, 21, limits},
		{context.Background(), 1, 5, limits},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 0, FleetRequests: 4, OwnerPoints: 4, FleetPoints: 6}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 3, FleetRequests: 4, OwnerPoints: 4, FleetPoints: 6}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 21, OwnerPoints: 4, FleetPoints: 6}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 1, OwnerPoints: 4, FleetPoints: 6}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 4, OwnerPoints: 21, FleetPoints: 22}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 4, OwnerPoints: 4, FleetPoints: 201}},
		{context.Background(), 1, 1, baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 4, OwnerPoints: 4, FleetPoints: 3}},
	} {
		if err := reserveBaiduGeoconvQuotaWithLimits(item.ctx, nil, item.owner, item.count, item.caps); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
			t.Fatalf("accepted bad quota reservation: %v", err)
		}
	}
	if err := reserveBaiduGeoconvQuota(context.Background(), nil, 1, 1); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("missing database accepted quota")
	}
}

func TestBaiduGeoconvQuotaAcrossIndependentPostgresPools(t *testing.T) {
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
	schema := "baidu_conv_quota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	newDB := func() *gorm.DB {
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
	db, peer := newDB(), newDB()
	if err := db.AutoMigrate(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	read := func(scope int64) meta.BaiduGeoconvQuotaBucket {
		t.Helper()
		var bucket meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", scope).Take(&bucket).Error; err != nil {
			t.Fatal(err)
		}
		return bucket
	}
	reset := func() {
		t.Helper()
		if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
			t.Fatal(err)
		}
	}
	caps := baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 3, OwnerPoints: 4, FleetPoints: 6}
	for i := 0; i < 2; i++ {
		if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), db, 10, 2, caps); err != nil {
			t.Fatal(err)
		}
	}
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), peer, 10, 1, caps); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("owner budget bypassed")
	}
	if fleet := read(0); fleet.Requests != 2 || fleet.Points != 4 {
		t.Fatalf("denied owner consumed fleet: %+v", fleet)
	}
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), peer, 11, 2, caps); err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), db, 11, 1, caps); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("fleet quota bypassed")
	}
	if fleet, a, b := read(0), read(10), read(11); fleet.Requests != 3 ||
		fleet.Points != 6 || a.Requests != 2 || a.Points != 4 ||
		b.Requests != 1 || b.Points != 2 {
		t.Fatalf("counter drift: fleet=%+v a=%+v b=%+v", fleet, a, b)
	}
	// Simultaneous callers through independent DB pools cannot oversubscribe
	// fleet or Owner limits. A fleet denial must leave the private row intact.
	// These counters intentionally reset at PostgreSQL's UTC minute boundary.
	// If concurrent admissions straddle that boundary, a total above six is
	// expected across two separate minute windows, not quota oversubscription.
	// Retry the WHOLE workload with fresh rows so each assertion checks one
	// PostgreSQL clock minute; never discard a failed same-minute assertion.
	parallel := baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 6, OwnerPoints: 3, FleetPoints: 6}
	databaseMinute := func() int64 {
		t.Helper()
		var minute int64
		if err := peer.Raw("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / 60)::bigint").
			Row().Scan(&minute); err != nil || minute <= 0 {
			t.Fatalf("PostgreSQL quota minute unavailable: %v", err)
		}
		return minute
	}
	validated := false
	for attempt := 0; attempt < 3; attempt++ {
		reset()
		startMinute := databaseMinute()
		var admitted atomic.Int64
		var unexpected atomic.Int64
		var wg sync.WaitGroup
		for i := 0; i < 24; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				connection := db
				if i%2 != 0 {
					connection = peer
				}
				owner := uint64(21 + i%3)
				err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), connection, owner, 1, parallel)
				switch {
				case err == nil:
					admitted.Add(1)
				case errors.Is(err, errBaiduGeoconvQuotaDenied):
				default:
					unexpected.Add(1)
				}
			}(i)
		}
		wg.Wait()
		endMinute := databaseMinute()
		if endMinute != startMinute {
			t.Logf("PostgreSQL minute changed (%d -> %d) during quota admission; rerun with fresh counters", startMinute, endMinute)
			continue
		}
		if unexpected.Load() != 0 || admitted.Load() != 6 {
			t.Fatalf("parallel admission drift: admitted=%d unexpected=%d", admitted.Load(), unexpected.Load())
		}
		if fleet := read(0); fleet.Requests != 6 || fleet.Points != 6 {
			t.Fatalf("fleet exceeded: %+v", fleet)
		}
		for _, id := range []int64{21, 22, 23} {
			if bucket := read(id); bucket.Requests != 2 || bucket.Points != 2 {
				t.Fatalf("owner %d exceeded: %+v", id, bucket)
			}
		}
		validated = true
		break
	}
	if !validated {
		t.Fatal("quota concurrency did not fit within a single PostgreSQL minute after three attempts")
	}
	reset()
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), db, 41, 2, caps); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE xd_baidu_geoconv_quota_buckets SET window_minute = window_minute - 1, requests = 99, points = 99").Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), peer, 41, 1, caps); err != nil {
		t.Fatalf("database minute rollover rejected: %v", err)
	}
	if read(0).Requests != 1 || read(41).Points != 1 {
		t.Fatal("database minute did not reset")
	}
	if err := db.Exec("UPDATE xd_baidu_geoconv_quota_buckets SET window_minute = window_minute + 2").Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuotaWithLimits(context.Background(), peer, 41, 1, caps); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("future quota window illegally rewound")
	}
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuota(context.Background(), peer, 41, 1); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("missing table permitted unmetered export")
	}
}
