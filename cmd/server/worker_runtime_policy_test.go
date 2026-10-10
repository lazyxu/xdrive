package main

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
	"github.com/lazyxu/xdrive/internal/pullworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestWorkerBoundaryReadAdoptsRevisionWithoutCancellingSchedulerEarly(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "worker_runtime_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.AdminSourceWorkerSetting{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	old := newSourceWorkerScheduler(ctx, 2)
	runner := &pullworker.Runner{Scheduler: old, MaxConcurrency: 2}
	runtime := &sourceWorkerRuntimePolicy{
		db: db, parent: ctx, runner: runner, scheduler: old,
		scanInterval: 6 * time.Hour, pollInterval: time.Minute, maxConcurrency: 2,
	}
	defer func() { runtime.scheduler.Close() }()
	var effective sourceWorkerPresenceConfig
	runtime.report = func(p sourceWorkerPresenceConfig) { effective = p }
	if applied, err := runtime.apply(ctx); err != nil || applied {
		t.Fatalf("without saved policy, preserve deployment values: applied=%v err=%v", applied, err)
	}
	if err := db.Create(&meta.AdminSourceWorkerSetting{
		Name: "pull", Revision: 1,
		ScanIntervalSeconds: 120, PollIntervalSeconds: 15, MaxConcurrency: 4,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// Until apply is called from the task boundary, old scheduler/parameters remain.
	if runner.Scheduler != old || runner.MaxConcurrency != 2 || runtime.revision != 0 {
		t.Fatal("desired revision must not mutate an in-flight scheduling batch")
	}
	if applied, err := runtime.apply(ctx); err != nil || !applied {
		t.Fatalf("saved policy was not adopted at boundary: applied=%v err=%v", applied, err)
	}
	if runner.Scheduler == old || runner.Scheduler != runtime.scheduler ||
		runner.MaxConcurrency != 4 || runtime.scanInterval != 120*time.Second ||
		runtime.pollInterval != 15*time.Second || effective.revision != 1 ||
		effective.maxConcurrency != 4 {
		t.Fatalf("scheduler or effective heartbeat failed to change: %+v", runtime.presence())
	}
	replacement := runtime.scheduler
	if applied, err := runtime.apply(ctx); err != nil || applied || runtime.scheduler != replacement {
		t.Fatalf("same revision unnecessarily rebuilt: applied=%v err=%v", applied, err)
	}
	if err := db.Model(&meta.AdminSourceWorkerSetting{}).Where("name = ?", "pull").
		Updates(map[string]any{"revision": uint64(2), "poll_interval_seconds": int64(20)}).Error; err != nil {
		t.Fatal(err)
	}
	if applied, err := runtime.apply(ctx); err != nil || !applied ||
		runtime.scheduler != replacement || effective.revision != 2 ||
		runtime.pollInterval != 20*time.Second {
		t.Fatalf("poll-only edit rebuilt scheduler or failed to apply: %v %v", applied, err)
	}
	if err := db.Model(&meta.AdminSourceWorkerSetting{}).Where("name = ?", "pull").
		Updates(map[string]any{"revision": uint64(3), "max_concurrency": 99}).Error; err != nil {
		t.Fatal(err)
	}
	if applied, err := runtime.apply(ctx); err == nil || applied ||
		runtime.scheduler != replacement || effective.revision != 2 {
		t.Fatalf("bad saved settings changed last-good runtime: %v %v", applied, err)
	}
}
