package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPILoaderFlightRejectsInvalidInputs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, item := range []struct {
		ctx    context.Context
		owner  uint64
		limits baiduJSAPILoaderFlightLimits
	}{
		{nil, 1, baiduJSAPILoaderFlightLimits{1, 2}},
		{ctx, 1, baiduJSAPILoaderFlightLimits{1, 2}},
		{context.Background(), 0, baiduJSAPILoaderFlightLimits{1, 2}},
		{context.Background(), uint64(1) << 63, baiduJSAPILoaderFlightLimits{1, 2}},
		{context.Background(), 1, baiduJSAPILoaderFlightLimits{0, 2}},
		{context.Background(), 1, baiduJSAPILoaderFlightLimits{3, 3}},
		{context.Background(), 1, baiduJSAPILoaderFlightLimits{2, 17}},
		{context.Background(), 1, baiduJSAPILoaderFlightLimits{2, 1}},
	} {
		if lease, err := acquireBaiduJSAPILoaderFlightWithLimits(item.ctx, nil, item.owner, item.limits); !errors.Is(err, errBaiduJSAPIFlightDenied) || lease.digest != "" {
			t.Fatalf("unsafe flight admitted: %#v, %v", lease, err)
		}
	}
	if _, err := acquireBaiduJSAPILoaderFlight(context.Background(), nil, 1); !errors.Is(err, errBaiduJSAPIFlightDenied) {
		t.Fatal("missing DB admitted")
	}
	if err := releaseBaiduJSAPILoaderFlight(ctx, nil, baiduJSAPILoaderLease{}); !errors.Is(err, errBaiduJSAPIFlightDenied) {
		t.Fatal("canceled release accepted")
	}
}

func TestBaiduJSAPILoaderFlightAcrossPostgresReplicas(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture requires XD_TEST_DATABASE_URL")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_flight_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA \"%s\"", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA \"%s\" CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	connect := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		return db
	}
	db, peer := connect(), connect()
	if err := db.AutoMigrate(&meta.BaiduJSAPILoaderFlight{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	caps := baiduJSAPILoaderFlightLimits{Owner: 2, Fleet: 3}
	first, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, db, 41, caps)
	if err != nil {
		t.Fatal(err)
	}
	_, err = acquireBaiduJSAPILoaderFlightWithLimits(ctx, peer, 41, caps)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, db, 41, caps); !errors.Is(err, errBaiduJSAPIFlightDenied) {
		t.Fatal("owner concurrency bypass")
	}
	_, err = acquireBaiduJSAPILoaderFlightWithLimits(ctx, peer, 42, caps)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, db, 43, caps); !errors.Is(err, errBaiduJSAPIFlightDenied) {
		t.Fatal("fleet concurrency bypass")
	}
	count := func(want int64) {
		t.Helper()
		var got int64
		if err := peer.Model(&meta.BaiduJSAPILoaderFlight{}).Count(&got).Error; err != nil || got != want {
			t.Fatalf("flight count = %d, want %d: %v", got, want, err)
		}
	}
	count(3)
	forged := first
	forged.ownerID = 42
	if err := releaseBaiduJSAPILoaderFlight(ctx, peer, forged); err != nil {
		t.Fatal(err)
	}
	count(3)
	if err := releaseBaiduJSAPILoaderFlight(ctx, peer, first); err != nil {
		t.Fatal(err)
	}
	if err := releaseBaiduJSAPILoaderFlight(ctx, peer, first); err != nil {
		t.Fatal(err)
	}
	count(2)
	if lease, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, db, 41, caps); err != nil {
		t.Fatal(err)
	} else if lease.digest == first.digest {
		t.Fatal("reused lease digest")
	}
	count(3)

	// Independently connected replicas cannot oversubscribe during a burst.
	if err := db.Exec("DELETE FROM xd_baidu_jsapi_loader_flights").Error; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	admitted := make([]baiduJSAPILoaderLease, 0, 3)
	var unexpected []error
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			connection := db
			if i%2 == 1 {
				connection = peer
			}
			owner := uint64(51 + i%2)
			lease, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, connection, owner, caps)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				admitted = append(admitted, lease)
			} else if !errors.Is(err, errBaiduJSAPIFlightDenied) {
				unexpected = append(unexpected, err)
			}
		}(i)
	}
	wg.Wait()
	if len(unexpected) != 0 || len(admitted) != 3 {
		t.Fatalf("admitted=%d unexpected=%d", len(admitted), len(unexpected))
	}
	count(3)
	var a, b int64
	if err := peer.Model(&meta.BaiduJSAPILoaderFlight{}).Where("owner_id = ?", 51).Count(&a).Error; err != nil {
		t.Fatal(err)
	}
	if err := peer.Model(&meta.BaiduJSAPILoaderFlight{}).Where("owner_id = ?", 52).Count(&b).Error; err != nil {
		t.Fatal(err)
	}
	if a > 2 || b > 2 || a+b != 3 {
		t.Fatalf("owner caps drift: %d, %d", a, b)
	}

	// Crash recovery uses DB time and does not release another user's lease.
	if err := db.Exec("UPDATE xd_baidu_jsapi_loader_flights SET expires_at = ?", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduJSAPILoaderFlightWithLimits(ctx, peer, 61, caps); err != nil {
		t.Fatal(err)
	}
	count(1)
	if err := releaseBaiduJSAPILoaderFlight(ctx, db, admitted[0]); err != nil {
		t.Fatal(err)
	}
	count(1)

	if err := db.Migrator().DropTable(&meta.BaiduJSAPILoaderFlight{}); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduJSAPILoaderFlight(ctx, peer, 61); !errors.Is(err, errBaiduJSAPIFlightDenied) {
		t.Fatal("missing flight table admitted")
	}
}
