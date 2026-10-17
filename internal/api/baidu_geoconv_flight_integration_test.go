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

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduGeoconvFlightRejectsInvalidInputs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, row := range []struct {
		ctx   context.Context
		owner uint64
		caps  baiduGeoconvFlightLimits
	}{
		{nil, 1, baiduGeoconvFlightLimits{Owner: 1, Fleet: 2}},
		{ctx, 1, baiduGeoconvFlightLimits{Owner: 1, Fleet: 2}},
		{context.Background(), 0, baiduGeoconvFlightLimits{Owner: 1, Fleet: 2}},
		{context.Background(), uint64(1) << 63, baiduGeoconvFlightLimits{Owner: 1, Fleet: 2}},
		{context.Background(), 1, baiduGeoconvFlightLimits{Owner: 0, Fleet: 2}},
		{context.Background(), 1, baiduGeoconvFlightLimits{Owner: 2, Fleet: 2}},
		{context.Background(), 1, baiduGeoconvFlightLimits{Owner: 1, Fleet: 3}},
		{context.Background(), 1, baiduGeoconvFlightLimits{Owner: 1, Fleet: 0}},
	} {
		lease, err := acquireBaiduGeoconvFlightWithLimits(row.ctx, nil, row.owner, row.caps)
		if !errors.Is(err, errBaiduGeoconvFlightDenied) || lease.digest != "" {
			t.Fatalf("unsafe geoconv flight admitted: %+v %v", lease, err)
		}
	}
	if _, err := acquireBaiduGeoconvFlight(context.Background(), nil, 1); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("missing PostgreSQL admitted capacity")
	}
	if err := releaseBaiduGeoconvFlight(ctx, nil, baiduGeoconvFlightLease{}); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("canceled release unexpectedly accepted")
	}
	if err := releaseBaiduGeoconvFlight(context.Background(), nil, baiduGeoconvFlightLease{ownerID: 1, digest: strings.Repeat("z", 64)}); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("non-hex release accepted")
	}
}

func TestBaiduGeoconvFlightRealPostgresReplicas(t *testing.T) {
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
	schema := "baidu_conv_flight_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		// Other Go API integration suites share a bounded PostgreSQL server.
		sqlDB.SetMaxOpenConns(3)
		t.Cleanup(func() { _ = sqlDB.Close() })
		return db
	}
	db, peer := open(), open()
	if err := db.AutoMigrate(&meta.BaiduGeoconvFlight{}); err != nil {
		t.Fatal(err)
	}
	count := func(want int64) {
		t.Helper()
		var got int64
		if err := peer.Model(&meta.BaiduGeoconvFlight{}).Count(&got).Error; err != nil || got != want {
			t.Fatalf("active Geoconv flight count=%d want=%d err=%v", got, want, err)
		}
	}
	ctx := context.Background()
	first, err := acquireBaiduGeoconvFlight(ctx, db, 41)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduGeoconvFlight(ctx, peer, 41); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("Owner concurrency bypassed")
	}
	second, err := acquireBaiduGeoconvFlight(ctx, peer, 42)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduGeoconvFlight(ctx, db, 43); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("fleet concurrency bypassed")
	}
	count(2)
	forged := first
	forged.ownerID = 42
	if err := releaseBaiduGeoconvFlight(ctx, peer, forged); err != nil {
		t.Fatal(err)
	}
	count(2)
	if err := releaseBaiduGeoconvFlight(ctx, peer, first); err != nil {
		t.Fatal(err)
	}
	if err := releaseBaiduGeoconvFlight(ctx, db, first); err != nil {
		t.Fatal(err)
	}
	count(1)
	replacement, err := acquireBaiduGeoconvFlight(ctx, db, 41)
	if err != nil || replacement.digest == first.digest {
		t.Fatalf("random lease was not replaced: %v", err)
	}
	count(2)
	if err := releaseBaiduGeoconvFlight(ctx, peer, second); err != nil {
		t.Fatal(err)
	}
	if err := releaseBaiduGeoconvFlight(ctx, db, replacement); err != nil {
		t.Fatal(err)
	}
	count(0)

	var wg sync.WaitGroup
	var mu sync.Mutex
	var admitted []baiduGeoconvFlightLease
	var unexpected []error
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			conn := db
			if i%2 == 1 {
				conn = peer
			}
			lease, err := acquireBaiduGeoconvFlight(ctx, conn, uint64(51+i%3))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				admitted = append(admitted, lease)
			} else if !errors.Is(err, errBaiduGeoconvFlightDenied) {
				unexpected = append(unexpected, err)
			}
		}(i)
	}
	wg.Wait()
	if len(unexpected) != 0 || len(admitted) != 2 {
		t.Fatalf("independent pools bypassed fleet capacity: admitted=%d unexpected=%d", len(admitted), len(unexpected))
	}
	count(2)
	var owners []meta.BaiduGeoconvFlight
	if err := peer.Find(&owners).Error; err != nil {
		t.Fatal(err)
	}
	if owners[0].OwnerID == owners[1].OwnerID {
		t.Fatal("two concurrent claims assigned to the same Owner")
	}

	// A crashed Server cannot leave permanent in-flight capacity occupation.
	if err := db.Exec("UPDATE xd_baidu_geoconv_flights SET expires_at = clock_timestamp() - INTERVAL '1 second'").Error; err != nil {
		t.Fatal(err)
	}
	afterCrash, err := acquireBaiduGeoconvFlight(ctx, peer, 61)
	if err != nil {
		t.Fatal(err)
	}
	count(1)
	if err := releaseBaiduGeoconvFlight(ctx, db, admitted[0]); err != nil {
		t.Fatal(err)
	}
	count(1)
	if err := releaseBaiduGeoconvFlight(ctx, db, afterCrash); err != nil {
		t.Fatal(err)
	}
	count(0)
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvFlight{}); err != nil {
		t.Fatal(err)
	}
	if _, err := acquireBaiduGeoconvFlight(ctx, peer, 61); !errors.Is(err, errBaiduGeoconvFlightDenied) {
		t.Fatal("missing migration permitted unmetered concurrency")
	}
}
