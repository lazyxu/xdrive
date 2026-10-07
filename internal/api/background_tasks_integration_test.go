package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBackgroundTasksRespectOwnerAndAdminVisibility(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.SyncRun{},
		&meta.FileOperation{},
		&meta.SystemMaintenanceRun{},
		&meta.BackgroundOwnerCancellation{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
	); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 2,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 16,
			},
		},
	)
	t.Cleanup(scheduler.Close)

	server := &Server{
		DB: db, Store: store,
		Auth:                auth.New("background-task-test-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      10 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()

	userAToken := createTestUser(
		t, db, router,
		"background-user-a",
		"password-user-a",
	)
	userBToken := createTestUser(
		t, db, router,
		"background-user-b",
		"password-user-b",
	)
	adminToken := createTestUser(
		t, db, router,
		"background-admin",
		"password-admin",
	)
	if err := db.Model(&meta.User{}).
		Where("username = ?", "background-admin").
		Update("role", meta.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}

	var userA, userB, admin meta.User
	for username, target := range map[string]*meta.User{
		"background-user-a": &userA,
		"background-user-b": &userB,
		"background-admin":  &admin,
	} {
		if err := db.Where("username = ?", username).First(target).Error; err != nil {
			t.Fatal(err)
		}
	}

	sourceA := meta.Source{
		OwnerID:   userA.ID,
		Name:      "Source A",
		Kind:      "test",
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusActive,
		Revision:  1,
	}
	sourceB := sourceA
	sourceB.OwnerID = userB.ID
	sourceB.Name = "Source B"
	if err := db.Create(&sourceA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sourceB).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	runA := meta.SyncRun{
		ID:                     "11111111-1111-4111-8111-111111111111",
		SourceID:               sourceA.ID,
		RunNumber:              1,
		Mode:                   meta.SourceRunModeSync,
		SyncMode:               meta.SourceSyncModeBackup,
		Trigger:                meta.SyncRunTriggerManual,
		Status:                 meta.SyncRunStatusRunning,
		PlannedTransferItems:   10,
		ProcessedTransferItems: 4,
		StartedAt:              now.Add(-time.Minute),
		UpdatedAt:              now,
	}
	runB := runA
	runB.ID = "22222222-2222-4222-8222-222222222222"
	runB.SourceID = sourceB.ID
	runB.Status = meta.SyncRunStatusCompleted
	runB.ProcessedTransferItems = 10
	finished := now
	runB.FinishedAt = &finished
	if err := db.Create(&runA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&runB).Error; err != nil {
		t.Fatal(err)
	}

	opA := meta.FileOperation{
		ID:             "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		OwnerID:        userA.ID,
		Type:           meta.FileOperationTypeCopy,
		Status:         meta.FileOperationStatusRunning,
		ItemsJSON:      "[]",
		TotalItems:     10,
		ProcessedItems: 3,
		CreatedAt:      now.Add(-time.Minute),
		UpdatedAt:      now,
	}
	opB := opA
	opB.ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	opB.OwnerID = userB.ID
	opB.Status = meta.FileOperationStatusFailed
	opB.FailureCode = "internal_error"
	opB.Error = "test failure"
	if err := db.Create(&opA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&opB).Error; err != nil {
		t.Fatal(err)
	}

	reanalyzeIntent := meta.PhotoIntelligenceReanalyzeIntent{
		OwnerID:        userA.ID,
		Kind:           string(photoIntelligenceFace),
		RequestedEpoch: 2,
		AppliedEpoch:   1,
		Trigger:        string(background.TriggerUserAction),
		Initiator:      string(background.InitiatorUser),
		InitiatorID:    userA.ID,
		RequestedAt:    now.Add(-5 * time.Second),
	}
	if err := db.Create(&reanalyzeIntent).Error; err != nil {
		t.Fatal(err)
	}

	janitorFinished := now.Add(-10 * time.Second)
	janitorRun := meta.SystemMaintenanceRun{
		Kind:           meta.SystemMaintenanceKindJanitor,
		Status:         meta.SystemMaintenanceStatusPartial,
		Phase:          meta.SystemMaintenancePhaseFinished,
		CompletedSteps: 3,
		TotalSteps:     4,
		Error:          "content_blob_gc: test failure",
		StartedAt:      now.Add(-30 * time.Second),
		FinishedAt:     &janitorFinished,
	}
	if err := db.Create(&janitorRun).Error; err != nil {
		t.Fatal(err)
	}
	samplerFinished := now.Add(-time.Minute)
	samplerRun := meta.SystemMaintenanceRun{
		Kind:           meta.SystemMaintenanceKindStorageSampler,
		Status:         meta.SystemMaintenanceStatusSuccess,
		Phase:          meta.SystemMaintenancePhaseFinished,
		CompletedSteps: 1,
		TotalSteps:     1,
		StartedAt:      now.Add(-time.Minute - time.Second),
		FinishedAt:     &samplerFinished,
	}
	if err := db.Create(&samplerRun).Error; err != nil {
		t.Fatal(err)
	}

	release := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	submitRuntime := func(ownerID uint64, key string) {
		t.Helper()
		_, err := scheduler.Submit(background.Task{
			Key:       key,
			Kind:      "media.index",
			GroupKey:  "media.index",
			Scope:     background.ScopeUser,
			OwnerID:   ownerID,
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorSystem,
			Priority:  background.PriorityP1,
			Resource:  background.ResourceMediaCPU,
			Run: func(ctx context.Context) error {
				background.ReportProgress(ctx, background.TaskProgress{
					Phase:   "indexing",
					Current: 2,
					Total:   5,
					Unit:    "item",
				})
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
	}
	submitRuntime(userA.ID, "runtime-a")
	submitRuntime(userB.ID, "runtime-b")

	userResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/background-tasks?limit=50",
		userAToken,
		nil,
		http.StatusOK,
	)
	var userTasks []backgroundTaskDTO
	if err := json.Unmarshal(userResponse.Body.Bytes(), &userTasks); err != nil {
		t.Fatal(err)
	}
	if len(userTasks) < 3 {
		t.Fatalf("user tasks=%d want runtime + file operation + sync run: %s", len(userTasks), userResponse.Body.String())
	}
	for _, task := range userTasks {
		if task.OwnerID != userA.ID {
			t.Fatalf("user saw foreign task: %+v", task)
		}
		if task.OwnerUsername != "" {
			t.Fatalf("user task unexpectedly included admin-only owner username: %+v", task)
		}
	}
	if backgroundTaskByID(
		userTasks,
		"system-maintenance:"+meta.SystemMaintenanceKindJanitor,
	) != nil {
		t.Fatal("ordinary user unexpectedly saw system maintenance")
	}
	if !backgroundTaskHasControl(userTasks, "file-operation:"+opA.ID, "cancel") {
		t.Fatal("owner file operation did not expose cancel")
	}
	if !backgroundTaskHasControl(userTasks, "sync-run:"+runA.ID, "cancel") {
		t.Fatal("owner sync run did not expose cancel")
	}
	runtimeAID := fmt.Sprintf("runtime:user:%d:media.index", userA.ID)
	if !backgroundTaskHasControl(userTasks, runtimeAID, "cancel") {
		t.Fatal("owner runtime scheduler task did not expose cancel")
	}
	reanalyzeTaskID := fmt.Sprintf(
		"runtime:user:%d:photo.face",
		userA.ID,
	)
	reanalyzeTask := backgroundTaskByID(userTasks, reanalyzeTaskID)
	if reanalyzeTask == nil ||
		reanalyzeTask.State != "queued" ||
		reanalyzeTask.Progress.Phase != photoIntelligencePhaseReanalyzeQueued ||
		reanalyzeTask.Priority == nil ||
		*reanalyzeTask.Priority != uint8(background.PriorityP2) ||
		reanalyzeTask.Resource != string(background.ResourceMLCPU) ||
		!backgroundTaskHasControl(userTasks, reanalyzeTaskID, "cancel") ||
		!backgroundTaskHasControl(userTasks, reanalyzeTaskID, "reanalyze") {
		t.Fatalf("unexpected durable reanalyze task: %+v", reanalyzeTask)
	}
	syncTask := backgroundTaskByID(userTasks, "sync-run:"+runA.ID)
	if syncTask == nil {
		t.Fatal("owner sync run task is missing")
	}
	if syncTask.Priority == nil ||
		*syncTask.Priority != uint8(background.PriorityP0) ||
		syncTask.Resource != string(background.ResourceNetwork) {
		t.Fatalf("sync run scheduling metadata=%+v want P0/network", syncTask)
	}

	summaryResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/background-tasks/active-summary",
		userAToken,
		nil,
		http.StatusOK,
	)
	var summary backgroundTaskActiveSummaryDTO
	if err := json.Unmarshal(summaryResponse.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.FileOperation != 1 ||
		summary.SyncRun != 1 ||
		summary.Scheduler != 2 ||
		summary.ActiveTotal != 4 {
		t.Fatalf("active summary=%+v want file=1 sync=1 scheduler=2 total=4", summary)
	}

	request(
		t,
		router,
		http.MethodGet,
		"/api/v1/admin/background-tasks",
		userAToken,
		nil,
		http.StatusForbidden,
	)

	adminResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/admin/background-tasks?limit=100",
		adminToken,
		nil,
		http.StatusOK,
	)
	var adminTasks []backgroundTaskDTO
	if err := json.Unmarshal(adminResponse.Body.Bytes(), &adminTasks); err != nil {
		t.Fatal(err)
	}
	seenA, seenB := false, false
	for _, task := range adminTasks {
		if task.OwnerID == userA.ID {
			seenA = true
		}
		if task.OwnerID == userB.ID {
			seenB = true
			if task.OwnerUsername != userB.Username {
				t.Fatalf("admin task owner username=%q want=%q: %+v", task.OwnerUsername, userB.Username, task)
			}
			if len(task.ControlActions) != 0 {
				t.Fatalf("admin unexpectedly received cross-user controls: %+v", task)
			}
		}
	}
	if !seenA || !seenB {
		t.Fatalf("admin visibility missing owners: seenA=%v seenB=%v tasks=%+v", seenA, seenB, adminTasks)
	}
	janitorTask := backgroundTaskByID(
		adminTasks,
		"system-maintenance:"+meta.SystemMaintenanceKindJanitor,
	)
	if janitorTask == nil {
		t.Fatalf("admin global tasks missing Janitor: %+v", adminTasks)
	}
	if janitorTask.Domain != "system_maintenance" ||
		janitorTask.Scope != string(background.ScopeSystem) ||
		janitorTask.State != "partial" ||
		janitorTask.Resource != string(background.ResourceMaintenanceIO) ||
		janitorTask.Priority == nil ||
		*janitorTask.Priority != uint8(background.PriorityP4) ||
		janitorTask.Progress.Phase != meta.SystemMaintenancePhaseFinished ||
		janitorTask.Progress.Current != 3 ||
		janitorTask.Progress.Total != 4 ||
		len(janitorTask.ControlActions) != 0 {
		t.Fatalf("unexpected Janitor task projection: %+v", janitorTask)
	}
	samplerTask := backgroundTaskByID(
		adminTasks,
		"system-maintenance:"+meta.SystemMaintenanceKindStorageSampler,
	)
	if samplerTask == nil || samplerTask.State != "completed" {
		t.Fatalf("unexpected Storage sampler task projection: %+v", samplerTask)
	}

	userBResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/background-tasks?limit=50",
		userBToken,
		nil,
		http.StatusOK,
	)
	var userBTasks []backgroundTaskDTO
	if err := json.Unmarshal(userBResponse.Body.Bytes(), &userBTasks); err != nil {
		t.Fatal(err)
	}
	if !backgroundTaskHasControl(userBTasks, "file-operation:"+opB.ID, "retry") {
		t.Fatal("failed owner file operation did not expose retry")
	}

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userBToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"file-operation:%s","action":"cancel"}`,
			opA.ID,
		)),
		http.StatusNotFound,
	)
	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/admin/background-tasks/control",
		adminToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"file-operation:%s","action":"cancel"}`,
			opA.ID,
		)),
		http.StatusConflict,
	)
	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userAToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"file-operation:%s","action":"cancel"}`,
			opA.ID,
		)),
		http.StatusAccepted,
	)
	var cancelledOperation meta.FileOperation
	if err := db.Where("id = ?", opA.ID).First(&cancelledOperation).Error; err != nil {
		t.Fatal(err)
	}
	if cancelledOperation.Status != meta.FileOperationStatusCancelRequested {
		t.Fatalf("controlled file operation status=%q want cancel_requested", cancelledOperation.Status)
	}

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userAToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"sync-run:%s","action":"cancel"}`,
			runA.ID,
		)),
		http.StatusAccepted,
	)
	var cancelledRun meta.SyncRun
	if err := db.Where("id = ?", runA.ID).First(&cancelledRun).Error; err != nil {
		t.Fatal(err)
	}
	if cancelledRun.CancelRequestedAt == nil {
		t.Fatal("controlled sync run did not persist cancel_requested_at")
	}

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userBToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"runtime:user:%d:media.index","action":"cancel"}`,
			userA.ID,
		)),
		http.StatusConflict,
	)
	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userAToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"runtime:user:%d:media.index","action":"cancel"}`,
			userA.ID,
		)),
		http.StatusAccepted,
	)

	deadline := time.Now().Add(time.Second)
	for {
		userASnapshots := scheduler.TaskSnapshots(&userA.ID)
		activeMediaIndex := false
		for _, snapshot := range userASnapshots {
			if snapshot.Kind == "media.index" {
				activeMediaIndex = true
				break
			}
		}
		if !activeMediaIndex {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cancelled runtime task did not drain: %+v", userASnapshots)
		}
		time.Sleep(time.Millisecond)
	}
	userBSnapshots := scheduler.TaskSnapshots(&userB.ID)
	if len(userBSnapshots) == 0 {
		t.Fatal("cancelling user A runtime task also cancelled user B work")
	}
	cancelledTasksResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/background-tasks?limit=50",
		userAToken,
		nil,
		http.StatusOK,
	)
	var cancelledTasks []backgroundTaskDTO
	if err := json.Unmarshal(
		cancelledTasksResponse.Body.Bytes(),
		&cancelledTasks,
	); err != nil {
		t.Fatal(err)
	}
	cancelledMediaTask := backgroundTaskByID(cancelledTasks, runtimeAID)
	if cancelledMediaTask == nil ||
		cancelledMediaTask.State != "cancelled" ||
		len(cancelledMediaTask.ControlActions) != 0 {
		t.Fatalf("durable cancelled runtime task=%+v", cancelledMediaTask)
	}
	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userAToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"runtime:user:%d:media.index","action":"cancel"}`,
			userA.ID,
		)),
		http.StatusConflict,
	)

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userAToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"%s","action":"cancel"}`,
			reanalyzeTaskID,
		)),
		http.StatusAccepted,
	)
	var cancelledIntent meta.PhotoIntelligenceReanalyzeIntent
	if err := db.Where(
		"owner_id = ? AND kind = ?",
		userA.ID,
		string(photoIntelligenceFace),
	).First(&cancelledIntent).Error; err != nil {
		t.Fatal(err)
	}
	if cancelledIntent.CancelledEpoch != cancelledIntent.RequestedEpoch {
		t.Fatalf(
			"cancelled durable reanalyze intent was not fenced: %+v",
			cancelledIntent,
		)
	}
	if cancelledIntent.AppliedEpoch >= cancelledIntent.RequestedEpoch {
		t.Fatalf(
			"cancelled durable reanalyze intent was falsely marked applied: %+v",
			cancelledIntent,
		)
	}

	_ = admin
}

