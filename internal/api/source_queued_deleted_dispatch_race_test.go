package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// R-SYNC-011: a Pull Source deleted after it is queued, but before its
// background network worker dispatches, must never enter its stale handler.
func TestDeletedQueuedPullSourceCannotDispatchFromStaleSnapshot(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_queued_delete_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := u.Query()
	params.Set("search_path", schema)
	u.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceRunFailure{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "queued-deleted-source-owner", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "queued-delete-target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Queued Pull source awaiting dispatch", Kind: "race_pull_queued_delete",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	second := source
	second.ID = 0
	second.Name = "Deleted while queued Pull"
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("out-of-order-progress-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()

	ctx, cancel := context.WithCancel(context.Background())
	scheduler := background.NewScheduler(ctx, background.Config{
		Capacity:      map[background.ResourceClass]int{background.ResourceNetwork: 1},
		QueueCapacity: map[background.ResourceClass]int{background.ResourceNetwork: 4},
	})
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(releaseFirst) }) }
	var staleDispatches atomic.Int32
	handler := pullworker.SourceHandlerFunc(func(taskCtx context.Context, queued meta.Source) (client.SyncRun, error) {
		if queued.ID == source.ID {
			close(firstStarted)
			select {
			case <-releaseFirst:
			case <-taskCtx.Done():
				return client.SyncRun{}, taskCtx.Err()
			}
		} else if queued.ID == second.ID {
			staleDispatches.Add(1)
		}
		return client.SyncRun{SourceID: queued.ID, Status: meta.SyncRunStatusCompleted}, nil
	})
	runner := &pullworker.Runner{
		DB: db, Scheduler: scheduler, MaxConcurrency: 1,
		Handlers: map[string]pullworker.SourceHandler{source.Kind: handler},
	}
	type outcome struct {
		report pullworker.RunAllReport
		err    error
	}
	done := make(chan outcome, 1)
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		report, runErr := runner.RunAll(ctx)
		done <- outcome{report: report, err: runErr}
	}()
	t.Cleanup(func() {
		unblock()
		cancel()
		select {
		case <-exited:
		case <-time.After(5 * time.Second):
			t.Error("Pull runner did not exit during cleanup")
		}
		scheduler.Close()
	})
	select {
	case <-firstStarted:
	case <-time.After(8 * time.Second):
		t.Fatal("first Pull Source did not enter its real background handler")
	}

	// Source 2 must actually be queued AFTER RunAll loaded the DB snapshot.
	prefix := fmt.Sprintf("source.sync:%d:", second.ID)
	poll := time.NewTicker(5 * time.Millisecond)
	defer poll.Stop()
	deadline := time.NewTimer(8 * time.Second)
	defer deadline.Stop()
waitQueued:
	for {
		for _, snapshot := range scheduler.TaskSnapshots(nil) {
			if snapshot.Kind == "source.sync" && snapshot.State == "queued" &&
				strings.HasPrefix(snapshot.Identity.Key, prefix) {
				break waitQueued
			}
		}
		select {
		case <-poll.C:
		case <-deadline.C:
			t.Fatal("Source 2 never entered the real network Scheduler queue")
		}
	}

	// Authenticated DELETE wins before queued Source 2's handler dispatch.
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/sources/%d", second.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": "\"1\""})
	var remaining int64
	if err := db.Model(&meta.Source{}).Where("id = ?", second.ID).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatal("authenticated deletion did not commit before queue release")
	}
	unblock()
	var result outcome
	select {
	case result = <-done:
	case <-time.After(8 * time.Second):
		t.Fatal("Pull runner did not complete after queue release")
	}
	if got := staleDispatches.Load(); got != 0 {
		t.Fatalf("deleted queued Source entered stale provider handler %d time(s) after DELETE 204", got)
	}
	if result.err != nil || result.report.Completed != 1 || result.report.Skipped != 1 {
		t.Fatalf("deleted queued Source was not skipped: report=%+v err=%v", result.report, result.err)
	}
}
