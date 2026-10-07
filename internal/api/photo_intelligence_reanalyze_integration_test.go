package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoIntelligenceReanalyzeUserAndAdminControls(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	db := openPhotoIntelligenceAPITestDB(t, dsn)
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
				background.ResourceMLCPU:         1,
				background.ResourceBackgroundCPU: 2,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMLCPU:         8,
				background.ResourceBackgroundCPU: 8,
			},
		},
	)
	t.Cleanup(scheduler.Close)

	faceRelease := make(chan struct{})
	face := &fakePhotoFaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   faceRelease,
		processed: 0,
	}
	place := &fakePhotoPlaceOwnerRunner{processed: 0}
	person := &fakePhotoPersonOwnerRunner{}
	server := &Server{
		DB: db, Store: store,
		Auth:                    auth.New("photo-reanalysis-test-secret", time.Hour),
		RefreshTTL:              24 * time.Hour,
		AllowedOrigin:           "http://localhost",
		MaxUploadBytes:          10 << 20,
		BackgroundScheduler:     scheduler,
		photoFaceRunner:         face,
		photoPlaceRunner:        place,
		photoPersonRunner:       person,
		photoIntelligenceOwners: make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState),
	}
	router := server.Router()

	userToken := createTestUser(
		t, db, router,
		"photo-reanalysis-user",
		"password-user",
	)
	adminToken := createTestUser(
		t, db, router,
		"photo-reanalysis-admin",
		"password-admin",
	)
	if err := db.Model(&meta.User{}).
		Where("username = ?", "photo-reanalysis-admin").
		Update("role", meta.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}

	var user meta.User
	if err := db.Where("username = ?", "photo-reanalysis-user").
		First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where(
		"owner_id = ? AND parent_id IS NULL",
		user.ID,
	).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       user.ID,
		PrimaryNodeID: root.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "reanalysis:" + uuid.NewString(),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	states := []meta.PhotoAnalysisState{
		{
			AssetID:          asset.ID,
			Kind:             meta.PhotoAnalysisKindFaceDetection,
			AnalyzerVersion:  "detector-v1",
			InputFingerprint: "face-input",
			State:            meta.PhotoAnalysisStateReady,
			CompletedAt:      &now,
		},
		{
			AssetID:          asset.ID,
			Kind:             meta.PhotoAnalysisKindFaceEmbedding,
			AnalyzerVersion:  "embedding-v1",
			InputFingerprint: "face-input",
			State:            meta.PhotoAnalysisStateReady,
			CompletedAt:      &now,
		},
		{
			AssetID:          asset.ID,
			Kind:             meta.PhotoAnalysisKindPlaceLabel,
			AnalyzerVersion:  "place-v1",
			InputFingerprint: "place-input",
			State:            meta.PhotoAnalysisStateReady,
			CompletedAt:      &now,
		},
	}
	if err := db.Create(&states).Error; err != nil {
		t.Fatal(err)
	}
	clusterState := meta.PhotoPersonClusterState{
		OwnerID:          user.ID,
		AnalyzerVersion:  "cluster-v1",
		InputFingerprint: "cluster-input",
		State:            meta.PhotoAnalysisStateReady,
		CompletedAt:      &now,
	}
	if err := db.Create(&clusterState).Error; err != nil {
		t.Fatal(err)
	}

	response := request(
		t,
		router,
		http.MethodPost,
		"/api/v1/photo-intelligence/reanalyze",
		userToken,
		strings.NewReader(`{"kinds":["face"]}`),
		http.StatusAccepted,
	)
	var accepted photoIntelligenceReanalyzeResponse
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.OwnerID != user.ID ||
		len(accepted.Accepted) != 1 ||
		accepted.Accepted[0] != "face" {
		t.Fatalf("accepted=%+v", accepted)
	}

	select {
	case ownerID := <-face.started:
		if ownerID != user.ID {
			t.Fatalf("face owner=%d want=%d", ownerID, user.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("manual face reanalysis did not start")
	}
	var faceIntent meta.PhotoIntelligenceReanalyzeIntent
	if err := db.Where(
		"owner_id = ? AND kind = ?",
		user.ID,
		string(photoIntelligenceFace),
	).First(&faceIntent).Error; err != nil {
		t.Fatal(err)
	}
	if faceIntent.RequestedEpoch != 1 ||
		faceIntent.AppliedEpoch != 1 ||
		faceIntent.AppliedAt == nil {
		t.Fatalf("face reanalyze intent was not durably applied: %+v", faceIntent)
	}
	waitForPhotoAnalysisState(
		t,
		db,
		asset.ID,
		meta.PhotoAnalysisKindFaceDetection,
		meta.PhotoAnalysisStateStale,
	)
	waitForPhotoAnalysisState(
		t,
		db,
		asset.ID,
		meta.PhotoAnalysisKindFaceEmbedding,
		meta.PhotoAnalysisStateStale,
	)

	tasksResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/background-tasks",
		userToken,
		nil,
		http.StatusOK,
	)
	var tasks []backgroundTaskDTO
	if err := json.Unmarshal(tasksResponse.Body.Bytes(), &tasks); err != nil {
		t.Fatal(err)
	}
	if !backgroundTaskKindHasControl(tasks, "photo.face", "reanalyze") {
		t.Fatalf("user photo.face task missing reanalyze capability: %+v", tasks)
	}

	adminTasksResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/admin/background-tasks",
		adminToken,
		nil,
		http.StatusOK,
	)
	var adminTasks []backgroundTaskDTO
	if err := json.Unmarshal(adminTasksResponse.Body.Bytes(), &adminTasks); err != nil {
		t.Fatal(err)
	}
	if !backgroundTaskKindHasControl(adminTasks, "photo.face", "reanalyze") {
		t.Fatalf("admin photo.face task missing reanalyze capability: %+v", adminTasks)
	}

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/background-tasks/control",
		userToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"runtime:user:%d:photo.face","action":"reanalyze"}`,
			user.ID,
		)),
		http.StatusAccepted,
	)

	close(faceRelease)
	waitForPhotoFaceOwnerStart(t, face.started, user.ID, "user background control")
	waitForNoOwnerPhotoIntelligenceTasks(t, scheduler, user.ID)

	request(
		t,
		router,
		http.MethodPost,
		"/api/v1/admin/background-tasks/control",
		adminToken,
		strings.NewReader(fmt.Sprintf(
			`{"id":"runtime:user:%d:photo.face","action":"reanalyze"}`,
			user.ID,
		)),
		http.StatusAccepted,
	)
	waitForPhotoFaceOwnerStart(t, face.started, user.ID, "admin background control")
	waitForNoOwnerPhotoIntelligenceTasks(t, scheduler, user.ID)

	request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf(
			"/api/v1/admin/users/%d/photo-intelligence/reanalyze",
			user.ID,
		),
		userToken,
		strings.NewReader(`{"kinds":["place"]}`),
		http.StatusForbidden,
	)
	request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf(
			"/api/v1/admin/users/%d/photo-intelligence/reanalyze",
			user.ID,
		),
		adminToken,
		strings.NewReader(`{"kinds":["place","person_cluster"]}`),
		http.StatusAccepted,
	)
	waitForPhotoAnalysisState(
		t,
		db,
		asset.ID,
		meta.PhotoAnalysisKindPlaceLabel,
		meta.PhotoAnalysisStateStale,
	)
	waitForPersonClusterState(
		t,
		db,
		user.ID,
		meta.PhotoAnalysisStateStale,
	)
}

func openPhotoIntelligenceAPITestDB(
	t *testing.T,
	dsn string,
) *gorm.DB {
	t.Helper()
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_api_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.AuditEvent{},
		&meta.PhotoAsset{},
		&meta.PhotoAnalysisState{},
		&meta.PhotoPersonClusterState{},
		&meta.BackgroundOwnerCancellation{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.FileOperation{},
		&meta.ArchivePrepareRun{},
		&meta.Source{},
		&meta.SyncRun{},
		&meta.SystemMaintenanceRun{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func waitForPhotoAnalysisState(
	t *testing.T,
	db *gorm.DB,
	assetID uint64,
	kind, want string,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var row meta.PhotoAnalysisState
		err := db.Where(
			"asset_id = ? AND kind = ?",
			assetID,
			kind,
		).First(&row).Error
		if err == nil && row.State == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	var row meta.PhotoAnalysisState
	_ = db.Where(
		"asset_id = ? AND kind = ?",
		assetID,
		kind,
	).First(&row).Error
	t.Fatalf(
		"analysis state asset=%d kind=%s got=%q want=%q",
		assetID,
		kind,
		row.State,
		want,
	)
}

func waitForPersonClusterState(
	t *testing.T,
	db *gorm.DB,
	ownerID uint64,
	want string,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var row meta.PhotoPersonClusterState
		err := db.First(&row, "owner_id = ?", ownerID).Error
		if err == nil && row.State == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	var row meta.PhotoPersonClusterState
	_ = db.First(&row, "owner_id = ?", ownerID).Error
	t.Fatalf(
		"person cluster state owner=%d got=%q want=%q",
		ownerID,
		row.State,
		want,
	)
}

func waitForPhotoFaceOwnerStart(
	t *testing.T,
	started <-chan uint64,
	ownerID uint64,
	label string,
) {
	t.Helper()
	select {
	case got := <-started:
		if got != ownerID {
			t.Fatalf("%s face owner=%d want=%d", label, got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatalf("%s face reanalysis did not start", label)
	}
}

func waitForNoOwnerPhotoIntelligenceTasks(
	t *testing.T,
	scheduler *background.Scheduler,
	ownerID uint64,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshots := scheduler.TaskSnapshots(&ownerID)
		active := false
		for _, snapshot := range snapshots {
			if strings.HasPrefix(snapshot.Kind, "photo.") {
				active = true
				break
			}
		}
		if !active {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf(
		"photo intelligence tasks did not drain: %+v",
		scheduler.TaskSnapshots(&ownerID),
	)
}

func backgroundTaskKindHasControl(
	tasks []backgroundTaskDTO,
	kind, action string,
) bool {
	for _, task := range tasks {
		if task.Kind != kind {
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
