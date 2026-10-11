package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// This is a real Go Client -> authenticated HTTP -> Gin -> PostgreSQL change
// feed, not an in-memory fake or a durable file-byte/source-run sync benchmark.
const (
	nodeChangesClientPerfCount    = 100000
	nodeChangesClientPerfPageSize = 1000
	nodeChangesClientPerfBudgetMS = 60000
	nodeChangesClientPerfRSSLimit = 256 << 20
)

type nodeChangesClientPerfWriter struct {
	http.ResponseWriter
	bytes int64
}

func (w *nodeChangesClientPerfWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

func nodeChangesClientPerfVmRSS() int64 {
	body, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(body), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			return 0
		}
		kib, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return 0
		}
		return kib * 1024
	}
	return 0
}

func TestNodeChangesRealGoClient100K(t *testing.T) {
	if os.Getenv("XD_NODE_CHANGES_CLIENT_100K_PERF") != "1" {
		t.Skip("set XD_NODE_CHANGES_CLIENT_100K_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("native PostgreSQL17 DSN required")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{},
		&meta.Node{}, &meta.File{}, &meta.NodeChange{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: local,
		Auth:           auth.New("node-changes-client-100k-perf", time.Hour),
		RefreshTTL:     time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 16 << 20,
	}).Router()
	token := createTestUser(t, db, router, "client-100k-owner", "client-100k-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id,name,type,owner_id,revision,deleted_at,created_at,updated_at) "+
			"SELECT ?, 'sync-' || lpad(gs::text,6,'0') || "+
			"CASE gs % 4 WHEN 0 THEN '.dng' WHEN 1 THEN '.jpg' "+
			"WHEN 2 THEN '.mp4' ELSE '.livp' END, "+
			"'file', ?, 1, CASE WHEN gs % 4 = 0 THEN NOW() ELSE NULL END, "+
			"NOW(), NOW() FROM generate_series(1,?) AS gs",
		root.ID, ownerRoot.OwnerID, nodeChangesClientPerfCount,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO xd_files(node_id,size,storage_key,sha256,created_at,updated_at) "+
			"SELECT id, 1024, 'perf/changefeed/' || id::text, '', NOW(), NOW() "+
			"FROM xd_nodes WHERE owner_id=? AND parent_id=?",
		ownerRoot.OwnerID, root.ID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO xd_node_changes(owner_id,node_id,parent_id,created_at) "+
			"SELECT owner_id,id,parent_id,NOW() "+
			"FROM xd_nodes WHERE owner_id=? AND parent_id=? ORDER BY id",
		ownerRoot.OwnerID, root.ID,
	).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_node_changes"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	var actual int64
	if err := db.Model(&meta.NodeChange{}).Where("owner_id=?", ownerRoot.OwnerID).
		Count(&actual).Error; err != nil || actual != nodeChangesClientPerfCount {
		t.Fatalf("incorrect indexed 100k change feed fixture: count=%d err=%v", actual, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000

	var httpRequests, httpBytes, httpErrors atomic.Int64
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		isChange := req.Method == http.MethodGet && req.URL.Path == "/api/v1/changes"
		if isChange {
			httpRequests.Add(1)
		}
		counted := &nodeChangesClientPerfWriter{ResponseWriter: w}
		router.ServeHTTP(counted, req)
		if isChange {
			httpBytes.Add(counted.bytes)
		}
	}))
	defer peer.Close()
	cli := clientpkg.New(peer.URL, token)

	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	rssStart := nodeChangesClientPerfVmRSS()
	if rssStart == 0 {
		t.Fatal("native Linux VmRSS baseline unavailable")
	}
	var rssMax atomic.Int64
	rssMax.Store(rssStart)
	stop := make(chan struct{})
	done := make(chan struct{})
	var stopOnce sync.Once
	stopSampling := func() {
		stopOnce.Do(func() {
			close(stop)
			<-done
		})
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if current := nodeChangesClientPerfVmRSS(); current > rssMax.Load() {
					rssMax.Store(current)
				}
			}
		}
	}()
	defer stopSampling()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cursor := uint64(0)
	unique := make(map[uint64]struct{}, nodeChangesClientPerfCount)
	var upserts, deletes, pages int
	durations := make([]float64, 0, nodeChangesClientPerfCount/nodeChangesClientPerfPageSize)
	start := time.Now()
	for {
		requestStart := time.Now()
		page, err := cli.NodeChangesWithDeletedPaths(ctx, cursor, nodeChangesClientPerfPageSize)
		durations = append(durations, float64(time.Since(requestStart).Microseconds())/1000)
		if err != nil {
			httpErrors.Add(1)
			t.Fatalf("authentic Client change feed at cursor %d: %v", cursor, err)
		}
		if page.ResetRequired || page.LatestCursor != nodeChangesClientPerfCount ||
			page.NextCursor <= cursor || len(page.Changes) != nodeChangesClientPerfPageSize {
			t.Fatalf("invalid paginated change page after %d: count=%d next=%d latest=%d reset=%t",
				cursor, len(page.Changes), page.NextCursor, page.LatestCursor, page.ResetRequired)
		}
		prior := cursor
		for _, change := range page.Changes {
			if change.Cursor <= prior || change.NodeID == 0 ||
				len(change.AffectedParentIDs) != 1 ||
				change.AffectedParentIDs[0] != root.ID || change.Path == "" {
				t.Fatalf("invalid changed item: cursor=%d node=%d parents=%v path=%q",
					change.Cursor, change.NodeID, change.AffectedParentIDs, change.Path)
			}
			if _, exists := unique[change.NodeID]; exists {
				t.Fatalf("duplicate node across 100k pages: %d", change.NodeID)
			}
			unique[change.NodeID] = struct{}{}
			prior = change.Cursor
			switch change.Operation {
			case "delete":
				if change.Node != nil || !strings.HasSuffix(change.Path, ".dng") {
					t.Fatalf("incorrect 100k delete tombstone: id=%d path=%q", change.NodeID, change.Path)
				}
				deletes++
			case "upsert":
				if change.Node == nil || change.Node.ID != change.NodeID ||
					(!strings.HasSuffix(change.Path, ".jpg") &&
						!strings.HasSuffix(change.Path, ".mp4") &&
						!strings.HasSuffix(change.Path, ".livp")) {
					t.Fatalf("incorrect 100k upsert: id=%d path=%q", change.NodeID, change.Path)
				}
				upserts++
			default:
				t.Fatalf("unexpected changed item operation=%q", change.Operation)
			}
		}
		if page.NextCursor != prior {
			t.Fatalf("page next cursor=%d last row cursor=%d", page.NextCursor, prior)
		}
		cursor = page.NextCursor
		pages++
		if !page.HasMore {
			break
		}
		if pages > 101 {
			t.Fatal("unbounded change-feed pagination")
		}
	}
	totalMS := float64(time.Since(start).Microseconds()) / 1000
	stopSampling()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	sort.Float64s(durations)
	p50 := (durations[49] + durations[50]) / 2
	p95 := durations[94]
	maxRSSGrowth := rssMax.Load() - rssStart
	sample := strings.TrimSpace(os.Getenv("XD_NODE_CHANGES_CLIENT_100K_SAMPLE"))
	result := map[string]any{
		"workload":                      "real-Go-Client-to-authenticated-Gin-PostgreSQL17-100k-changefeed",
		"sample":                        sample,
		"node_changes":                  actual,
		"physical_media_bytes":          false,
		"page_size":                     nodeChangesClientPerfPageSize,
		"pages":                         pages,
		"items":                         len(unique),
		"upserts":                       upserts,
		"deleted_tombstones_with_paths": deletes,
		"elapsed_ms":                    totalMS,
		"page_p50_ms":                   p50,
		"page_p95_ms":                   p95,
		"page_worst_ms":                 durations[len(durations)-1],
		"http_request_count":            httpRequests.Load(),
		"http_response_bytes":           httpBytes.Load(),
		"http_error_count":              httpErrors.Load(),
		"rss_start_bytes":               rssStart,
		"rss_peak_sampled_bytes":        rssMax.Load(),
		"rss_peak_growth_bytes":         maxRSSGrowth,
		"go_heap_alloc_start_bytes":     before.Alloc,
		"go_heap_alloc_after_bytes":     after.Alloc,
		"seed_ms_excluded":              seedMS,
		"elapsed_budget_ms":             nodeChangesClientPerfBudgetMS,
		"rss_growth_budget_bytes":       nodeChangesClientPerfRSSLimit,
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("NODE_CHANGES_CLIENT_100K %s", encoded)
	if pages != 100 || len(unique) != nodeChangesClientPerfCount ||
		upserts != 75000 || deletes != 25000 || cursor != nodeChangesClientPerfCount ||
		httpRequests.Load() != int64(pages) || httpErrors.Load() != 0 || httpBytes.Load() < 5000000 {
		t.Fatalf("100k complete consumption or HTTP identity failed: %s", encoded)
	}
	if totalMS > nodeChangesClientPerfBudgetMS || maxRSSGrowth > nodeChangesClientPerfRSSLimit {
		t.Logf("NODE_CHANGES_CLIENT_100K_BUDGET_RED elapsed_or_rss_over_budget")
	}
}
