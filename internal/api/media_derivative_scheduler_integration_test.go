package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type mediaDerivativeCountingStore struct {
	storage.Store

	mu    sync.Mutex
	puts  map[int]int
	delay time.Duration
}

func (s *mediaDerivativeCountingStore) Put(
	ctx context.Context,
	key string,
	r io.Reader,
) (int64, error) {
	edge := 0
	switch {
	case strings.HasSuffix(
		key,
		fmt.Sprintf("-%d.jpg", mediapkg.DefaultThumbnailEdge),
	):
		edge = mediapkg.DefaultThumbnailEdge
	case strings.HasSuffix(
		key,
		fmt.Sprintf("-%d.jpg", mediapkg.AnalysisPreviewEdge),
	):
		edge = mediapkg.AnalysisPreviewEdge
	}
	if edge != 0 && strings.HasPrefix(key, mediapkg.ThumbnailStoragePrefix) {
		s.mu.Lock()
		if s.puts == nil {
			s.puts = make(map[int]int)
		}
		s.puts[edge]++
		delay := s.delay
		s.mu.Unlock()
		if delay > 0 {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return 0, context.Cause(ctx)
			case <-timer.C:
			}
		}
	}
	return s.Store.Put(ctx, key, r)
}

func (s *mediaDerivativeCountingStore) putCount(edge int) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.puts[edge]
}

