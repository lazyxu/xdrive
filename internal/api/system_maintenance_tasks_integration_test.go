package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type blockingSystemMaintenanceSourceVerifyRunner struct {
	calls   atomic.Int32
	started chan struct{}
	once    sync.Once
}

func (r *blockingSystemMaintenanceSourceVerifyRunner) VerifySources(
	ctx context.Context,
) (maintenance.SourceVerifyReport, error) {
	r.calls.Add(1)
	r.once.Do(func() { close(r.started) })
	<-ctx.Done()
	return maintenance.SourceVerifyReport{}, context.Cause(ctx)
}

type immediateSystemMaintenanceSourceVerifyRunner struct {
	report maintenance.SourceVerifyReport
	calls  atomic.Int32
}

func (r *immediateSystemMaintenanceSourceVerifyRunner) VerifySources(
	context.Context,
) (maintenance.SourceVerifyReport, error) {
	r.calls.Add(1)
	return r.report, nil
}

type immediateSystemMaintenanceSourceRepairRunner struct {
	report maintenance.SourceRepairReport
	calls  atomic.Int32
}

func (r *immediateSystemMaintenanceSourceRepairRunner) RepairSources(
	context.Context,
) (maintenance.SourceRepairReport, error) {
	r.calls.Add(1)
	return r.report, nil
}

func newSystemMaintenanceTaskTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "maintenance_task_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
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
	if err := db.AutoMigrate(&meta.SystemMaintenanceRun{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func newSystemMaintenanceTaskScheduler(
	t *testing.T,
) (*background.Scheduler, context.Context) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	scheduler := background.NewScheduler(ctx, background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMaintenanceIO: 1,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMaintenanceIO: 8,
		},
		LeaseRetryDelay: 10 * time.Millisecond,
	})
	t.Cleanup(func() {
		cancel()
		scheduler.Close()
	})
	return scheduler, ctx
}

