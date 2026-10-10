package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestGalleryThumbnailRequestContextCancellation100K measures real client abort ->
// net/http Request.Context -> GORM -> PostgreSQL lock-wait interruption.
// Six real thumbnail ownership requests sample 100k PhotoAssets and 115k media nodes.
func TestGalleryThumbnailRequestContextCancellation100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_THUMBNAIL_GO_CONTEXT_CANCEL_100K_PERF") != "1" {
		t.Skip("enable XD_GALLERY_THUMBNAIL_GO_CONTEXT_CANCEL_100K_PERF=1 for native PostgreSQL cancel measurement")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := background.NewScheduler(context.Background(), background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 2,
		},
	})
	defer scheduler.Close()
	app := &Server{
		DB: db, Store: store,
		Auth:                auth.New("gallery-go-context-perf-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      16 << 20,
		BackgroundScheduler: scheduler,
	}
	router := app.Router()
	token := createTestUser(t, db, router, "gallery-go-cancel-perf", "password-gallery-go-cancel")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"100k HTTP Cancellation"}`), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, ownerRoot.OwnerID, folder.ID)
	// Pick two image, two video-poster, and two genuine paired Live still nodes
	// before taking the diagnostic lock; only real HTTP/SQL is timed.
	var thumbnailNodes []meta.Node
	for _, pattern := range []string{"photo-%", "video-%", "live-still-%"} {
		var chosen []meta.Node
		if err := db.Where("owner_id = ? AND parent_id = ? AND name LIKE ?",
			ownerRoot.OwnerID, folder.ID, pattern).
			Order("id").Limit(2).Find(&chosen).Error; err != nil {
			t.Fatal(err)
		}
		if len(chosen) != 2 {
			t.Fatalf("sample count for %s = %d; want two", pattern, len(chosen))
		}
		thumbnailNodes = append(thumbnailNodes, chosen...)
	}
	if len(thumbnailNodes) != 6 {
		t.Fatalf("real thumbnail sample count = %d; want six", len(thumbnailNodes))
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000

	const numRequests = 6
	const observation = 160 * time.Millisecond
	var activeHandlers, contextDone, clientResponseBytes atomic.Int64
	var cancelAt atomic.Int64
	contextLatencyMS := make(chan float64, numRequests)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/media/items/") && strings.HasSuffix(r.URL.Path, "/thumbnail") {
			activeHandlers.Add(1)
			defer activeHandlers.Add(-1)
			go func(ctx context.Context) {
				<-ctx.Done()
				contextDone.Add(1)
				if canceled := cancelAt.Load(); canceled != 0 {
					delta := time.Since(time.Unix(0, canceled))
					contextLatencyMS <- float64(delta.Microseconds()) / 1000
				}
			}(r.Context())
		}
		router.ServeHTTP(w, r)
	})
	httpServer := httptest.NewServer(handler)
	defer httpServer.Close()
	client := &http.Client{
		Timeout: 12 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			MaxConnsPerHost:   numRequests + 2,
		},
	}
	defer client.CloseIdleConnections()

	// Force production ownedThumbnailNode to wait on xd_nodes in actual PostgreSQL.
	// This is not a mocked sleeping handler or a media decoder test.
	lockTx := db.Begin()
	if lockTx.Error != nil {
		t.Fatal(lockTx.Error)
	}
	defer func() { _ = lockTx.Rollback().Error }()
	if err := lockTx.Exec("LOCK TABLE xd_nodes IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}
	cancels := make([]context.CancelFunc, 0, numRequests)
	outcomes := make(chan error, numRequests)
	for i := 0; i < numRequests; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		url := fmt.Sprintf("%s/api/v1/media/items/%d/thumbnail?revision=1",
			httpServer.URL, thumbnailNodes[i].ID)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		go func() {
			resp, requestErr := client.Do(req)
			if requestErr != nil {
				outcomes <- requestErr
				return
			}
			defer resp.Body.Close()
			body, readErr := io.ReadAll(resp.Body)
			clientResponseBytes.Add(int64(len(body)))
			if readErr != nil {
				outcomes <- readErr
				return
			}
			outcomes <- fmt.Errorf("unexpected completed request status=%d bytes=%d", resp.StatusCode, len(body))
		}()
	}
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()

	// Assert all six reached PostgreSQL and are really lock-blocked before
	// issuing the cancellation. Querying pg_stat_activity does not acquire
	// locks on our application tables.
	pgWaiting := func() (int64, error) {
		var waiters int64
		err := db.Raw(
			"SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() " +
				"AND state = 'active' AND wait_event_type = 'Lock' " +
				"AND query LIKE '%xd_nodes%'",
		).Scan(&waiters).Error
		return waiters, err
	}
	var beforeWaiters int64
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		beforeWaiters, err = pgWaiting()
		if err != nil {
			t.Fatal(err)
		}
		if beforeWaiters >= numRequests && activeHandlers.Load() == numRequests {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if beforeWaiters < numRequests || activeHandlers.Load() != numRequests {
		t.Fatalf("six actual SQL lock waits not established: waiters=%d handlers=%d",
			beforeWaiters, activeHandlers.Load())
	}

	cancelAt.Store(time.Now().UnixNano())
	for _, cancel := range cancels {
		cancel()
	}
	time.Sleep(observation)
	afterWaiters, err := pgWaiting()
	if err != nil {
		t.Fatal(err)
	}
	afterActive := activeHandlers.Load()
	afterDone := contextDone.Load()
	afterBytes := clientResponseBytes.Load()
	for i := 0; i < numRequests; i++ {
		select {
		case clientErr := <-outcomes:
			if !errors.Is(clientErr, context.Canceled) {
				t.Fatalf("canceled HTTP request unexpectedly finished: %v", clientErr)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("canceled HTTP client did not return")
		}
	}
	var latencies []float64
	for len(contextLatencyMS) > 0 {
		latencies = append(latencies, <-contextLatencyMS)
	}
	sort.Float64s(latencies)
	maxContextLatencyMS := 0.0
	if len(latencies) > 0 {
		maxContextLatencyMS = latencies[len(latencies)-1]
	}
	result := map[string]any{
		"workload":                       "gallery-thumbnail-http-go-context-cancel-100k",
		"logical_assets":                 100000,
		"physical_media_nodes":           115000,
		"live_photo_groups":              15000,
		"requested_thumbnail_nodes":      len(thumbnailNodes),
		"thumbnail_shapes":               "2 photos / 2 videos / 2 paired live stills",
		"seed_ms":                        seedMS,
		"started_sql_waits":              beforeWaiters,
		"requests":                       numRequests,
		"context_done_at_160ms":          afterDone,
		"handler_active_at_160ms":        afterActive,
		"postgres_lock_waiters_at_160ms": afterWaiters,
		"client_payload_bytes_at_160ms":  afterBytes,
		"server_context_latency_ms":      latencies,
		"max_server_context_done_ms":     maxContextLatencyMS,
		"observation_ms":                 observation.Milliseconds(),
		"scope":                          "authenticated Gin thumbnail ownership SQL cancel on 100k mixed photo/video/paired Live assets; no actual decoding, derivative-worker termination, Desktop IPC, WAN or browser paint",
	}
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_THUMBNAIL_GO_CONTEXT_CANCEL_100K %s", payload)
	if afterDone != numRequests || afterActive != 0 ||
		afterWaiters != 0 || afterBytes != 0 ||
		len(latencies) != numRequests ||
		maxContextLatencyMS > float64(observation.Milliseconds()) {
		t.Fatalf("canceled Gallery thumbnail lookup retained active HTTP/PG work after %s: %+v", observation, result)
	}

	// A new request should continue to work normally after the canceled
	// workload and the held diagnostic table lock have been released.
	if err := lockTx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	healthy, err := http.NewRequest(http.MethodGet,
		httpServer.URL+"/api/v1/media/items?range=true&limit=100&offset=0", nil)
	if err != nil {
		t.Fatal(err)
	}
	healthy.Header.Set("Authorization", "Bearer "+token)
	res, err := client.Do(healthy)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("new Gallery query after cancel: status=%d body=%s", res.StatusCode, string(body))
	}
	var page mediaItemRangeDTO
	if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != mediaGalleryFirstOpenLogicalCount || len(page.Items) != 100 {
		t.Fatalf("post-cancel Gallery data corrupted: total=%d returned=%d",
			page.TotalCount, len(page.Items))
	}
}
