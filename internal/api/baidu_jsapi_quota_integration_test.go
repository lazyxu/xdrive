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
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPILoaderQuotaRejectsInvalidInputs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, item := range []struct {
		ctx   context.Context
		owner uint64
		caps  baiduJSAPILoaderQuotaLimits
	}{
		{nil, 1, baiduJSAPILoaderQuotaLimits{2, 3}},
		{ctx, 1, baiduJSAPILoaderQuotaLimits{2, 3}},
		{context.Background(), 0, baiduJSAPILoaderQuotaLimits{2, 3}},
		{context.Background(), uint64(1) << 63, baiduJSAPILoaderQuotaLimits{2, 3}},
		{context.Background(), 1, baiduJSAPILoaderQuotaLimits{0, 3}},
		{context.Background(), 1, baiduJSAPILoaderQuotaLimits{13, 13}},
		{context.Background(), 1, baiduJSAPILoaderQuotaLimits{2, 241}},
		{context.Background(), 1, baiduJSAPILoaderQuotaLimits{3, 2}},
	} {
		if err := reserveBaiduJSAPILoaderQuotaWithLimits(item.ctx, nil, item.owner, item.caps); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
			t.Fatalf("unsafe quota request accepted: %v", err)
		}
	}
	if err := reserveBaiduJSAPILoaderQuota(context.Background(), nil, 1); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
		t.Fatal("missing PostgreSQL accepted")
	}
}

func TestBaiduJSAPILoaderQuotaAcrossIndependentPostgresConnections(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture requires XD_TEST_DATABASE_URL")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_quota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	connect := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		return db
	}
	db, peer := connect(), connect()
	if err := db.AutoMigrate(&meta.BaiduJSAPIQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	read := func(scopeID int64) meta.BaiduJSAPIQuotaBucket {
		t.Helper()
		var row meta.BaiduJSAPIQuotaBucket
		if err := peer.Where("scope_id = ?", scopeID).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	reset := func() {
		t.Helper()
		if err := db.Exec("DELETE FROM xd_baidu_jsapi_quota_buckets").Error; err != nil {
			t.Fatal(err)
		}
	}
	const charge = int64(baidumapjsapi.MaxLoaderBytes)

	// A rejected owner must not consume fleet budget. Two open DB
	// connections see the same committed counters, never local approximations.
	caps := baiduJSAPILoaderQuotaLimits{OwnerRequests: 3, FleetRequests: 4}
	for i := 0; i < 3; i++ {
		if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, db, 10, caps); err != nil {
			t.Fatal(err)
		}
	}
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, peer, 10, caps); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
		t.Fatal("per-owner quota bypassed")
	}
	if global := read(0); global.Requests != 3 || global.ReservedBytes != 3*charge {
		t.Fatalf("denied owner charged fleet: %#v", global)
	}
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, peer, 11, caps); err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, db, 11, caps); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
		t.Fatal("fleet quota bypassed")
	}
	if global := read(0); global.Requests != 4 || global.ReservedBytes != 4*charge {
		t.Fatalf("fleet charge changed: %#v", global)
	}
	if owner := read(11); owner.Requests != 1 || owner.ReservedBytes != charge {
		t.Fatalf("fleet rejection reached owner: %#v", owner)
	}

	// Two replica handles reserve concurrently. Row locks and one
	// transaction must never oversubscribe either scope.
	reset()
	parallelCaps := baiduJSAPILoaderQuotaLimits{OwnerRequests: 6, FleetRequests: 8}
	var admitted atomic.Int64
	var unexpected atomic.Int64
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			connection := db
			if i%2 == 1 {
				connection = peer
			}
			owner := uint64(21 + i%2)
			err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, connection, owner, parallelCaps)
			switch {
			case err == nil:
				admitted.Add(1)
			case errors.Is(err, errBaiduJSAPIQuotaDenied):
			default:
				unexpected.Add(1)
			}
		}(i)
	}
	group.Wait()
	if unexpected.Load() != 0 || admitted.Load() != 8 {
		t.Fatalf("quota not atomic: admitted=%d unexpected=%d", admitted.Load(), unexpected.Load())
	}
	ownerA, ownerB, global := read(21), read(22), read(0)
	if ownerA.Requests > 6 || ownerB.Requests > 6 ||
		ownerA.Requests+ownerB.Requests != 8 || global.Requests != 8 ||
		global.ReservedBytes != 8*charge {
		t.Fatalf("parallel counter drift: a=%#v b=%#v global=%#v", ownerA, ownerB, global)
	}

	// DB minute change permits a reset; a future-window corruption never
	// rewinds quotas based on the Server clock.
	reset()
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, db, 41, caps); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE xd_baidu_jsapi_quota_buckets SET window_minute = window_minute - 1, requests = 50, reserved_bytes = 100000000").Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, peer, 41, caps); err != nil {
		t.Fatalf("minute reset denied: %v", err)
	}
	if read(0).Requests != 1 || read(41).Requests != 1 {
		t.Fatal("window rollover did not reset counters")
	}
	if err := db.Exec("UPDATE xd_baidu_jsapi_quota_buckets SET window_minute = window_minute + 2").Error; err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduJSAPILoaderQuotaWithLimits(ctx, peer, 41, caps); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
		t.Fatal("future window rewound")
	}
	if err := db.Migrator().DropTable(&meta.BaiduJSAPIQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	if err := reserveBaiduJSAPILoaderQuota(ctx, peer, 41); !errors.Is(err, errBaiduJSAPIQuotaDenied) {
		t.Fatal("missing quota table admitted request")
	}
}
