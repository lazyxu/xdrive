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
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// The test is opt-in: it exercises the production HTTP handler against a real
// PostgreSQL 17 journal, with all six clients cancelled while SQL is locked.
// It is NOT a test of durable sync cancellation or media decoding.
func TestNodeChangesRequestContextCancelReal100K(t *testing.T) {
	if os.Getenv("XD_NODE_CHANGES_100K_CANCEL_PERF") != "1" {
		t.Skip("set XD_NODE_CHANGES_100K_CANCEL_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("real PostgreSQL DSN required")
	}
	expectFixed := os.Getenv("XD_NODE_CHANGES_100K_EXPECT_FIXED") == "1"
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.NodeChange{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("node-changes-real-cancel-perf", time.Hour),
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 16 << 20,
	}).Router()
	token := createTestUser(t, db, router, "node-changes-perf-owner", "performance-test-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var rootNode meta.Node
	if err := db.First(&rootNode, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	seeded := time.Now()
	// Real 100k Node/File/NodeChange rows and an indexed cursor; the suffixes
	// describe a mixed namespace, not 100k physical CAS media originals.
	if err := db.Exec(`
INSERT INTO xd_nodes(parent_id,name,type,owner_id,revision,created_at,updated_at)
SELECT ?, 'change-' || lpad(gs::text,6,'0') ||
    CASE gs % 4 WHEN 0 THEN '.jpg' WHEN 1 THEN '.mp4'
                WHEN 2 THEN '.livp' ELSE '.dng' END,
    'file', ?, 1, NOW(), NOW()
FROM generate_series(1,100000) gs`, rootNode.ID, rootNode.OwnerID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files(node_id,size,storage_key,sha256,created_at,updated_at)
SELECT id, 1024, 'perf/changes/' || id::text, '', NOW(), NOW()
FROM xd_nodes WHERE owner_id=? AND parent_id=?`, rootNode.OwnerID, rootNode.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_node_changes(owner_id,node_id,parent_id,created_at)
SELECT owner_id,id,parent_id,NOW()
FROM xd_nodes WHERE owner_id=? AND parent_id=? ORDER BY id`, rootNode.OwnerID, rootNode.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_node_changes"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedMS := float64(time.Since(seeded).Microseconds()) / 1000
	var actualCount int64
	if err := db.Model(&meta.NodeChange{}).Where("owner_id=?", rootNode.OwnerID).
		Count(&actualCount).Error; err != nil || actualCount != 100000 {
		t.Fatalf("real journal count=%d err=%v", actualCount, err)
	}

	var active, started, notices, maxNoticeNS, cancelMark atomic.Int64
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/changes" || r.URL.Query().Get("perf_cancel_probe") != "1" {
			router.ServeHTTP(w, r)
			return
		}
		started.Add(1)
		active.Add(1)
		defer active.Add(-1)
		stopped := make(chan struct{})
		go func() {
			select {
			case <-r.Context().Done():
				notices.Add(1)
				if mark := cancelMark.Load(); mark != 0 {
					ns := time.Now().UnixNano() - mark
					for {
						old := maxNoticeNS.Load()
						if ns <= old || maxNoticeNS.CompareAndSwap(old, ns) {
							break
						}
					}
				}
			case <-stopped:
			}
		}()
		defer close(stopped)
		router.ServeHTTP(w, r)
	}))
	defer peer.Close()
	httpClient := &http.Client{Timeout: 15 * time.Second}
	getPage := func(after int) (nodeChangePageDTO, float64) {
		req, reqErr := http.NewRequest(http.MethodGet,
			fmt.Sprintf("%s/api/v1/changes?after=%d&limit=200", peer.URL, after), nil)
		if reqErr != nil {
			t.Fatal(reqErr)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		begin := time.Now()
		response, doErr := httpClient.Do(req)
		elapsed := float64(time.Since(begin).Microseconds()) / 1000
		if doErr != nil {
			t.Fatal(doErr)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("change page after=%d status=%d body=%s", after, response.StatusCode, body)
		}
		var page nodeChangePageDTO
		if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		if len(page.Changes) != 200 || page.LatestCursor != 100000 {
			t.Fatalf("change page after=%d count=%d latest=%d", after, len(page.Changes), page.LatestCursor)
		}
		return page, elapsed
	}
	_, firstPageMS := getPage(0)
	_, middlePageMS := getPage(50000)
	_, lastPageMS := getPage(99800)

	lock := db.Begin()
	if lock.Error != nil {
		t.Fatal(lock.Error)
	}
	released := false
	defer func() {
		if !released {
			_ = lock.Rollback().Error
		}
	}()
	if err := lock.Exec("LOCK TABLE xd_node_changes IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}
	waiters := func() int64 {
		var count int64
		if err := db.Raw(`SELECT count(*) FROM pg_stat_activity
WHERE wait_event_type='Lock' AND state='active'
AND query ILIKE '%xd_node_changes%'`).Scan(&count).Error; err != nil {
			t.Fatal(err)
		}
		return count
	}
	const requests = 6
	cancels := make([]context.CancelFunc, 0, requests)
	results := make(chan error, requests)
	for i := 0; i < requests; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancels = append(cancels, cancel)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			peer.URL+"/api/v1/changes?after=0&limit=200&perf_cancel_probe=1", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		go func(req *http.Request) {
			response, doErr := httpClient.Do(req)
			if response != nil {
				_, _ = io.Copy(io.Discard, response.Body)
				_ = response.Body.Close()
			}
			results <- doErr
		}(req)
	}
	defer func() {
		for _, cancel := range cancels {
			cancel()
		}
	}()
	beforeWaiters := int64(0)
	until := time.Now().Add(8 * time.Second)
	for time.Now().Before(until) {
		if started.Load() == requests {
			beforeWaiters = waiters()
			if beforeWaiters == requests {
				break
			}
		}
		time.Sleep(15 * time.Millisecond)
	}
	if beforeWaiters != requests {
		t.Fatalf("did not observe %d real PostgreSQL SQL lock waiters: started=%d waiters=%d", requests, started.Load(), beforeWaiters)
	}
	cancelMark.Store(time.Now().UnixNano())
	for _, cancel := range cancels {
		cancel()
	}
	time.Sleep(160 * time.Millisecond)
	afterWaiters := waiters()
	afterActive := active.Load()
	afterNotices := notices.Load()
	maxNoticeMS := float64(maxNoticeNS.Load()) / 1e6
	if err := lock.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	released = true
	cancelledClients := 0
	for i := 0; i < requests; i++ {
		select {
		case err := <-results:
			if errors.Is(err, context.Canceled) {
				cancelledClients++
			} else {
				t.Errorf("client request did not report context cancellation: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("cancelled client HTTP request did not finish")
		}
	}
	_, healthyAfterMS := getPage(50000)
	evidence := map[string]any{
		"workload":                      "100k-real-node-change-feed-sql-request-cancel",
		"sample":                        strings.TrimSpace(os.Getenv("XD_NODE_CHANGES_100K_SAMPLE")),
		"expect_fixed":                  expectFixed,
		"node_changes":                  actualCount,
		"page_limit":                    200,
		"seed_ms_excluded":              seedMS,
		"first_page_ms":                 firstPageMS,
		"middle_page_ms":                middlePageMS,
		"last_page_ms":                  lastPageMS,
		"healthy_after_ms":              healthyAfterMS,
		"blocked_sql_before":            beforeWaiters,
		"blocked_sql_after_160ms":       afterWaiters,
		"active_handlers_after_160ms":   afterActive,
		"http_context_done_after_160ms": afterNotices,
		"client_cancellations":          cancelledClients,
		"max_http_context_notice_ms":    maxNoticeMS,
	}
	body, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("NODE_CHANGES_SQL_CANCEL_100K %s", body)
	if afterNotices != requests || cancelledClients != requests || maxNoticeMS > 160 {
		t.Fatalf("HTTP cancellation contract violated: %s", body)
	}
	if expectFixed {
		if afterWaiters != 0 || afterActive != 0 {
			t.Fatalf("SQL/handler not released within 160ms: %s", body)
		}
	} else if afterWaiters == 0 || afterActive == 0 {
		t.Fatalf("expected repeatable pre-fix SQL wait/handler retention: %s", body)
	}
}