func waitSystemMaintenanceRunStatus(
	t *testing.T,
	db *gorm.DB,
	runID uint64,
	status string,
) meta.SystemMaintenanceRun {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var run meta.SystemMaintenanceRun
		if err := db.First(&run, runID).Error; err != nil {
			t.Fatal(err)
		}
		if run.Status == status {
			return run
		}
		if time.Now().After(deadline) {
			t.Fatalf("maintenance run %d status=%q want=%q: %+v", runID, run.Status, status, run)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestSourceVerifyMaintenanceIsDurableClusterSingletonAndCancellable(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	schedulerA, ctx := newSystemMaintenanceTaskScheduler(t)
	schedulerB, _ := newSystemMaintenanceTaskScheduler(t)
	runner := &blockingSystemMaintenanceSourceVerifyRunner{
		started: make(chan struct{}),
	}
	serverA := &Server{
		DB:                            db,
		BackgroundScheduler:           schedulerA,
		systemMaintenanceSourceVerify: runner,
		systemMaintenanceHeartbeat:    20 * time.Millisecond,
	}
	serverB := &Server{
		DB:                            db,
		BackgroundScheduler:           schedulerB,
		systemMaintenanceSourceVerify: runner,
		systemMaintenanceHeartbeat:    20 * time.Millisecond,
	}

	idle, err := serverA.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	idleTask := backgroundTaskByID(
		idle,
		systemMaintenanceTaskCenterID(meta.SystemMaintenanceKindSourceVerify),
	)
	if idleTask == nil || idleTask.State != "idle" ||
		!backgroundTaskActionAllowed(idleTask.ControlActions, backgroundTaskActionRun) {
		t.Fatalf("unexpected idle source verify task: %+v", idleTask)
	}

	run, err := serverA.requestSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindSourceVerify,
		background.InitiatorAdmin,
		99,
	)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-runner.started:
	case <-time.After(2 * time.Second):
		t.Fatal("source verify runner did not start")
	}
	waitSystemMaintenanceRunStatus(t, db, run.ID, meta.SystemMaintenanceStatusRunning)

	serverB.reconcileSystemMaintenanceTasks(ctx)
	time.Sleep(80 * time.Millisecond)
	if got := runner.calls.Load(); got != 1 {
		t.Fatalf("source verify calls=%d want=1 across two Servers", got)
	}

	cancelledRun, err := serverB.requestSystemMaintenanceCancel(
		ctx,
		meta.SystemMaintenanceKindSourceVerify,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelledRun.ID != run.ID {
		t.Fatalf("cancelled run=%d want=%d", cancelledRun.ID, run.ID)
	}
	cancelled := waitSystemMaintenanceRunStatus(
		t,
		db,
		run.ID,
		meta.SystemMaintenanceStatusCancelled,
	)
	if cancelled.CancelRequestedAt == nil || cancelled.FinishedAt == nil {
		t.Fatalf("cancelled source verify missing durable timestamps: %+v", cancelled)
	}
	if got := runner.calls.Load(); got != 1 {
		t.Fatalf("cancel started duplicate source verify: calls=%d", got)
	}
}

func TestSourceVerifyMaintenanceCompletesWithFindingsAndRecoversQueuedRun(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	scheduler, ctx := newSystemMaintenanceTaskScheduler(t)
	runner := &immediateSystemMaintenanceSourceVerifyRunner{
		report: maintenance.SourceVerifyReport{
			Sources: 2,
			Items:   5,
			Issues: []maintenance.SourceBindingIssue{
				{SourceID: 1, Reason: "test_issue"},
			},
		},
	}
	server := &Server{
		DB:                            db,
		BackgroundScheduler:           scheduler,
		systemMaintenanceSourceVerify: runner,
		systemMaintenanceHeartbeat:    20 * time.Millisecond,
	}

	now := time.Now().UTC()
	recovered := meta.SystemMaintenanceRun{
		Kind:        meta.SystemMaintenanceKindSourceVerify,
		Status:      meta.SystemMaintenanceStatusQueued,
		Phase:       meta.SystemMaintenancePhaseQueued,
		Trigger:     string(background.TriggerAdminAction),
		Initiator:   string(background.InitiatorAdmin),
		InitiatorID: 77,
		TotalSteps:  1,
		StartedAt:   now,
	}
	if err := db.Create(&recovered).Error; err != nil {
		t.Fatal(err)
	}

	server.reconcileSystemMaintenanceTasks(ctx)
	finished := waitSystemMaintenanceRunStatus(t, db, recovered.ID, meta.SystemMaintenanceStatusIssues)
	if finished.FinishedAt == nil ||
		!strings.Contains(finished.Summary, "发现 1 个一致性问题") {
		t.Fatalf("unexpected source verify result: %+v", finished)
	}
	if runner.calls.Load() != 1 {
		t.Fatalf("source verify calls=%d want=1", runner.calls.Load())
	}

	tasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	task := backgroundTaskByID(
		tasks,
		systemMaintenanceTaskCenterID(meta.SystemMaintenanceKindSourceVerify),
	)
	if task == nil ||
		task.State != "issues" ||
		task.Trigger != string(background.TriggerAdminAction) ||
		task.Initiator != string(background.InitiatorAdmin) ||
		task.Progress.CurrentItem != finished.Summary ||
		!backgroundTaskActionAllowed(task.ControlActions, backgroundTaskActionRun) {
		t.Fatalf("unexpected completed source verify Task Center row: %+v", task)
	}

	next, err := server.requestSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindSourceVerify,
		background.InitiatorAdmin,
		88,
	)
	if err != nil {
		t.Fatal(err)
	}
	if next.ID == recovered.ID {
		t.Fatal("new source verify request reused terminal run")
	}
	waitSystemMaintenanceRunStatus(t, db, next.ID, meta.SystemMaintenanceStatusIssues)
	if runner.calls.Load() != 2 {
		t.Fatalf("rerun calls=%d want=2", runner.calls.Load())
	}
}

