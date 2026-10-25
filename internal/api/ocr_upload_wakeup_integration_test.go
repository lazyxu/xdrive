package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/mediawake"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const autoUploadOCRText = "UNIQUEORCHIDPHOTO847291"

// The model is deliberately controlled: this test proves that a *real HTTP
// upload* reaches the existing media-index event, bounded background scheduler,
// SmartRunner, PostgreSQL OCR evidence and Owner-scoped Gallery API.
// Real PP-OCR/CRNN inference is exercised separately by the pinned-image test.
type autoUploadOCRAnalyzer struct {
	calls   atomic.Int64
	mode    atomic.Int32 // 0=ready, 1=503, 2=deadline, 3=cancellable; test-only
	started chan struct{}
}

func (a *autoUploadOCRAnalyzer) Info(context.Context) (photointelligence.SmartAnalyzerInfo, error) {
	return fixedSmartInfoForHostProbe(), nil
}

func (a *autoUploadOCRAnalyzer) Analyze(
	ctx context.Context,
	task photointelligence.SmartAnalysisTask,
) (photointelligence.SmartAnalysisResult, error) {
	if err := ctx.Err(); err != nil {
		return photointelligence.SmartAnalysisResult{}, err
	}
	if err := photointelligence.ValidateSmartAnalysisTask(task); err != nil {
		return photointelligence.SmartAnalysisResult{}, err
	}
	if !strings.Contains(task.PreviewURL, "/api/v1/media-analysis-preview/") ||
		!strings.Contains(task.PreviewURL, "?ticket=") {
		return photointelligence.SmartAnalysisResult{}, fmt.Errorf("missing Owner-bound analysis preview ticket")
	}
	a.calls.Add(1)
	switch a.mode.Load() {
	case 1:
		return photointelligence.SmartAnalysisResult{}, fmt.Errorf("smart analyzer returned HTTP 503: Authorization=PRIVATE_OCR_MODEL_TOKEN")
	case 2:
		return photointelligence.SmartAnalysisResult{}, fmt.Errorf("model timeout: %w", context.DeadlineExceeded)
	case 3:
		select {
		case a.started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return photointelligence.SmartAnalysisResult{}, ctx.Err()
	}
	return photointelligence.SmartAnalysisResult{
		OCRText: autoUploadOCRText, OCRLanguage: "zh-en",
	}, nil
}

func TestUploadedPhotoAutomaticallyIndexesOCRAndSearchesForOwner(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	// Existing isolated API test schema; do not clear the shared test DB or
	// invent a second media indexer/Worker just for OCR.
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	if err := db.AutoMigrate(
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.ContentDigestAlias{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{},
		&meta.LocalPushQuotaHold{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		// Shared Gallery detail reads use edit recipes. PhotoAsset collection
		// reconciliation also joins Source collections even for local uploads.
		&meta.PhotoEditRecipe{},
		&meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoVisualLabel{}, &meta.PhotoOCRText{},
		&meta.PhotoPlaceLabel{}, &meta.PhotoPerson{},
		&meta.PhotoPersonAsset{}, &meta.AdminPhotoAutoSetting{},
	); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := mediawake.InstallPostgreSQLTrigger(db); err != nil {
		t.Fatal(err)
	}
	// An explicit applied policy admits Smart/OCR and disables unrelated
	// intelligence groups. Model health alone must not override this switch.
	if err := db.Create(&meta.AdminPhotoAutoSetting{
		Name: photoAutoSettingName, AutoEnabled: true,
		KindsJSON: `{"face":false,"smart":true,"semantic":false,"person_cluster":false}`,
		Revision:  1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	listener := mediawake.Listen(ctx, dsn, nil)
	select {
	case <-listener.Ready:
	case <-time.After(5 * time.Second):
		t.Fatal("file commit notification listener did not start")
	}

	scheduler := background.NewScheduler(ctx, background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 1,
			background.ResourceMLCPU:    1,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 32,
			background.ResourceMLCPU:    16,
		},
	})
	defer scheduler.Close()

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	analyzer := &autoUploadOCRAnalyzer{started: make(chan struct{}, 1)}
	server := &Server{
		DB: db, Store: store,
		Auth:                    auth.New("ocr-upload-owner-test-secret", time.Hour),
		RefreshTTL:              24 * time.Hour,
		AllowedOrigin:           "http://localhost",
		MaxUploadBytes:          10 << 20,
		BackgroundScheduler:     scheduler,
		MediaIndexWakeups:       listener.Events,
		PhotoSmartAnalyzer:      analyzer,
		PhotoFacePreviewBaseURL: "http://127.0.0.1:8080",
	}
	server.StartPhotoIntelligence(ctx)
	if policy := server.photoAutoPolicy.Load(); policy == nil ||
		policy.Revision != 1 || !server.photoAutoAllows(
		photoIntelligenceSmartSearch, background.TriggerSystemEvent,
	) {
		t.Fatal("applied automatic Smart/OCR policy was not loaded")
	}
	server.StartMediaIndexer(ctx)
	router := server.Router()

	ownerToken := createTestUser(t, db, router, "ocr-auto-owner", "owner-password")
	foreignToken := createTestUser(t, db, router, "ocr-auto-foreign", "foreign-password")
	root := requestNode(t, router, http.MethodGet,
		"/api/v1/nodes/root", ownerToken, nil, http.StatusOK)

	// Actual owned HTTP file upload and CAS bytes, not a hand-inserted
	// PhotoAsset/AnalysisState. The file name contains no OCR search token.
	file := uploadTestFile(t, router, ownerToken, root.ID,
		"ordinary-wakeup-photo.png", string(testPNG(t, 37, 19)))
	waitForMediaIndexProjection(t, db, file.ID, file.Revision, 10*time.Second)
	waitForAutomaticOCR(t, db, file.ID, 15*time.Second)

	ownerSearch := request(t, router, http.MethodGet,
		"/api/v1/media/items?q="+autoUploadOCRText+"&limit=10",
		ownerToken, nil, http.StatusOK)
	var ownerItems []mediaItemDTO
	if err := json.Unmarshal(ownerSearch.Body.Bytes(), &ownerItems); err != nil {
		t.Fatal(err)
	}
	if len(ownerItems) != 1 || ownerItems[0].Node.ID != file.ID ||
		ownerItems[0].OCR != nil {
		t.Fatalf("Gallery OCR search/list privacy mismatch: %+v", ownerItems)
	}

	detailResponse := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", file.ID),
		ownerToken, nil, http.StatusOK)
	var detail mediaItemDTO
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.OCR == nil || detail.OCR.State != "ready" ||
		detail.OCR.Text != autoUploadOCRText || detail.OCR.Language != "zh-en" {
		t.Fatalf("Owner detail did not expose current OCR: %+v", detail.OCR)
	}
	foreignSearch := request(t, router, http.MethodGet,
		"/api/v1/media/items?q="+autoUploadOCRText+"&limit=10",
		foreignToken, nil, http.StatusOK)
	var foreignItems []mediaItemDTO
	if err := json.Unmarshal(foreignSearch.Body.Bytes(), &foreignItems); err != nil {
		t.Fatal(err)
	}
	if len(foreignItems) != 0 {
		t.Fatalf("other Owner searched private OCR: %+v", foreignItems)
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", file.ID),
		foreignToken, nil, http.StatusNotFound)

	if got := analyzer.calls.Load(); got != 1 {
		t.Fatalf("new uploaded photo analyzed %d times, want exactly once", got)
	}

	var owner meta.User
	if err := db.Where("username = ?", "ocr-auto-owner").Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	// A faulty model still receives a real, newly uploaded PhotoAsset through
	// MediaIndexer + the existing shared Scheduler. Failure is persisted as
	// a nonsecret reason and must never become searchable.
	for _, scenario := range []struct {
		name   string
		mode   int32
		reason string
	}{
		{"HTTP 503", 1, "model_server_error"},
		{"deadline exceeded", 2, "model_timeout"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 10*time.Second)
			analyzer.mode.Store(scenario.mode)
			failedFile := uploadTestFile(t, router, ownerToken, root.ID,
				fmt.Sprintf("ocr-failure-%d.png", scenario.mode),
				string(testPNG(t, 41+int(scenario.mode), 23+int(scenario.mode))))
			waitForMediaIndexProjection(t, db, failedFile.ID, failedFile.Revision, 10*time.Second)
			waitForFailedUploadedOCR(t, db, failedFile.ID, scenario.reason, 15*time.Second)
			waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 10*time.Second)

			failedResponse := request(t, router, http.MethodGet,
				fmt.Sprintf("/api/v1/media/items/%d", failedFile.ID),
				ownerToken, nil, http.StatusOK)
			var failed mediaItemDTO
			if err := json.Unmarshal(failedResponse.Body.Bytes(), &failed); err != nil {
				t.Fatal(err)
			}
			if failed.OCR == nil || failed.OCR.State != "failed" ||
				failed.OCR.Reason != scenario.reason || failed.OCR.Text != "" ||
				strings.Contains(failedResponse.Body.String(), "PRIVATE_OCR_MODEL_TOKEN") {
				t.Fatalf("unsafe Owner OCR failure detail: %+v", failed.OCR)
			}
			beforeResponse := request(t, router, http.MethodGet,
				"/api/v1/media/items?q="+autoUploadOCRText+"&limit=50",
				ownerToken, nil, http.StatusOK)
			var before []mediaItemDTO
			if err := json.Unmarshal(beforeResponse.Body.Bytes(), &before); err != nil {
				t.Fatal(err)
			}
			for _, item := range before {
				if item.Node.ID == failedFile.ID {
					t.Fatalf("failed OCR was searchable: node=%d", failedFile.ID)
				}
			}

			// Owner-initiated reanalysis bypasses the automatic six-hour
			// cooldown via the existing durable intent and invalidation path.
			analyzer.mode.Store(0)
			request(t, router, http.MethodPost, "/api/v1/photo-intelligence/reanalyze",
				ownerToken, strings.NewReader(`{"kinds":["smart_search"]}`),
				http.StatusAccepted)
			waitForRecoveredUploadedOCR(t, db, failedFile.ID, 15*time.Second)
			waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 10*time.Second)
			waitForAutomaticOCR(t, db, failedFile.ID, 5*time.Second)

			var asset meta.PhotoAsset
			if err := db.Where("primary_node_id = ?", failedFile.ID).Take(&asset).Error; err != nil {
				t.Fatal(err)
			}
			var state meta.PhotoAnalysisState
			if err := db.Where("asset_id = ? AND kind = ?",
				asset.ID, meta.PhotoAnalysisKindOCRText).Take(&state).Error; err != nil {
				t.Fatal(err)
			}
			if state.State != meta.PhotoAnalysisStateReady ||
				state.LastError != "" || state.CompletedAt == nil {
				t.Fatalf("manual OCR recovery retained failure: %+v", state)
			}
			afterResponse := request(t, router, http.MethodGet,
				"/api/v1/media/items?q="+autoUploadOCRText+"&limit=50",
				ownerToken, nil, http.StatusOK)
			var after []mediaItemDTO
			if err := json.Unmarshal(afterResponse.Body.Bytes(), &after); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, item := range after {
				if item.Node.ID == failedFile.ID {
					found = true
				}
			}
			if !found {
				t.Fatalf("manual OCR recovery not searchable: node=%d", failedFile.ID)
			}
			request(t, router, http.MethodGet,
				fmt.Sprintf("/api/v1/media/items/%d", failedFile.ID),
				foreignToken, nil, http.StatusNotFound)
		})
	}

	// Cancel a genuinely running OCR task through the same Owner Task Center.
	// A canceled model must not leave the photo's OCR state stuck in RUNNING.
	t.Run("cancel running OCR and recover", func(t *testing.T) {
		waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 10*time.Second)
		analyzer.mode.Store(3)
		cancelFile := uploadTestFile(t, router, ownerToken, root.ID,
			"ocr-cancelled-photo.png", string(testPNG(t, 53, 31)))
		waitForMediaIndexProjection(t, db, cancelFile.ID, cancelFile.Revision, 10*time.Second)
		select {
		case <-analyzer.started:
		case <-time.After(20 * time.Second):
			t.Fatal("cancellable OCR did not start")
		}
		taskID := fmt.Sprintf("runtime:user:%d:photo.smart_search", owner.ID)
		tasksResponse := request(t, router, http.MethodGet,
			"/api/v1/background-tasks?limit=50", ownerToken, nil, http.StatusOK)
		var tasks []backgroundTaskDTO
		if err := json.Unmarshal(tasksResponse.Body.Bytes(), &tasks); err != nil {
			t.Fatal(err)
		}
		task := backgroundTaskByID(tasks, taskID)
		if task == nil || task.Progress.Phase != "photo_ocr_visual" ||
			!backgroundTaskHasControl(tasks, taskID, "cancel") {
			t.Fatalf("Owner OCR task missing cancel control: %+v", task)
		}
		foreignTasksResponse := request(t, router, http.MethodGet,
			"/api/v1/background-tasks?limit=50", foreignToken, nil, http.StatusOK)
		var foreignTasks []backgroundTaskDTO
		if err := json.Unmarshal(foreignTasksResponse.Body.Bytes(), &foreignTasks); err != nil {
			t.Fatal(err)
		}
		if backgroundTaskByID(foreignTasks, taskID) != nil {
			t.Fatal("foreign Owner saw private OCR task")
		}
		cancelJSON := fmt.Sprintf("{\"id\":\"runtime:user:%d:photo.smart_search\",\"action\":\"cancel\"}", owner.ID)
		// A second Owner must not cancel the victim's model task.
		request(t, router, http.MethodPost, "/api/v1/background-tasks/control",
			foreignToken, strings.NewReader(cancelJSON), http.StatusConflict)
		// The admin global Task Center must show exactly this Owner-scoped OCR
		// execution and expose its existing operational cancel control.
		adminToken := createTestUser(t, db, router, "ocr-auto-admin", "admin-password")
		if err := db.Model(&meta.User{}).Where("username = ?", "ocr-auto-admin").
			Update("role", meta.UserRoleAdmin).Error; err != nil {
			t.Fatal(err)
		}
		adminTasksResponse := request(t, router, http.MethodGet,
			"/api/v1/admin/background-tasks?limit=100", adminToken, nil, http.StatusOK)
		var adminTasks []backgroundTaskDTO
		if err := json.Unmarshal(adminTasksResponse.Body.Bytes(), &adminTasks); err != nil {
			t.Fatal(err)
		}
		adminView := backgroundTaskByID(adminTasks, taskID)
		if adminView == nil || adminView.OwnerID != owner.ID ||
			adminView.Kind != "photo.smart_search" ||
			adminView.OwnerUsername != owner.Username ||
			adminView.Progress.Phase != "photo_ocr_visual" ||
			!backgroundTaskHasControl(adminTasks, taskID, "cancel") {
			t.Fatalf("admin global Task Center missing Owner OCR identity/progress/control: %+v", adminView)
		}
		request(t, router, http.MethodPost, "/api/v1/background-tasks/control",
			ownerToken, strings.NewReader(cancelJSON), http.StatusAccepted)
		analyzer.mode.Store(0)
		waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 20*time.Second)
		var asset meta.PhotoAsset
		if err := db.Where("primary_node_id = ?", cancelFile.ID).Take(&asset).Error; err != nil {
			t.Fatal(err)
		}
		for _, kind := range []string{meta.PhotoAnalysisKindOCRText, meta.PhotoAnalysisKindVisualLabel} {
			var state meta.PhotoAnalysisState
			if err := db.Where("asset_id = ? AND kind = ?", asset.ID, kind).
				Take(&state).Error; err != nil {
				t.Fatal(err)
			}
			if state.State != meta.PhotoAnalysisStateStale ||
				state.LastError != "" || state.CompletedAt != nil {
				t.Fatalf("cancel left OCR/visual state active: %+v", state)
			}
		}
		request(t, router, http.MethodPost, "/api/v1/photo-intelligence/reanalyze",
			ownerToken, strings.NewReader("{\"kinds\":[\"smart_search\"]}"), http.StatusAccepted)
		waitForRecoveredUploadedOCR(t, db, cancelFile.ID, 20*time.Second)
		waitForUploadedOCRTaskDrain(t, scheduler, owner.ID, 20*time.Second)
		waitForAutomaticOCR(t, db, cancelFile.ID, 5*time.Second)
	})
}

