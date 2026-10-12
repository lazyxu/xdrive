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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type blockedSourcePreflightFailure struct {
	started chan struct{}
	release chan struct{}
}

func (h *blockedSourcePreflightFailure) RunPullSource(_ context.Context, _ meta.Source) (client.SyncRun, error) {
	close(h.started)
	<-h.release
	return client.SyncRun{}, errors.New("provider preflight failed")
}

// R-SYNC-003: a preflight failure from an older scheduled worker must not
// consume a manual trigger accepted while that worker was still running.
// The test exercises the real Runner and authenticated source trigger route,
// with a channel barrier only at the upstream connector preflight.
func TestOldSourcePreflightFailureCannotEraseNewManualTrigger(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_trigger_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
	})
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "source-trigger-race-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Pull waiting for preflight", Kind: "test_pull",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		ScheduleType: "interval", ScheduleExpression: "6h", Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("source-trigger-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()

	handler := &blockedSourcePreflightFailure{
		started: make(chan struct{}), release: make(chan struct{}),
	}
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(handler.release) }) }
	t.Cleanup(unblock)
	runner := &pullworker.Runner{
		DB: db, Handlers: map[string]pullworker.SourceHandler{source.Kind: handler},
		MaxConcurrency: 1,
	}
	type outcome struct {
		report pullworker.RunAllReport
		err    error
	}
	done := make(chan outcome, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	go func() {
		report, runErr := runner.RunAll(ctx)
		done <- outcome{report, runErr}
	}()
	select {
	case <-handler.started:
	case <-time.After(12 * time.Second):
		t.Fatal("source worker never reached preflight barrier")
	}

	// This is the actual route used for a new user request, not a synthetic
	// update to the same database column. Its commit precedes old preflight exit.
	request(t, router, "POST", fmt.Sprintf("/api/v1/sources/%d/trigger", source.ID), token, nil, 202)
	var queued meta.Source
	if err := db.First(&queued, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if queued.RunRequestedAt == nil {
		t.Fatal("manual trigger was not persisted by its successful HTTP response")
	}
	acceptedAt := *queued.RunRequestedAt
	unblock()
	select {
	case result := <-done:
		if result.report.Failed != 1 || result.report.Completed != 0 || result.err == nil {
			t.Fatalf("old preflight did not finish as a failure: report=%+v err=%v", result.report, result.err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("old preflight did not finish after release")
	}
	var after meta.Source
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.RunRequestedAt == nil || !after.RunRequestedAt.Equal(acceptedAt) {
		t.Fatalf("old preflight failure erased a newer accepted manual trigger: accepted=%s after=%v", acceptedAt.Format(time.RFC3339Nano), after.RunRequestedAt)
	}
}
