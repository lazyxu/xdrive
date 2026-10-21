package main

import (
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

func TestPWAOfflineInstanceDurableConcurrentAndIsolated(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not set")
	}
	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	open := func() *gorm.DB {
		t.Helper()
		schema := "pwa_id_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if err := adminDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = adminDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
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
		if err := db.AutoMigrate(&meta.PWAOfflineInstance{}); err != nil {
			t.Fatal(err)
		}
		return db
	}
	primary := open()
	const workers = 6
	var wg sync.WaitGroup
	results := make(chan string, workers)
	failures := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := meta.EnsurePWAOfflineInstanceID(primary)
			if err != nil {
				failures <- err
				return
			}
			results <- id
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	var expected string
	for id := range results {
		if expected == "" {
			expected = id
		}
		if id != expected {
			t.Fatalf("race yielded different identities: %q vs %q", id, expected)
		}
	}
	if expected == "" {
		t.Fatal("no identity generated")
	}
	var n int64
	if err := primary.Model(&meta.PWAOfflineInstance{}).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("singleton rows=%d want=1", n)
	}
	again, err := meta.EnsurePWAOfflineInstanceID(primary)
	if err != nil || again != expected {
		t.Fatalf("restart identity=%q error=%v", again, err)
	}
	otherDB := open()
	other, err := meta.EnsurePWAOfflineInstanceID(otherDB)
	if err != nil {
		t.Fatal(err)
	}
	if other == expected {
		t.Fatal("independent database shared offline instance ID")
	}
	if err := primary.Model(&meta.PWAOfflineInstance{}).Where("slot = ?", 1).Update("instance_id", "invalid").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := meta.EnsurePWAOfflineInstanceID(primary); err == nil {
		t.Fatal("corrupt identity must fail closed; never re-seed it")
	}
}
