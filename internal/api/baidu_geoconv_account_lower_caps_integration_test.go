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

func TestBaiduGeoconvLowerAccountCapsRequireValidPrivateReservation(t *testing.T) {
	minute := baiduGeoconvQuotaLimits{OwnerRequests: 1, FleetRequests: 2, OwnerPoints: 1, FleetPoints: 2}
	cadence := baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 1, FleetDay: 2}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, item := range []struct {
		ctx     context.Context
		owner   uint64
		points  int
		minute  baiduGeoconvQuotaLimits
		cadence baiduGeoconvCadenceCaps
	}{
		{nil, 10, 1, minute, cadence},
		{ctx, 10, 1, minute, cadence},
		{context.Background(), 0, 1, minute, cadence},
		{context.Background(), 1 << 63, 1, minute, cadence},
		{context.Background(), 10, 0, minute, cadence},
		{context.Background(), 10, 2, minute, cadence},
		{context.Background(), 10, 1, baiduGeoconvQuotaLimits{}, cadence},
		{context.Background(), 10, 1, minute, baiduGeoconvCadenceCaps{}},
		{context.Background(), 10, 1, minute, baiduGeoconvCadenceCaps{
			OwnerSecond: 1, FleetSecond: baiduGeoconvFleetSecondRequests + 1, OwnerDay: 1, FleetDay: 2,
		}},
		{context.Background(), 10, 1, minute, baiduGeoconvCadenceCaps{
			OwnerSecond: 1, FleetSecond: 2, OwnerDay: 1, FleetDay: baiduGeoconvFleetDayRequests + 1,
		}},
	} {
		if err := reserveBaiduGeoconvQuotaWithLowerAccountCaps(
			item.ctx, nil, item.owner, item.points, item.minute, item.cadence,
		); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
			t.Fatalf("unsafe account limits accepted: %v", err)
		}
	}
}

// An isolated real PostgreSQL schema and TWO independent connection pools
// exercise the exact combined minute+second+UTC-day transaction. No Baidu
// credential, user position, upstream request or production release path exists.
func TestBaiduGeoconvLowerAccountCapsAtomicTwoPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
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
	schema := "baidu_conv_lower_account_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	reset := func() {
		t.Helper()
		if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
			t.Fatal(err)
		}
	}
	read := func(id int64) meta.BaiduGeoconvQuotaBucket {
		t.Helper()
		var row meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", id).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	minute := baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 3, OwnerPoints: 2, FleetPoints: 3}
	cadence := baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 1, FleetDay: 1}
	charge := func(db *gorm.DB, owner uint64, min baiduGeoconvQuotaLimits, cad baiduGeoconvCadenceCaps) error {
		return reserveBaiduGeoconvQuotaWithLowerAccountCaps(context.Background(), db, owner, 1, min, cad)
	}
	if err := charge(db, 10, minute, cadence); err != nil {
		t.Fatalf("first reduced-cap charge rejected: %v", err)
	}
	if err := charge(peer, 11, minute, cadence); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("second account request exceeded reduced Fleet UTC-day cap")
	}
	if fleet := read(0); fleet.Requests != 1 || fleet.Points != 1 || fleet.DayRequests != 1 {
		t.Fatalf("denied UTC-day charge leaked into minute/point/second: %+v", fleet)
	}
	var blockedOwner int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Where("scope_id = ?", 11).Count(&blockedOwner).Error; err != nil || blockedOwner != 0 {
		t.Fatal("denied account request left partial Owner row")
	}

	reset()
	// Before lowering the limit, a default admitted charge remains visible to
	// all replicas. The lowered 1/day Fleet ceiling cannot reset the history.
	if err := reserveBaiduGeoconvQuota(context.Background(), db, 20, 1); err != nil {
		t.Fatalf("existing production-default reservation failed: %v", err)
	}
	if err := charge(peer, 21, minute, cadence); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("lower quota bypassed previous already-consumed global budget")
	}
	if fleet := read(0); fleet.Requests != 1 || fleet.DayRequests != 1 {
		t.Fatalf("previous cap lowering modified accounted usage: %+v", fleet)
	}

	reset()
	// Invalid lower cap must roll back even if its minute counters were
	// tentatively inserted before the second/day limit validation.
	badCadence := cadence
	badCadence.FleetSecond = baiduGeoconvFleetSecondRequests + 1
	if err := charge(db, 30, minute, badCadence); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("higher-than-local QPS cap accepted")
	}
	badMinute := minute
	badMinute.FleetRequests = baiduGeoconvFleetRequestsPerMinute + 1
	if err := charge(peer, 31, badMinute, cadence); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("higher-than-local minute request cap accepted")
	}
	badMinute = minute
	badMinute.OwnerPoints = 0
	if err := charge(peer, 32, badMinute, cadence); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("zero lower Owner point budget accepted")
	}
	var rows int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&rows).Error; err != nil || rows != 0 {
		t.Fatal("invalid account caps committed partial minute rows")
	}

	// 24 simultaneous independent-pool requests respect lower fleet minute
	// and day limits, without leaked Owner records or unredacted failures.
	minute = baiduGeoconvQuotaLimits{OwnerRequests: 2, FleetRequests: 3, OwnerPoints: 2, FleetPoints: 3}
	cadence = baiduGeoconvCadenceCaps{OwnerSecond: 2, FleetSecond: 2, OwnerDay: 2, FleetDay: 3}
	var successes atomic.Int64
	var unexpected atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			connection := db
			if i%2 == 1 {
				connection = peer
			}
			err := charge(connection, uint64(40+i%3), minute, cadence)
			switch {
			case err == nil:
				successes.Add(1)
			case errors.Is(err, errBaiduGeoconvQuotaDenied):
			default:
				unexpected.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if unexpected.Load() != 0 || successes.Load() < 1 || successes.Load() > 3 {
		t.Fatalf("lower-cap two-pool concurrent admission unsafe: successful=%d errors=%d", successes.Load(), unexpected.Load())
	}
	if fleet := read(0); fleet.Requests != successes.Load() || fleet.DayRequests != successes.Load() {
		t.Fatalf("concurrent fleet minute/day counters diverged: %+v", fleet)
	}
}
