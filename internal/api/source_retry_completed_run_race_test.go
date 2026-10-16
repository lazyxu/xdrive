package api

import (
	"context"
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
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// R-SYNC-005 is separate from R-SYNC-004 (stale success/error metadata): a
// retry-classified old preflight must not re-arm automatic retry after a newer
// authenticated Source run completed successfully at the same Source revision.
type classifiedBlockedSourcePreflightFailure struct {
	*blockedSourcePreflightFailure
}

func (*classifiedBlockedSourcePreflightFailure) ClassifyPullRetry(error) pullworker.RetryClass {
	return pullworker.RetryTransient
}

func TestOldSourceRetryCannotRearmAfterNewerCompletedRun(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_retry_completed_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{},
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceRunFailure{}, &meta.SourceRunSkip{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "source-retry-completed-race-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{
		OwnerID: owner.ID, Name: "race-target", Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Pull retry after competing completion", Kind: "race_pull_retry",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		ScheduleType: "interval", ScheduleExpression: "6h", Revision: 1,
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	manager := auth.New("source-retry-completed-race-secret", time.Hour)
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := (&Server{DB: db, Auth: manager, AllowedOrigin: "http://localhost"}).Router()

	handler := &classifiedBlockedSourcePreflightFailure{
		blockedSourcePreflightFailure: &blockedSourcePreflightFailure{
			started: make(chan struct{}), release: make(chan struct{}),
		},
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
		done <- outcome{report: report, err: runErr}
	}()
	select {
	case <-handler.started:
	case <-time.After(12 * time.Second):
		t.Fatal("old worker never reached upstream preflight barrier")
	}

	// A separate Source worker completes an authenticated begin + finish
	// while the older preflight is in flight. Both use the same Source
	// revision; run_requested_at remains NULL throughout.
	runID := uuid.NewString()
	path := fmt.Sprintf("/api/v1/sources/%d/runs", source.ID)
	request(t, router, http.MethodPost, path, token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)),
		http.StatusCreated)
	finishPath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, runID)
	request(t, router, http.MethodPost, finishPath, token,
		strings.NewReader(`{"status":"completed","complete_inventory":true,"summary":{}}`),
		http.StatusOK)
	var success meta.Source
	if err := db.First(&success, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if success.LastRunAt == nil || success.LastSuccessAt == nil || success.LastError != "" || success.RunRequestedAt != nil ||
		success.RetryAttempt != 0 || success.RetryAt != nil || success.RetryClass != "" {
		t.Fatalf("newer successful Source run not durably recorded with clear retry state: %+v", success)
	}

	unblock()
	select {
	case result := <-done:
		if result.report.Failed != 1 || result.report.Completed != 0 || result.err == nil {
			t.Fatalf("old preflight did not return its original failure: report=%+v err=%v", result.report, result.err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("old preflight never completed after release")
	}
	var after meta.Source
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.LastRunAt == nil || !after.LastRunAt.Equal(*success.LastRunAt) ||
		after.LastSuccessAt == nil || !after.LastSuccessAt.Equal(*success.LastSuccessAt) || after.LastError != "" {
		t.Fatalf("prerequisite R-SYNC-004 regression: older preflight changed successful Source metadata: before=%+v after=%+v", success, after)
	}
	if after.RetryAttempt != 0 || after.RetryAt != nil || after.RetryClass != "" {
		t.Fatalf("stale preflight re-armed retry after newer completed Source run: attempt=%d retry_at=%v retry_class=%q",
			after.RetryAttempt, after.RetryAt, after.RetryClass)
	}
}
