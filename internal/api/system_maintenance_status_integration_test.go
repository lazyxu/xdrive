package api

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
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSystemMaintenanceRunLifecycleAndInterruptedRecovery(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "maintenance_status_" +
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
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(&meta.SystemMaintenanceRun{}); err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db}
	ctx := context.Background()

	stale := meta.SystemMaintenanceRun{
		Kind:       meta.SystemMaintenanceKindJanitor,
		Status:     meta.SystemMaintenanceStatusRunning,
		Phase:      meta.SystemMaintenancePhaseContentBlobGC,
		TotalSteps: 4,
		StartedAt:  time.Now().UTC().Add(-2 * time.Hour),
	}
	if err := db.Create(&stale).Error; err != nil {
		t.Fatal(err)
	}
	staleTasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	staleTask := backgroundTaskByID(
		staleTasks,
		"system-maintenance:"+meta.SystemMaintenanceKindJanitor,
	)
	if staleTask == nil ||
		staleTask.State != "failed" ||
		!strings.Contains(staleTask.Error, "interrupted") {
		t.Fatalf("unleased running maintenance did not project interrupted: %+v", staleTask)
	}

	lease, err := sourceaccount.Acquire(
		ctx,
		db,
		maintenanceLeaderJanitor,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()

	runID := server.beginSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindJanitor,
		4,
	)
	if runID == 0 {
		t.Fatal("Janitor maintenance run was not created")
	}
	runningTasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	runningTask := backgroundTaskByID(
		runningTasks,
		"system-maintenance:"+meta.SystemMaintenanceKindJanitor,
	)
	if runningTask == nil || runningTask.State != "running" {
		t.Fatalf("leased maintenance run was not projected running: %+v", runningTask)
	}

	var recovered meta.SystemMaintenanceRun
	if err := db.First(&recovered, stale.ID).Error; err != nil {
		t.Fatal(err)
	}
	if recovered.Status != meta.SystemMaintenanceStatusFailed ||
		recovered.FinishedAt == nil ||
		!strings.Contains(recovered.Error, "interrupted") {
		t.Fatalf("stale run was not reconciled: %+v", recovered)
	}

	server.updateSystemMaintenanceRunPhase(
		ctx,
		runID,
		meta.SystemMaintenancePhaseSourceRunRetention,
		2,
		4,
	)
	result := newSystemMaintenancePassResult(4)
	result.CompletedSteps = 3
	result.addIssue(
		meta.SystemMaintenancePhaseContentBlobGC,
		fmt.Errorf("test GC failure"),
	)
	server.finishSystemMaintenanceRun(ctx, runID, result)

	var run meta.SystemMaintenanceRun
	if err := db.First(&run, runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.Status != meta.SystemMaintenanceStatusPartial ||
		run.Phase != meta.SystemMaintenancePhaseFinished ||
		run.CompletedSteps != 3 ||
		run.TotalSteps != 4 ||
		run.FinishedAt == nil ||
		!strings.Contains(run.Error, "test GC failure") {
		t.Fatalf("unexpected finished maintenance run: %+v", run)
	}

	samplerID := server.beginSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindStorageSampler,
		1,
	)
	if samplerID == 0 {
		t.Fatal("Storage sampler maintenance run was not created")
	}
	samplerResult := newSystemMaintenancePassResult(1)
	samplerResult.CompletedSteps = 1
	server.finishSystemMaintenanceRun(
		ctx,
		samplerID,
		samplerResult,
	)

	tasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 {
		t.Fatalf("maintenance tasks=%d want=2: %+v", len(tasks), tasks)
	}
	janitor := backgroundTaskByID(
		tasks,
		"system-maintenance:"+meta.SystemMaintenanceKindJanitor,
	)
	if janitor == nil || janitor.State != "partial" ||
		janitor.Progress.Current != 3 ||
		janitor.Progress.Total != 4 {
		t.Fatalf("unexpected Janitor projection: %+v", janitor)
	}
	sampler := backgroundTaskByID(
		tasks,
		"system-maintenance:"+meta.SystemMaintenanceKindStorageSampler,
	)
	if sampler == nil || sampler.State != "completed" ||
		sampler.Progress.Current != 1 ||
		sampler.Progress.Total != 1 {
		t.Fatalf("unexpected Storage sampler projection: %+v", sampler)
	}

	oldFinished := time.Now().UTC().Add(
		-systemMaintenanceHistoryRetention - 24*time.Hour,
	)
	if err := db.Model(&meta.SystemMaintenanceRun{}).
		Where("id IN ?", []uint64{recovered.ID, samplerID}).
		Updates(map[string]any{
			"finished_at": oldFinished,
			"updated_at":  oldFinished,
		}).Error; err != nil {
		t.Fatal(err)
	}

	replacementSampler := meta.SystemMaintenanceRun{
		Kind:           meta.SystemMaintenanceKindStorageSampler,
		Status:         meta.SystemMaintenanceStatusSuccess,
		Phase:          meta.SystemMaintenancePhaseFinished,
		CompletedSteps: 1,
		TotalSteps:     1,
		StartedAt:      time.Now().UTC().Add(-time.Minute),
		FinishedAt:     maintenanceTimePtr(time.Now().UTC()),
	}
	if err := db.Create(&replacementSampler).Error; err != nil {
		t.Fatal(err)
	}
	lastKnownOnly := meta.SystemMaintenanceRun{
		Kind:           "test_last_known_only",
		Status:         meta.SystemMaintenanceStatusSuccess,
		Phase:          meta.SystemMaintenancePhaseFinished,
		CompletedSteps: 1,
		TotalSteps:     1,
		StartedAt:      oldFinished.Add(-time.Minute),
		FinishedAt:     &oldFinished,
		UpdatedAt:      oldFinished,
	}
	if err := db.Create(&lastKnownOnly).Error; err != nil {
		t.Fatal(err)
	}

	if err := server.cleanupSystemMaintenanceHistory(ctx); err != nil {
		t.Fatal(err)
	}
	for _, deletedID := range []uint64{recovered.ID, samplerID} {
		var count int64
		if err := db.Model(&meta.SystemMaintenanceRun{}).
			Where("id = ?", deletedID).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expired maintenance run %d was not deleted", deletedID)
		}
	}
	for _, retainedID := range []uint64{
		runID,
		replacementSampler.ID,
		lastKnownOnly.ID,
	} {
		var count int64
		if err := db.Model(&meta.SystemMaintenanceRun{}).
			Where("id = ?", retainedID).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("maintenance run %d should be retained", retainedID)
		}
	}
}

func maintenanceTimePtr(value time.Time) *time.Time {
	return &value
}
