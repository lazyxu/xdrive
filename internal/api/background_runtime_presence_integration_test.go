package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBackgroundRuntimePresenceMergesServersAndExpires(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "runtime_presence_" +
		strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(
		fmt.Sprintf(`CREATE SCHEMA "%s"`, schema),
	).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(
			fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema),
		).Error
		if sqlDB, err := baseDB.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.BackgroundRuntimePresence{}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	cfg := background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 1,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 8,
		},
	}
	schedulerA := background.NewScheduler(ctx, cfg)
	schedulerB := background.NewScheduler(ctx, cfg)

	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(release) })
		schedulerA.Close()
		schedulerB.Close()
	})

	startedA := make(chan struct{}, 1)
	startedB := make(chan struct{}, 1)
	const ownerID = uint64(42)
	submit := func(
		scheduler *background.Scheduler,
		key string,
		started chan<- struct{},
	) *background.Handle {
		t.Helper()
		handle, err := scheduler.Submit(background.Task{
			Key:       key,
			Kind:      "media.thumbnail",
			GroupKey:  "media.thumbnail",
			Scope:     background.ScopeUser,
			OwnerID:   ownerID,
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorSystem,
			Priority:  background.PriorityP0,
			Resource:  background.ResourceMediaCPU,
			Run: func(ctx context.Context) error {
				started <- struct{}{}
				select {
				case <-ctx.Done():
					return context.Cause(ctx)
				case <-release:
					return nil
				}
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return handle
	}

	handleA := submit(schedulerA, "thumb-a", startedA)
	handleB := submit(schedulerB, "thumb-b", startedB)
	select {
	case <-startedA:
	case <-time.After(time.Second):
		t.Fatal("Server A task did not start")
	}
	select {
	case <-startedB:
	case <-time.After(time.Second):
		t.Fatal("Server B task did not start")
	}

	serverA := &Server{
		DB:                          db,
		BackgroundScheduler:         schedulerA,
		BackgroundRuntimeInstanceID: "server-a",
	}
	serverB := &Server{
		DB:                          db,
		BackgroundScheduler:         schedulerB,
		BackgroundRuntimeInstanceID: "server-b",
	}
	now := time.Now().UTC()
	if err := serverB.publishBackgroundRuntimePresence(ctx, now); err != nil {
		t.Fatal(err)
	}

	owner := ownerID
	tasks := serverA.backgroundClusterRuntimeTasks(
		ctx,
		&owner,
		ownerID,
		false,
	)
	task := backgroundTaskByID(
		tasks,
		fmt.Sprintf("runtime:user:%d:media.thumbnail", ownerID),
	)
	if task == nil {
		t.Fatalf("cluster runtime task missing: %+v", tasks)
	}
	if task.State != "running" ||
		task.ActiveCount != 2 ||
		task.RunningCount != 2 ||
		task.QueuedCount != 0 ||
		task.InstanceCount != 2 {
		t.Fatalf("unexpected merged runtime task: %+v", task)
	}

	if err := db.Model(&meta.BackgroundRuntimePresence{}).
		Where("instance_id = ?", "server-b").
		Update("expires_at", now.Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	tasks = serverA.backgroundClusterRuntimeTasks(
		ctx,
		&owner,
		ownerID,
		false,
	)
	task = backgroundTaskByID(
		tasks,
		fmt.Sprintf("runtime:user:%d:media.thumbnail", ownerID),
	)
	if task == nil ||
		task.ActiveCount != 1 ||
		task.RunningCount != 1 ||
		task.InstanceCount != 1 {
		t.Fatalf("expired remote presence still contributed: %+v", task)
	}

	releaseOnce.Do(func() { close(release) })
	if err := handleA.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := handleB.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := serverB.publishBackgroundRuntimePresence(
		ctx,
		now.Add(time.Second),
	); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.BackgroundRuntimePresence{}).
		Where("instance_id = ?", "server-b").
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("completed Server B presence rows=%d want=0", count)
	}
}
