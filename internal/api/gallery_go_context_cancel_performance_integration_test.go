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
	"strconv"
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

const (
	galleryGoContextCancelRequests = 6
	galleryGoContextCancelRounds   = 3
	galleryGoContextObservation    = 160 * time.Millisecond
	galleryGoContextMaxDrain       = 500 * time.Millisecond
)

type galleryGoContextCancelState struct {
	active    atomic.Int64
	done      atomic.Int64
	cancelAt  atomic.Int64
	latencies chan float64
}

type galleryGoContextCancelSample struct {
	Round             int       `json:"round"`
	WaitersBefore     int64     `json:"postgres_waiters_before"`
	WaitersAt160MS    int64     `json:"postgres_waiters_at_160_ms"`
	ActiveAt160MS     int64     `json:"handlers_active_at_160_ms"`
	DoneAt160MS       int64     `json:"server_contexts_done_at_160_ms"`
	DoneAt500MS       int64     `json:"server_contexts_done_at_500_ms"`
	WaitersAt500MS    int64     `json:"postgres_waiters_at_500_ms"`
	ActiveAt500MS     int64     `json:"handlers_active_at_500_ms"`
	PayloadBytes      int64     `json:"client_response_bytes"`
	MaxContextDoneMS  float64   `json:"max_server_context_done_ms"`
	AbortLatenciesMS  []float64 `json:"server_context_done_samples_ms"`
}