func backgroundTaskByID(tasks []backgroundTaskDTO, id string) *backgroundTaskDTO {
	for index := range tasks {
		if tasks[index].ID == id {
			return &tasks[index]
		}
	}
	return nil
}

func backgroundTaskHasControl(
	tasks []backgroundTaskDTO,
	id, action string,
) bool {
	for _, task := range tasks {
		if task.ID != id {
			continue
		}
		for _, control := range task.ControlActions {
			if control == action {
				return true
			}
		}
	}
	return false
}

func TestBackgroundFileOperationControlActionsIncludeUndoRedo(t *testing.T) {
	viewerID := uint64(42)
	undoable := meta.FileOperation{
		OwnerID:      viewerID,
		Type:         meta.FileOperationTypeCopy,
		Status:       meta.FileOperationStatusCompleted,
		UndoPlanJSON: `{"kind":"copy","copy_roots":[{"root":{"id":1,"revision":1},"name":"x","nodes":[{"id":1,"revision":1}]}]}`,
	}
	actions := backgroundFileOperationControlActions(undoable, viewerID, false)
	if !backgroundTaskActionAllowed(actions, backgroundTaskActionUndo) {
		t.Fatalf("undoable actions=%v missing undo", actions)
	}

	undoOf := "original"
	redoable := meta.FileOperation{
		OwnerID:      viewerID,
		Type:         meta.FileOperationTypeUndo,
		Status:       meta.FileOperationStatusCompleted,
		UndoOfID:     &undoOf,
		RedoPlanJSON: `{"kind":"copy","copy_roots":[{"root":{"id":1,"revision":2},"parent_id":2,"name":"x","nodes":[{"id":1,"revision":2}]}]}`,
	}
	actions = backgroundFileOperationControlActions(redoable, viewerID, false)
	if !backgroundTaskActionAllowed(actions, backgroundTaskActionRedo) {
		t.Fatalf("redoable actions=%v missing redo", actions)
	}
}