func TestSourceRepairMaintenanceWaitsForIntegrityLeaseAndReportsResidualIssues(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	schedulerA, ctx := newSystemMaintenanceTaskScheduler(t)
	schedulerB, _ := newSystemMaintenanceTaskScheduler(t)
	verifyRunner := &blockingSystemMaintenanceSourceVerifyRunner{
		started: make(chan struct{}),
	}
	repairRunner := &immediateSystemMaintenanceSourceRepairRunner{
		report: maintenance.SourceRepairReport{
			Actions: []maintenance.SourceRepairAction{
				{SourceID: 1, SourceItemID: 1, Applied: true},
				{SourceID: 1, SourceItemID: 2, Applied: true},
			},
			RunActions: []maintenance.SourceRunRepairAction{
				{SourceID: 1, Applied: true},
			},
			Skipped: []maintenance.SourceBindingIssue{
				{SourceID: 1, Reason: "target_node_missing"},
			},
			After: maintenance.SourceVerifyReport{
				Issues: []maintenance.SourceBindingIssue{
					{SourceID: 1, Reason: "target_node_missing"},
				},
			},
		},
	}
	serverA := &Server{
		DB:                            db,
		BackgroundScheduler:           schedulerA,
		systemMaintenanceSourceVerify: verifyRunner,
		systemMaintenanceHeartbeat:    20 * time.Millisecond,
	}
	serverB := &Server{
		DB:                            db,
		BackgroundScheduler:           schedulerB,
		systemMaintenanceSourceRepair: repairRunner,
		systemMaintenanceHeartbeat:    20 * time.Millisecond,
	}

	verifyRun, err := serverA.requestSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindSourceVerify,
		background.InitiatorAdmin,
		99,
	)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-verifyRunner.started:
	case <-time.After(2 * time.Second):
		t.Fatal("source verify runner did not start")
	}
	waitSystemMaintenanceRunStatus(
		t,
		db,
		verifyRun.ID,
		meta.SystemMaintenanceStatusRunning,
	)

	repairRun, err := serverB.requestSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindSourceRepair,
		background.InitiatorAdmin,
		99,
	)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(80 * time.Millisecond)
	if got := repairRunner.calls.Load(); got != 0 {
		t.Fatalf("source repair ran concurrently with source verify: calls=%d", got)
	}

	if _, err := serverB.requestSystemMaintenanceCancel(
		ctx,
		meta.SystemMaintenanceKindSourceVerify,
	); err != nil {
		t.Fatal(err)
	}
	waitSystemMaintenanceRunStatus(
		t,
		db,
		verifyRun.ID,
		meta.SystemMaintenanceStatusCancelled,
	)
	finished := waitSystemMaintenanceRunStatus(
		t,
		db,
		repairRun.ID,
		meta.SystemMaintenanceStatusIssues,
	)
	if repairRunner.calls.Load() != 1 {
		t.Fatalf("source repair calls=%d want=1", repairRunner.calls.Load())
	}
	for _, want := range []string{
		"修复 2 个绑定",
		"处理 1 个过期同步任务",
		"跳过 1 项",
		"剩余 1 个一致性问题",
	} {
		if !strings.Contains(finished.Summary, want) {
			t.Fatalf("source repair summary=%q missing %q", finished.Summary, want)
		}
	}

	tasks, err := serverB.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	repairTask := backgroundTaskByID(
		tasks,
		systemMaintenanceTaskCenterID(meta.SystemMaintenanceKindSourceRepair),
	)
	if repairTask == nil ||
		repairTask.State != "issues" ||
		repairTask.Progress.CurrentItem != finished.Summary ||
		!backgroundTaskActionAllowed(
			repairTask.ControlActions,
			backgroundTaskActionRun,
		) {
		t.Fatalf("unexpected source repair Task Center row: %+v", repairTask)
	}
}

func TestSourceVerifyMaintenanceRejectsNonAdminIntent(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	server := &Server{DB: db}
	for _, kind := range []string{
		meta.SystemMaintenanceKindSourceVerify,
		meta.SystemMaintenanceKindSourceRepair,
	} {
		_, err := server.requestSystemMaintenanceRun(
			context.Background(),
			kind,
			background.InitiatorUser,
			42,
		)
		if !errors.Is(err, errBackgroundTaskControlUnavailable) {
			t.Fatalf("non-admin %s error=%v", kind, err)
		}
	}
}