// TestGalleryGoContextCancellationPerformance100K exercises actual
// authenticated HTTP -> Gin Request.Context -> GORM -> native PostgreSQL.
// The 100k logical / 115k physical media namespace includes 15k Live pairs.
func TestGalleryGoContextCancellationPerformance100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_GO_CONTEXT_CANCEL_PERF") != "1" {
		t.Skip("set XD_GALLERY_GO_CONTEXT_CANCEL_PERF=1 to measure native Gallery cancellation")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not set")
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
		Auth: auth.New("gallery-go-context-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour,
		AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20,
		BackgroundScheduler: scheduler,
	}
	router := app.Router()
	token := createTestUser(t, db, router, "gallery-go-context-cancel-perf", "password-cancel")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader("{"name":"100k request cancellation"}"), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	seedStarted := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, ownerRoot.OwnerID, folder.ID)
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000

	states := make([]*galleryGoContextCancelState, galleryGoContextCancelRounds)
	for i := range states {
		states[i] = &galleryGoContextCancelState{
			latencies: make(chan float64, galleryGoContextCancelRequests),
		}
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		round, parseErr := strconv.Atoi(r.Header.Get("X-Test-Cancel-Round"))
		if parseErr == nil && round >= 1 && round <= galleryGoContextCancelRounds &&
			r.URL.Path == "/api/v1/media/items" {
			state := states[round-1]
			state.active.Add(1)
			defer state.active.Add(-1)
			go func(ctx context.Context) {
				<-ctx.Done()
				state.done.Add(1)
				if stamp := state.cancelAt.Load(); stamp != 0 {
					state.latencies <- float64(time.Since(time.Unix(0, stamp)).Microseconds()) / 1000
				}
			}(r.Context())
		}
		router.ServeHTTP(w, r)
	})
	serverHTTP := httptest.NewServer(wrapped)
	defer serverHTTP.Close()
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			MaxConnsPerHost: galleryGoContextCancelRequests + 2,
		},
	}
	defer client.CloseIdleConnections()

	// The real staleMediaNodes SELECT joins xd_media_metadata; this held
	// PostgreSQL table lock forces actual concurrent DB lock waits.
	lockTx := db.Begin()
	if lockTx.Error != nil {
		t.Fatal(lockTx.Error)
	}
	defer func() { _ = lockTx.Rollback().Error }()
	if err := lockTx.Exec("LOCK TABLE xd_media_metadata IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}
	lockWaiterCount := func() (int64, error) {
		var count int64
		err := db.Raw(
			"SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() "+
				"AND datname = current_database() AND state = 'active' "+
				"AND wait_event_type = 'Lock' AND query LIKE '%xd_nodes%'",
		).Scan(&count).Error
		return count, err
	}
	samples := make([]galleryGoContextCancelSample, 0, galleryGoContextCancelRounds)
	for round := 1; round <= galleryGoContextCancelRounds; round++ {
		state := states[round-1]
		cancelers := make([]context.CancelFunc, 0, galleryGoContextCancelRequests)
		outcomes := make(chan error, galleryGoContextCancelRequests)
		var bytesReceived atomic.Int64
		for i := 0; i < galleryGoContextCancelRequests; i++ {
			ctx, cancel := context.WithCancel(context.Background())
			cancelers = append(cancelers, cancel)
			url := fmt.Sprintf("%s/api/v1/media/items?range=true&limit=200&offset=%d",
				serverHTTP.URL, 50000+round*2000+i*200)
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-Test-Cancel-Round", strconv.Itoa(round))
			go func() {
				response, requestErr := client.Do(req)
				if requestErr != nil {
					outcomes <- requestErr
					return
				}
				defer response.Body.Close()
				body, readErr := io.ReadAll(response.Body)
				bytesReceived.Add(int64(len(body)))
				if readErr != nil {
					outcomes <- readErr
					return
				}
				outcomes <- fmt.Errorf("canceled HTTP unexpectedly returned status=%d", response.StatusCode)
			}()
		}
		waitDeadline := time.Now().Add(12 * time.Second)
		var beforeWaiters int64
		for time.Now().Before(waitDeadline) {
			beforeWaiters, err = lockWaiterCount()
			if err != nil {
				t.Fatal(err)
			}
			if beforeWaiters >= galleryGoContextCancelRequests &&
				state.active.Load() == galleryGoContextCancelRequests {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if beforeWaiters < galleryGoContextCancelRequests ||
			state.active.Load() != galleryGoContextCancelRequests {
			for _, cancel := range cancelers {
				cancel()
			}
			t.Fatalf("round=%d failed to establish six native PostgreSQL lock waits: waiters=%d handlers=%d",
				round, beforeWaiters, state.active.Load())
		}
		canceledAt := time.Now()
		state.cancelAt.Store(canceledAt.UnixNano())
		for _, cancel := range cancelers {
			cancel()
		}
		time.Sleep(galleryGoContextObservation)
		at160Waiters, err := lockWaiterCount()
		if err != nil {
			t.Fatal(err)
		}
		sample := galleryGoContextCancelSample{
			Round: round,
			WaitersBefore: beforeWaiters,
			WaitersAt160MS: at160Waiters,
			ActiveAt160MS: state.active.Load(),
			DoneAt160MS: state.done.Load(),
		}
		for i := 0; i < galleryGoContextCancelRequests; i++ {
			select {
			case clientErr := <-outcomes:
				if !errors.Is(clientErr, context.Canceled) {
					t.Fatalf("round=%d unexpected canceled HTTP result: %v", round, clientErr)
				}
			case <-time.After(3 * time.Second):
				t.Fatalf("round=%d canceled HTTP client did not return", round)
			}
		}
		// Allow native PostgreSQL driver cleanup slightly longer than the
		// 160ms signal-delivery target, with a fixed 500ms hard deadline.
		for time.Since(canceledAt) < galleryGoContextMaxDrain {
			remaining, pgErr := lockWaiterCount()
			if pgErr != nil {
				t.Fatal(pgErr)
			}
			if remaining == 0 && state.active.Load() == 0 &&
				state.done.Load() == galleryGoContextCancelRequests {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		sample.WaitersAt500MS, err = lockWaiterCount()
		if err != nil {
			t.Fatal(err)
		}
		sample.ActiveAt500MS = state.active.Load()
		sample.DoneAt500MS = state.done.Load()
		sample.PayloadBytes = bytesReceived.Load()
		for len(state.latencies) != 0 {
			sample.AbortLatenciesMS = append(sample.AbortLatenciesMS, <-state.latencies)
		}
		sort.Float64s(sample.AbortLatenciesMS)
		if len(sample.AbortLatenciesMS) != 0 {
			sample.MaxContextDoneMS = sample.AbortLatenciesMS[len(sample.AbortLatenciesMS)-1]
		}
		samples = append(samples, sample)
		t.Logf("GALLERY_GO_CONTEXT_CANCEL_100K_SAMPLE round=%d waiters=%d done160=%d active160=%d waiters160=%d done500=%d active500=%d waiters500=%d bytes=%d max_done_ms=%.3f",
			round, sample.WaitersBefore, sample.DoneAt160MS, sample.ActiveAt160MS,
			sample.WaitersAt160MS, sample.DoneAt500MS, sample.ActiveAt500MS,
			sample.WaitersAt500MS, sample.PayloadBytes, sample.MaxContextDoneMS)
		if sample.DoneAt500MS != galleryGoContextCancelRequests ||
			sample.ActiveAt500MS != 0 || sample.WaitersAt500MS != 0 ||
			sample.PayloadBytes != 0 ||
			len(sample.AbortLatenciesMS) != galleryGoContextCancelRequests ||
			sample.MaxContextDoneMS > float64(galleryGoContextMaxDrain.Milliseconds()) {
			t.Fatalf("round=%d did not release all HTTP/PG work within 500ms: %+v", round, sample)
		}
	}

	report, err := json.Marshal(map[string]any{
		"workload":                "gallery-go-context-cancel-100k",
		"logical_assets":          100000,
		"physical_nodes":          115000,
		"live_photo_groups":       15000,
		"request_count_per_round": galleryGoContextCancelRequests,
		"sample_count":            galleryGoContextCancelRounds,
		"seed_ms":                 seedMS,
		"observe_ms":              galleryGoContextObservation.Milliseconds(),
		"max_drain_ms":            galleryGoContextMaxDrain.Milliseconds(),
		"samples":                 samples,
		"scope":                   "native PostgreSQL lock waits + real authenticated Gin HTTP Request.Context; not Electron IPC, browser paint, media decoding or durable background tasks",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_GO_CONTEXT_CANCEL_100K %s", report)

	if err := lockTx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	healthy, err := http.NewRequest(http.MethodGet,
		serverHTTP.URL+"/api/v1/media/items?range=true&limit=100&offset=0", nil)
	if err != nil {
		t.Fatal(err)
	}
	healthy.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(healthy)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("post-cancellation Gallery status=%d body=%s", response.StatusCode, string(body))
	}
	var page mediaItemRangeDTO
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != mediaGalleryFirstOpenLogicalCount || len(page.Items) != 100 {
		t.Fatalf("post-cancel healthy response: total=%d items=%d", page.TotalCount, len(page.Items))
	}
}
