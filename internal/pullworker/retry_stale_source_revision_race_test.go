package pullworker

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
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type delayedFailedPullHandler struct {
	started chan struct{}
	release chan struct{}
}

func (h *delayedFailedPullHandler) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	close(h.started)
	select {
	case <-h.release:
		return client.SyncRun{ID: uuid.NewString(), SourceID: source.ID, Status: meta.SyncRunStatusFailed}, errors.New("upstream transient failure")
	case <-ctx.Done():
		return client.SyncRun{}, ctx.Err()
	}
}

func (*delayedFailedPullHandler) ClassifyPullRetry(error) RetryClass { return RetryTransient }

// A Source revision and schedule can be edited while a previously loaded job
// is still executing. Its late failure cannot re-arm automatic retry for the
// newly paused, manual-only configuration.
func TestLateFailedPullCannotRearmRetryAfterSourceRevisionChange(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "pull_retry_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
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
	owner := meta.User{Username: "pull-retry-race-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Pull retry generation", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		ScheduleType: sourceschedule.TypeInterval, ScheduleExpression: "6h", Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	handler := &delayedFailedPullHandler{started: make(chan struct{}), release: make(chan struct{})}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(handler.release) }) }
	t.Cleanup(release)
	runner := &Runner{DB: db, Handlers: map[string]SourceHandler{source.Kind: handler}, MaxConcurrency: 1}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	type outcome struct {
		report RunAllReport
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		report, runErr := runner.runSources(ctx, []meta.Source{source}, time.Now().UTC())
		done <- outcome{report: report, err: runErr}
	}()
	select {
	case <-handler.started:
	case <-time.After(10 * time.Second):
		t.Fatal("real Source scheduler never entered the running handler")
	}

	// Equivalent to an operator's guarded Source PATCH: edit committed before
	// the already-running handler returns its delayed transient failure.
	err = db.Transaction(func(tx *gorm.DB) error {
		var current meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, source.ID).Error; err != nil {
			return err
		}
		if current.Revision != source.Revision {
			return fmt.Errorf("unexpected current revision %d", current.Revision)
		}
		return tx.Model(&meta.Source{}).Where("id = ? AND revision = ?", source.ID, source.Revision).Updates(map[string]any{
			"revision": gorm.Expr("revision + 1"), "status": meta.SourceStatusPaused,
			"schedule_type": sourceschedule.TypeManual, "schedule_expression": "", "schedule_timezone": "",
		}).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	release()
	select {
	case result := <-done:
		if result.report.Failed != 1 || result.err == nil || !strings.Contains(result.err.Error(), "upstream transient failure") {
			t.Fatalf("failed Source run did not reach original retry finalizer: report=%+v err=%v", result.report, result.err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("Source runner did not finish after releasing original handler")
	}

	var updated meta.Source
	if err := db.First(&updated, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.Revision != source.Revision+1 || updated.Status != meta.SourceStatusPaused || updated.ScheduleType != sourceschedule.TypeManual {
		t.Fatalf("guarded configuration edit was not committed: %+v", updated)
	}
	if updated.RetryAttempt != 0 || updated.RetryAt != nil || updated.RetryClass != "" {
		t.Fatalf("stale completed-run callback rearmed retry for paused manual Source revision %d: attempt=%d at=%v class=%q", updated.Revision, updated.RetryAttempt, updated.RetryAt, updated.RetryClass)
	}
}
