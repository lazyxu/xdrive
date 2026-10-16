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

func TestBaiduGeoconvCadenceInputsFailClosed(t *testing.T) {
	caps := baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 2, FleetDay: 3}
	sec := int64(2000000100)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, input := range []struct {
		ctx    context.Context
		owner  uint64
		second int64
		day    int64
		caps   baiduGeoconvCadenceCaps
	}{
		{nil, 10, sec, sec / 86400, caps},
		{ctx, 10, sec, sec / 86400, caps},
		{context.Background(), 0, sec, sec / 86400, caps},
		{context.Background(), uint64(1) << 63, sec, sec / 86400, caps},
		{context.Background(), 10, 0, 0, caps},
		{context.Background(), 10, sec, sec/86400 + 1, caps},
		{context.Background(), 10, sec, sec / 86400, baiduGeoconvCadenceCaps{OwnerSecond: 3, FleetSecond: 3, OwnerDay: 2, FleetDay: 3}},
		{context.Background(), 10, sec, sec / 86400, baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 201, FleetDay: 4000}},
	} {
		if err := reserveBaiduGeoconvCadenceAt(input.ctx, nil, input.owner, input.second, input.day, input.caps); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
			t.Fatalf("unsafe cadence accepted: %v", err)
		}
	}
	if err := reserveBaiduGeoconvCadenceTx(context.Background(), nil, 10); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("missing DB accepted cadence")
	}
}

func TestBaiduGeoconvCadenceRealPostgresTwoPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL service required")
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
	schema := "baidu_conv_cadence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	open := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
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
	for _, owner := range []int64{0, 10, 11, 12} {
		if err := db.Create(&meta.BaiduGeoconvQuotaBucket{ScopeID: owner, WindowMinute: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
	read := func(scope int64) meta.BaiduGeoconvQuotaBucket {
		t.Helper()
		var value meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", scope).Take(&value).Error; err != nil {
			t.Fatal(err)
		}
		return value
	}
	sec := int64(2000000100)
	day := sec / 86400
	limits := baiduGeoconvCadenceCaps{OwnerSecond: 1, FleetSecond: 2, OwnerDay: 2, FleetDay: 3}
	charge := func(db *gorm.DB, owner uint64, second, day int64) error {
		return reserveBaiduGeoconvCadenceAt(context.Background(), db, owner, second, day, limits)
	}
	if err := charge(db, 10, sec, day); err != nil {
		t.Fatal(err)
	}
	if err := charge(peer, 11, sec, day); err != nil {
		t.Fatal(err)
	}
	if err := charge(db, 12, sec, day); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("fleet per-second cap bypassed")
	}
	if row := read(0); row.SecondRequests != 2 || row.DayRequests != 2 {
		t.Fatalf("second denial changed fleet counts: %+v", row)
	}
	if row := read(12); row.SecondRequests != 0 || row.DayRequests != 0 {
		t.Fatal("denied Owner was charged")
	}
	if err := charge(peer, 10, sec+1, day); err != nil {
		t.Fatal(err)
	}
	if err := charge(peer, 11, sec+1, day); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("fleet daily limit bypassed")
	}
	if row := read(0); row.SecondRequests != 1 || row.DayRequests != 3 {
		t.Fatalf("daily denial charged fleet: %+v", row)
	}
	nextDay := (day + 1) * 86400
	if err := charge(peer, 12, nextDay, day+1); err != nil {
		t.Fatalf("UTC-day reset rejected: %v", err)
	}
	if row := read(0); row.DayRequests != 1 || row.WindowDay != day+1 {
		t.Fatal("UTC-day counter failed to roll")
	}
	if err := charge(peer, 11, sec, day); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("future epoch was incorrectly rewound")
	}
	// A direct cadence charge never writes or modifies old minute/point fields.
	if row := read(0); row.Requests != 0 || row.Points != 0 {
		t.Fatal("standalone cadence mutated minute accounting")
	}

	if err := db.Exec("UPDATE xd_baidu_geoconv_quota_buckets SET window_second = 0, second_requests = 0, window_day = 0, day_requests = 0").Error; err != nil {
		t.Fatal(err)
	}
	var success atomic.Int64
	var denied atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			connection := db
			if i%2 == 1 {
				connection = peer
			}
			err := charge(connection, uint64(10+i%3), sec, day)
			switch {
			case err == nil:
				success.Add(1)
			case errors.Is(err, errBaiduGeoconvQuotaDenied):
				denied.Add(1)
			default:
				t.Errorf("unredacted/unknown cadence error: %v", err)
			}
		}(i)
	}
	wg.Wait()
	if success.Load() != 2 || denied.Load() != 22 || read(0).SecondRequests != 2 || read(0).DayRequests != 2 {
		t.Fatalf("two-pool fleet gate drift: accepted=%d denied=%d", success.Load(), denied.Load())
	}
	for _, id := range []int64{10, 11, 12} {
		if bucket := read(id); bucket.SecondRequests > 1 || bucket.DayRequests > 1 {
			t.Fatalf("Owner oversubscribed: %d", id)
		}
	}

	// Daily denial MUST roll back a same-transaction minute fleet+Owner
	// charge. No false availability even when the future provider is offline.
	if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
		t.Fatal(err)
	}
	var today int64
	if err := db.Raw("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / 86400)::bigint").Row().Scan(&today); err != nil {
		t.Fatal(err)
	}
	fleet := meta.BaiduGeoconvQuotaBucket{
		ScopeID: 0, WindowMinute: 0, WindowDay: today,
		DayRequests: baiduGeoconvFleetDayRequests,
	}
	if err := db.Create(&fleet).Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuota(context.Background(), db, 10, 1); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("exhausted daily budget permitted minute charge")
	}
	if row := read(0); row.Requests != 0 || row.Points != 0 || row.DayRequests != baiduGeoconvFleetDayRequests {
		t.Fatalf("daily denial failed to roll back minute charge: %+v", row)
	}
	var ownerRows int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Where("scope_id = ?", 10).Count(&ownerRows).Error; err != nil || ownerRows != 0 {
		t.Fatal("rolled-back quota left an owner row")
	}
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduGeoconvQuota(context.Background(), peer, 10, 1); !errors.Is(err, errBaiduGeoconvQuotaDenied) {
		t.Fatal("missing migration permitted usage")
	}
}