func TestMediaDerivativesUseSchedulerSingleflightAndBackpressure(t *testing.T) {
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
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}

	localStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &mediaDerivativeCountingStore{
		Store: localStore,
		delay: 40 * time.Millisecond,
	}
	scheduler := background.NewScheduler(
		context.Background(),
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 1,
			},
		},
	)
	defer scheduler.Close()

	server := &Server{
		DB:                  db,
		Store:               store,
		Auth:                auth.New("media-derivative-scheduler-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      10 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(
		t,
		db,
		router,
		"media-derivative-user",
		"password-media-derivative",
	)
	root := requestNode(
		t,
		router,
		http.MethodGet,
		"/api/v1/nodes/root",
		token,
		nil,
		http.StatusOK,
	)
	file := uploadTestFile(
		t,
		router,
		token,
		root.ID,
		"singleflight.png",
		string(testPNG(t, 16, 12)),
	)
	request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", file.ID),
		token,
		nil,
		http.StatusOK,
	)

	thumbnailPath := fmt.Sprintf(
		"/api/v1/media/items/%d/thumbnail",
		file.ID,
	)
	thumbnailResponses := concurrentMediaDerivativeGET(
		router,
		thumbnailPath,
		token,
		4,
	)
	assertMediaDerivativeResponses(t, thumbnailResponses, http.StatusOK)
	if got := store.putCount(mediapkg.DefaultThumbnailEdge); got != 1 {
		t.Fatalf("thumbnail derivative writes=%d want=1", got)
	}
	if snapshot := scheduler.Snapshot(); snapshot.Deduplicated == 0 {
		t.Fatalf("scheduler did not deduplicate concurrent thumbnail misses: %+v", snapshot)
	}

	analysisPath := fmt.Sprintf(
		"/api/v1/media/items/%d/analysis-preview",
		file.ID,
	)
	analysisResponses := concurrentMediaDerivativeGET(
		router,
		analysisPath,
		token,
		4,
	)
	assertMediaDerivativeResponses(t, analysisResponses, http.StatusOK)
	if got := store.putCount(mediapkg.AnalysisPreviewEdge); got != 1 {
		t.Fatalf("analysis derivative writes=%d want=1", got)
	}

	metricsResponse := request(
		t,
		router,
		http.MethodGet,
		"/metrics",
		"",
		nil,
		http.StatusOK,
	)
	metricsBody := metricsResponse.Body.String()
	for _, expected := range []string{
		`xdrive_background_tasks_total{result="deduplicated"}`,
		`xdrive_background_queue_depth{resource="media_cpu"}`,
		`xdrive_background_running{resource="media_cpu"}`,
	} {
		if !strings.Contains(metricsBody, expected) {
			t.Fatalf("metrics missing %q:\n%s", expected, metricsBody)
		}
	}

	second := uploadTestFile(
		t,
		router,
		token,
		root.ID,
		"backpressure.png",
		string(testPNG(t, 20, 10)),
	)
	runningStarted := make(chan struct{})
	releaseRunning := make(chan struct{})
	running, err := scheduler.Submit(background.Task{
		Key:       "test:media-running",
		Scope:     background.ScopeSystem,
		Trigger:   background.TriggerSystemEvent,
		Initiator: background.InitiatorSystem,
		Priority:  background.PriorityP0,
		Resource:  background.ResourceMediaCPU,
		Run: func(ctx context.Context) error {
			close(runningStarted)
			select {
			case <-ctx.Done():
				return context.Cause(ctx)
			case <-releaseRunning:
				return nil
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-runningStarted

	queued, err := scheduler.Submit(background.Task{
		Key:       "test:media-queued",
		Scope:     background.ScopeSystem,
		Trigger:   background.TriggerSystemEvent,
		Initiator: background.InitiatorSystem,
		Priority:  background.PriorityP4,
		Resource:  background.ResourceMediaCPU,
		Run: func(context.Context) error {
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	before := store.putCount(mediapkg.DefaultThumbnailEdge)
	res := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", second.ID),
		token,
		nil,
		http.StatusServiceUnavailable,
	)
	if got := res.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After=%q want=1", got)
	}
	if after := store.putCount(mediapkg.DefaultThumbnailEdge); after != before {
		t.Fatalf(
			"queue-full request performed synchronous derivative work: before=%d after=%d",
			before,
			after,
		)
	}

	if !scheduler.Cancel(background.Identity{
		Scope: background.ScopeSystem,
		Key:   "test:media-queued",
	}) {
		t.Fatal("failed to cancel queued test task")
	}
	close(releaseRunning)
	if err := running.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := queued.Wait(context.Background()); err == nil {
		t.Fatal("cancelled queued task unexpectedly succeeded")
	}
}

func concurrentMediaDerivativeGET(
	h http.Handler,
	path, token string,
	count int,
) []*httptest.ResponseRecorder {
	out := make([]*httptest.ResponseRecorder, count)
	var wg sync.WaitGroup
	wg.Add(count)
	for i := 0; i < count; i++ {
		i := i
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			res := httptest.NewRecorder()
			h.ServeHTTP(res, req)
			out[i] = res
		}()
	}
	wg.Wait()
	return out
}

func assertMediaDerivativeResponses(
	t *testing.T,
	responses []*httptest.ResponseRecorder,
	status int,
) {
	t.Helper()
	for index, res := range responses {
		if res == nil {
			t.Fatalf("response %d is nil", index)
		}
		if res.Code != status {
			t.Fatalf(
				"response %d status=%d body=%s",
				index,
				res.Code,
				res.Body.String(),
			)
		}
		if res.Header().Get("Content-Type") != "image/jpeg" {
			t.Fatalf(
				"response %d content-type=%q",
				index,
				res.Header().Get("Content-Type"),
			)
		}
	}
}

func resetMediaDerivativeTestSchema(db *gorm.DB) error {
	if err := db.Migrator().DropTable(
		&meta.BackgroundRuntimeCancelIntent{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.PhotoCollectionAsset{},
		&meta.PhotoCollection{},
		&meta.PhotoMetadata{},
		&meta.PhotoResource{},
		&meta.PhotoAsset{},
		&meta.MediaGroupItem{},
		&meta.MediaGroup{},
		&meta.MediaDerivedResource{},
		&meta.MediaMetadata{},
		&meta.SourceCollectionItem{},
		&meta.SourceCollection{},
		&meta.SourceItem{},
		&meta.Source{},
		&meta.AuditEvent{},
		&meta.Share{},
		&meta.UploadPart{},
		&meta.UploadSession{},
		&meta.ContentDigestAlias{},
		&meta.ContentBlob{},
		&meta.FileVersion{},
		&meta.File{},
		&meta.Node{},
		&meta.RefreshToken{},
		&meta.User{},
	); err != nil {
		return err
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.FileVersion{},
		&meta.ContentBlob{},
		&meta.ContentDigestAlias{},
		&meta.Share{},
		&meta.UploadSession{},
		&meta.UploadPart{},
		&meta.AuditEvent{},
		&meta.Source{},
		&meta.SourceItem{},
		&meta.SourceCollection{},
		&meta.SourceCollectionItem{},
		&meta.MediaMetadata{},
		&meta.MediaDerivedResource{},
		&meta.MediaGroup{},
		&meta.MediaGroupItem{},
		&meta.PhotoAsset{},
		&meta.PhotoResource{},
		&meta.PhotoMetadata{},
		&meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{},
		&meta.BackgroundRuntimeCancelIntent{},
	); err != nil {
		return err
	}
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		 ON xd_nodes(owner_id, parent_id, lower(name))
		 WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
	).Error; err != nil {
		return err
	}
	return db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner
		 ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
	).Error
}
