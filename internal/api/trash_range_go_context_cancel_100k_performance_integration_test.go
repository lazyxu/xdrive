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
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestTrashRangeRequestContextCancellation100K establishes a real native
// PostgreSQL 100k-file cancellation baseline, not a synthetic handler sleep.
// XD_TRASH_RANGE_GO_CONTEXT_CANCEL_EXPECT_FIXED=1 enables the frozen post-fix
// acceptance gate. It is intentionally OFF for the first measurement-only PR.
func TestTrashRangeRequestContextCancellation100K(t *testing.T) {
	if os.Getenv("XD_TRASH_RANGE_GO_CONTEXT_CANCEL_PERF") != "1" {
		t.Skip("enable XD_TRASH_RANGE_GO_CONTEXT_CANCEL_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	expectFixed := os.Getenv("XD_TRASH_RANGE_GO_CONTEXT_CANCEL_EXPECT_FIXED") == "1"
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
		`CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE INDEX idx_xd_nodes_children_updated ON xd_nodes(owner_id, parent_id, type, updated_at, id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE INDEX idx_xd_files_size_node ON xd_files(size, node_id)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth:       auth.New("trash-range-go-context-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "file-explorer-go-context-perf", "password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	const logicalCount = 100000
	const numRequests = 6
	const observation = 160 * time.Millisecond
	seedStart := time.Now()
	if err := db.Exec(`
INSERT INTO xd_nodes(parent_id, name, type, owner_id, revision,
    deleted_at, created_at, updated_at)
SELECT ?, 'trash-' || lpad(gs::text, 6, '0') ||
    CASE gs % 4 WHEN 0 THEN '.jpg' WHEN 1 THEN '.mp4'
                 WHEN 2 THEN '.livp' ELSE '.txt' END,
    'file', ?, 1, NOW(), NOW(), NOW()
FROM generate_series(1, ?) AS gs
`, root.ID, ownerRoot.OwnerID, logicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
UPDATE xd_nodes SET trash_root_id = id
WHERE owner_id = ? AND deleted_at IS NOT NULL
`, ownerRoot.OwnerID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_files").Error; err != nil {
		t.Fatal(err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000

	trashPath := "/api/v1/trash"
	var activeHandlers, contextDone, clientResponseBytes atomic.Int64
	var cancelAt atomic.Int64
	contextLatencies := make(chan float64, numRequests)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == trashPath {
			activeHandlers.Add(1)
			defer activeHandlers.Add(-1)
			go func(ctx context.Context) {
				<-ctx.Done()
				contextDone.Add(1)
				if canceled := cancelAt.Load(); canceled != 0 {
					contextLatencies <- float64(time.Since(time.Unix(0, canceled)).Microseconds()) / 1000
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
			DisableKeepAlives: true, MaxConnsPerHost: numRequests + 2,
		},
	}
	defer client.CloseIdleConnections()

	// Hold a genuine PostgreSQL table lock so the actual Trash range
	// counted-range SQL cannot finish until the test releases it.
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
		url := fmt.Sprintf("%s%s?range=true&offset=%d&limit=200&sort=name&order=asc",
			httpServer.URL, trashPath, i*200)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		go func(req *http.Request) {
			response, requestErr := client.Do(req)
			if requestErr != nil {
				outcomes <- requestErr
				return
			}
			defer response.Body.Close()
			body, readErr := io.ReadAll(response.Body)
			clientResponseBytes.Add(int64(len(body)))
			if readErr != nil {
				outcomes <- readErr
				return
			}
			outcomes <- fmt.Errorf("unexpected completed request status=%d body=%d",
				response.StatusCode, len(body))
		}(req)
	}
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()

	pgWaiters := func() (int64, error) {
		var result int64
		err := db.Raw("SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() " +
			"AND state = 'active' AND wait_event_type = 'Lock' " +
			"AND query LIKE '%xd_nodes%'").Scan(&result).Error
		return result, err
	}
	var beforeWaiters int64
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		beforeWaiters, err = pgWaiters()
		if err != nil {
			t.Fatal(err)
		}
		if beforeWaiters >= numRequests && activeHandlers.Load() == numRequests {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if beforeWaiters < numRequests || activeHandlers.Load() != numRequests {
		t.Fatalf("real SQL waits not established: waiters=%d handlers=%d",
			beforeWaiters, activeHandlers.Load())
	}

	cancelAt.Store(time.Now().UnixNano())
	for _, cancel := range cancels {
		cancel()
	}
	time.Sleep(observation)
	afterWaiters, err := pgWaiters()
	if err != nil {
		t.Fatal(err)
	}
	afterActive := activeHandlers.Load()
	afterDone := contextDone.Load()
	afterBytes := clientResponseBytes.Load()
	for range numRequests {
		select {
		case clientErr := <-outcomes:
			if !errors.Is(clientErr, context.Canceled) {
				t.Fatalf("client did not abort its HTTP request: %v", clientErr)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("canceled HTTP client did not return")
		}
	}
	latencies := make([]float64, 0, numRequests)
	for len(contextLatencies) > 0 {
		latencies = append(latencies, <-contextLatencies)
	}
	sort.Float64s(latencies)
	maxContextLatencyMS := 0.0
	if len(latencies) > 0 {
		maxContextLatencyMS = latencies[len(latencies)-1]
	}
	result := map[string]any{
		"workload":      "trash-range-go-context-cancel-100k",
		"expect_fixed":  expectFixed,
		"logical_files": logicalCount,
		"extensions":    ".jpg/.mp4/.livp/.txt metadata-only (no actual live pairing or codecs)",
		"seed_ms":       seedMS, "requests": numRequests, "observation_ms": observation.Milliseconds(),
		"started_sql_waits":              beforeWaiters,
		"context_done_at_160ms":          afterDone,
		"handler_active_at_160ms":        afterActive,
		"postgres_lock_waiters_at_160ms": afterWaiters,
		"client_payload_bytes_at_160ms":  afterBytes,
		"server_context_latency_ms":      latencies,
		"max_server_context_done_ms":     maxContextLatencyMS,
		"scope":                          "actual HTTP authenticated Gin Trash count-once range handler, native PG lock wait, 6 virtual-range request cancellations; no Electron, media generation, network or durable transfer cancellation",
	}
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("TRASH_RANGE_GO_CONTEXT_CANCEL_100K %s", payload)
	if afterBytes != 0 || afterDone != numRequests || len(latencies) != numRequests ||
		maxContextLatencyMS > float64(observation.Milliseconds()) {
		t.Fatalf("HTTP abort contract failed: %+v", result)
	}
	if expectFixed {
		if afterActive != 0 || afterWaiters != 0 {
			t.Fatalf("discarded FileExplorer SQL still active 160ms after cancel: %+v", result)
		}
	} else if afterActive != numRequests || afterWaiters < numRequests {
		t.Fatalf("unexpected baseline result; revisit frozen cancellation gate: %+v", result)
	}

	// Ensure cancellations do not affect a fresh independent viewport request.
	if err := lockTx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	healthy, err := http.NewRequest(http.MethodGet, fmt.Sprintf(
		"%s%s?range=true&offset=0&limit=200&sort=name&order=asc", httpServer.URL, trashPath), nil)
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
		t.Fatalf("healthy request status=%d body=%s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var page trashRangeDTO
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != logicalCount || len(page.Items) != 200 {
		t.Fatalf("post-cancel page incorrect: total=%d items=%d", page.TotalCount, len(page.Items))
	}
}
