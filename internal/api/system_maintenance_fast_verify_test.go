package api

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestStorageFastVerifyMaintenanceHasIndependentRealTaskAndScope(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	scheduler, ctx := newSystemMaintenanceTaskScheduler(t)
	runner := &immediateSystemMaintenanceStorageVerifyRunner{
		report: maintenance.VerifyReport{
			Mode: maintenance.VerifyModeFast,
			ReferencedFiles: 3, ReferencedVersions: 1, BlobFiles: 2,
		},
	}
	server := &Server{
		DB: db,
		BackgroundScheduler: scheduler,
		systemMaintenanceStorageVerify: runner,
		systemMaintenanceHeartbeat: 20 * time.Millisecond,
	}
	run, err := server.requestSystemMaintenanceRun(
		ctx, meta.SystemMaintenanceKindStorageVerifyFast, background.InitiatorAdmin, 99,
	)
	if err != nil {
		t.Fatal(err)
	}
	result := waitSystemMaintenanceRunStatus(t, db, run.ID, meta.SystemMaintenanceStatusSuccess)
	if runner.calls.Load() != 1 || !strings.Contains(result.Summary, "校验模式 fast") ||
		!strings.Contains(result.Summary, "SHA-256 0 个对象 / 0 bytes") {
		t.Fatalf("fast verification reported incorrect coverage: %+v", result)
	}
	tasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	task := backgroundTaskByID(tasks, systemMaintenanceTaskCenterID(meta.SystemMaintenanceKindStorageVerifyFast))
	if task == nil || task.State != "completed" ||
		!backgroundTaskActionAllowed(task.ControlActions, backgroundTaskActionRun) {
		t.Fatalf("fast verification Task Center capability: %+v", task)
	}
}

func TestStorageFastVerifyDoesNotAcceptUnattestedRunnerMode(t *testing.T) {
	server := &Server{systemMaintenanceStorageVerify: &immediateSystemMaintenanceStorageVerifyRunner{
		report: maintenance.VerifyReport{Mode: maintenance.VerifyModeDeep},
	}}
	_, err := server.verifyStorageForSystemMaintenanceMode(context.Background(),
		maintenance.VerifyModeFast)
	if err == nil || !strings.Contains(err.Error(), "attest fast mode") {
		t.Fatalf("incorrect fast mode accepted: %v", err)
	}
	_, err = server.verifyStorageForSystemMaintenanceMode(context.Background(),
		maintenance.VerifyMode("unknown"))
	if err == nil {
		t.Fatal("invalid storage verifier mode accepted")
	}
}
