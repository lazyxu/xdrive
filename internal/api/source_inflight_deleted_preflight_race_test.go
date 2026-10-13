package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
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

// R-SYNC-001-B differs from the already-covered queued-before-dispatch DELETE:
// the real Scheduler has already entered the Source Handler, but that handler
// has not yet begun any durable SyncRun. A subsequently deleted Source must not
// be reported as a *failed* scheduled source when the obsolete preflight ends.
func TestDeletedInflightPullPreflightCannotCountAsFailedSource(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_inflight_delete_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		Username: "inflight-delete-preflight-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "preflight-delete-target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "In-flight preflight deletion", Kind: "race_pull_inflight_delete",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h",
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("inflight-pull-delete-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()

	ctx, cancel := context.WithCancel(context.Background())
	scheduler := background.NewScheduler(ctx, background.Config{
		Capacity:      map[background.ResourceClass]int{background.ResourceNetwork: 1},
		QueueCapacity: map[background.ResourceClass]int{background.ResourceNetwork: 2},
	})
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	handler := pullworker.SourceHandlerFunc(func(taskCtx context.Context, got meta.Source) (client.SyncRun, error) {
		if got.ID != source.ID {
			return client.SyncRun{}, fmt.Errorf("unexpected Source %d", got.ID)
		}
		close(entered) // The genuine Scheduler dispatch-time preflight has passed.
		select {
		case <-release:
		case <-taskCtx.Done():
			return client.SyncRun{}, taskCtx.Err()
		}
		// Represents a provider's pre-durable-run preflight returning a failure
		// after the user has independently deleted its Source.
		return client.SyncRun{}, errors.New("old provider preflight returned after Source deletion")
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
			t.Error("in-flight Pull runner failed to exit during cleanup")
		}
		scheduler.Close()
	})
	select {
	case <-entered:
	case <-time.After(8 * time.Second):
		t.Fatal("Pull did not enter the real Handler after Scheduler dispatch")
	}
	// With no durable SyncRun yet, authenticated owner deletion is accepted.
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/sources/%d", source.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": "\"1\""})
	var remaining, runs int64
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 || runs != 0 {
		t.Fatalf("preflight deletion fixture must have absent Source and no durable run: sources=%d runs=%d", remaining, runs)
	}
	unblock()
	var got outcome
	select {
	case got = <-done:
	case <-time.After(8 * time.Second):
		t.Fatal("Pull did not return after released obsolete preflight")
	}
	if got.report.Eligible != 1 || got.report.Skipped != 1 ||
		got.report.Failed != 0 || got.report.Completed != 0 || got.err != nil {
		t.Fatalf("deleted in-flight preflight must be an obsolete skip, not a failed Pull: report=%+v err=%v",
			got.report, got.err)
	}
}