func waitForAutomaticOCR(t *testing.T, db *gorm.DB, nodeID uint64, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	lastState := "missing"
	for time.Now().Before(deadline) {
		var asset meta.PhotoAsset
		if err := db.Where("primary_node_id = ?", nodeID).Take(&asset).Error; err == nil {
			var state meta.PhotoAnalysisState
			if err := db.Where("asset_id = ? AND kind = ?",
				asset.ID, meta.PhotoAnalysisKindOCRText).Take(&state).Error; err == nil {
				lastState = state.State
				if state.State == meta.PhotoAnalysisStateFailed {
					t.Fatalf("automatic OCR failed: reason=%s", state.LastError)
				}
				if state.State == meta.PhotoAnalysisStateReady {
					var ocr meta.PhotoOCRText
					if err := db.Where("asset_id = ?", asset.ID).Take(&ocr).Error; err == nil {
						var node meta.Node
						var file meta.File
						if err := db.First(&node, "id = ?", nodeID).Error; err != nil {
							t.Fatal(err)
						}
						if err := db.Where("node_id = ?", nodeID).Take(&file).Error; err != nil {
							t.Fatal(err)
						}
						if state.InputFingerprint != mediaOCRInputFingerprint(
							file.SHA256, node.ID, node.Revision,
						) || ocr.Text != autoUploadOCRText || ocr.Language != "zh-en" {
							t.Fatalf("automatic OCR evidence does not match current bytes/revision: state=%+v ocr=%+v", state, ocr)
						}
						return
					}
				}
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("automatic OCR did not reach ready after HTTP upload: node=%d state=%s", nodeID, lastState)
}

func waitForFailedUploadedOCR(t *testing.T, db *gorm.DB, nodeID uint64, reason string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	last := "missing"
	for time.Now().Before(deadline) {
		var asset meta.PhotoAsset
		if err := db.Where("primary_node_id = ?", nodeID).Take(&asset).Error; err == nil {
			var state meta.PhotoAnalysisState
			if err := db.Where("asset_id = ? AND kind = ?",
				asset.ID, meta.PhotoAnalysisKindOCRText).Take(&state).Error; err == nil {
				last = state.State + "/" + state.LastError
				if state.State == meta.PhotoAnalysisStateFailed {
					if state.LastError != reason || state.CompletedAt != nil {
						t.Fatalf("unexpected redacted OCR failure: %+v want=%q", state, reason)
					}
					return
				}
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("OCR model failure not persisted for node=%d: %s", nodeID, last)
}

func waitForRecoveredUploadedOCR(t *testing.T, db *gorm.DB, nodeID uint64, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	last := "missing"
	for time.Now().Before(deadline) {
		var asset meta.PhotoAsset
		if err := db.Where("primary_node_id = ?", nodeID).Take(&asset).Error; err == nil {
			var state meta.PhotoAnalysisState
			if err := db.Where("asset_id = ? AND kind = ?",
				asset.ID, meta.PhotoAnalysisKindOCRText).Take(&state).Error; err == nil {
				last = state.State + "/" + state.LastError
				if state.State == meta.PhotoAnalysisStateReady && state.LastError == "" {
					return
				}
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("manual OCR did not recover node=%d: %s", nodeID, last)
}

func waitForUploadedOCRTaskDrain(t *testing.T, scheduler *background.Scheduler, ownerID uint64, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		active := false
		for _, snapshot := range scheduler.TaskSnapshots(&ownerID) {
			if snapshot.Kind == "photo.smart_search" {
				active = true
				break
			}
		}
		if !active {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("OCR task did not drain: %+v", scheduler.TaskSnapshots(&ownerID))
}
