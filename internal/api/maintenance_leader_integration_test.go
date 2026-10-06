package api

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMaintenanceLeaderPassCoordinatesServerInstances(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	dbA, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	dbB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{dbA, dbB} {
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDB.SetMaxOpenConns(4)
		sqlDB.SetMaxIdleConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}

	serverA := &Server{DB: dbA}
	serverB := &Server{DB: dbB}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	key := "system-maintenance:test:" + uuid.NewString()
	started := make(chan struct{})
	release := make(chan struct{})
	firstDone := make(chan bool, 1)

	go func() {
		firstDone <- serverA.runMaintenanceLeaderPass(ctx, key, func() {
			close(started)
			<-release
		})
	}()

	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("first maintenance leader pass did not start")
	}

	var sameKeyRuns atomic.Int32
	if acquired := serverB.runMaintenanceLeaderPass(ctx, key, func() {
		sameKeyRuns.Add(1)
	}); acquired {
		t.Fatal("same maintenance lease was acquired concurrently")
	}
	if sameKeyRuns.Load() != 0 {
		t.Fatal("non-leader maintenance callback unexpectedly ran")
	}

	var otherKeyRuns atomic.Int32
	if acquired := serverB.runMaintenanceLeaderPass(ctx, key+":other", func() {
		otherKeyRuns.Add(1)
	}); !acquired {
		t.Fatal("independent maintenance lease was not acquired")
	}
	if otherKeyRuns.Load() != 1 {
		t.Fatalf("other maintenance callback runs=%d want=1", otherKeyRuns.Load())
	}

	close(release)
	select {
	case acquired := <-firstDone:
		if !acquired {
			t.Fatal("first maintenance leader pass did not hold the lease")
		}
	case <-ctx.Done():
		t.Fatal("first maintenance leader pass did not finish")
	}

	var afterReleaseRuns atomic.Int32
	if acquired := serverB.runMaintenanceLeaderPass(ctx, key, func() {
		afterReleaseRuns.Add(1)
	}); !acquired {
		t.Fatal("released maintenance lease was not reacquired")
	}
	if afterReleaseRuns.Load() != 1 {
		t.Fatalf("post-release maintenance callback runs=%d want=1", afterReleaseRuns.Load())
	}
}

func TestMaintenanceLeaderKeysAreIndependent(t *testing.T) {
	if maintenanceLeaderJanitor == maintenanceLeaderStorageSampler {
		t.Fatal("Janitor and storage sampler must use independent leader leases")
	}
}
