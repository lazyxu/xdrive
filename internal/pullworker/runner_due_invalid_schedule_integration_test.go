package pullworker

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// A malformed schedule is a Source-local failure, not a global worker stop.
func TestRunDueInvalidScheduleDoesNotStarveIndependentSources(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "pull_bad_schedule_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "pull-bad-schedule", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	broken := meta.Source{
		OwnerID: owner.ID, Name: "Broken schedule", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
		ScheduleType: sourceschedule.TypeCron, ScheduleExpression: "bad-cron", ScheduleTimezone: "UTC",
	}
	healthy := meta.Source{
		OwnerID: owner.ID, Name: "Healthy scheduled Pull", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
		ScheduleType: sourceschedule.TypeInterval, ScheduleExpression: "6h",
	}
	for _, source := range []*meta.Source{&broken, &healthy} {
		if err := db.Create(source).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Both Sources have an enabled connector: the malformed schedule must be
	// isolated by Source rather than silently dropped as disabled.
	var handlerCalls atomic.Int32
	handler := SourceHandlerFunc(func(_ context.Context, source meta.Source) (client.SyncRun, error) {
		seq := handlerCalls.Add(1)
		return client.SyncRun{
			ID:       fmt.Sprintf("run-%d-%d", source.ID, seq),
			SourceID: source.ID, Status: meta.SyncRunStatusCompleted,
		}, nil
	})
	runner := &Runner{DB: db, Handlers: map[string]SourceHandler{
		"yike_photos": handler,
	}, MaxConcurrency: 2}
	now := time.Now().UTC()
	report, err := runner.RunDue(context.Background(), now, 6*time.Hour)
	if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("source %d", broken.ID)) {
		t.Fatalf("bad schedule error not attributed to its Source: %v", err)
	}
	if report.Eligible != 2 || report.Completed != 1 || report.Failed != 1 ||
		handlerCalls.Load() != 1 {
		t.Fatalf("one malformed schedule blocked healthy Pull: report=%+v totalCalls=%d",
			report, handlerCalls.Load())
	}
	var recorded, independent meta.Source
	if err := db.First(&recorded, broken.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&independent, healthy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if recorded.LastRunAt == nil || !strings.Contains(recorded.LastError, "schedule") {
		t.Fatalf("bad Source did not retain schedule diagnostics: %+v", recorded)
	}
	if independent.Revision != 1 || independent.Status != meta.SourceStatusActive || independent.LastError != "" {
		t.Fatalf("broken Source changed independent Source state: %+v", independent)
	}
	if err := db.Model(&meta.Source{}).Where("id = ?", broken.ID).Updates(map[string]any{
		"schedule_type":       sourceschedule.TypeInterval,
		"schedule_expression": "6h",
		"schedule_timezone":   "",
		"last_run_at":         nil,
		"revision":            gorm.Expr("revision + 1"),
	}).Error; err != nil {
		t.Fatal(err)
	}
	report, err = runner.RunDue(context.Background(), now.Add(time.Minute), 6*time.Hour)
	if err != nil || report.Completed != 2 || report.Failed != 0 ||
		handlerCalls.Load() != 3 {
		t.Fatalf("repair did not restore normal dispatch: report=%+v err=%v totalCalls=%d",
			report, err, handlerCalls.Load())
	}
}
