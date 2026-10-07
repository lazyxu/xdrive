package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestFileExplorerSearchPerformanceBaseline100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_SEARCH_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_SEARCH_PERF=1 to run the 100k Search performance workload")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(4)
	baseSQL.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := "search_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE INDEX idx_xd_nodes_children_updated ON xd_nodes(owner_id, parent_id, type, updated_at, id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE INDEX idx_xd_files_size_node ON xd_files(size, node_id)`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth:          auth.New("search-perf-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "search-perf", "password")
	rootDTO := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var root meta.Node
	if err := db.First(&root, rootDTO.ID).Error; err != nil {
		t.Fatal(err)
	}

	const logicalCount = 100_000
	if err := db.Exec(`
INSERT INTO xd_nodes (
	parent_id, name, type, owner_id, revision, created_at, updated_at
)
SELECT
	?,
	'perf-' || lpad(gs::text, 6, '0') || '.txt',
	'file',
	?,
	1,
	NOW(),
	NOW()
FROM generate_series(1, ?) AS gs
`, root.ID, root.OwnerID, logicalCount).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_files").Error; err != nil {
		t.Fatal(err)
	}

	var middleNode meta.Node
	if err := db.Where("parent_id = ? AND name = ?", root.ID, "perf-050000.txt").First(&middleNode).Error; err != nil {
		t.Fatal(err)
	}

	measureRange := func(offset int) time.Duration {
		ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
		defer cancel()
		started := time.Now()
		page, err := server.searchNodeRange(
			ctx,
			root.OwnerID,
			"perf",
			meta.NodeTypeFile,
			searchFilters{},
			offset,
			200,
			"name",
			"asc",
		)
		elapsed := time.Since(started)
		if err != nil {
			t.Fatal(err)
		}
		if page.TotalCount != logicalCount {
			t.Fatalf("offset=%d total_count=%d want=%d", offset, page.TotalCount, logicalCount)
		}
		if len(page.Items) != 200 {
			t.Fatalf("offset=%d items=%d want=200", offset, len(page.Items))
		}
		return elapsed
	}

	middleCursor := searchCursor{
		Query: "perf",
		Type:  meta.NodeTypeFile,
		Sort:  "name",
		Order: "asc",
		Rank:  1,
		Value: strings.ToLower(middleNode.Name),
		Path:  middleNode.Name,
		ID:    middleNode.ID,
	}
	measureCursor := func(cursor searchCursor, wantFirstName string) time.Duration {
		ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
		defer cancel()
		started := time.Now()
		page, err := server.searchNodePage(
			ctx,
			root.OwnerID,
			"perf",
			meta.NodeTypeFile,
			searchFilters{},
			200,
			"name",
			"asc",
			cursor,
		)
		elapsed := time.Since(started)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 200 {
			t.Fatalf("cursor page items=%d want=200", len(page.Items))
		}
		if page.Items[0].Node.Name != wantFirstName {
			t.Fatalf("cursor first item=%q want=%q", page.Items[0].Node.Name, wantFirstName)
		}
		return elapsed
	}

	// Warm PostgreSQL buffers and both production/diagnostic Search query shapes.
	_ = measureRange(0)
	_ = measureRange(logicalCount / 2)
	_ = measureCursor(searchCursor{}, "perf-000001.txt")
	_ = measureCursor(middleCursor, "perf-050001.txt")

	const samples = 3
	rangeFirstSamples := make([]time.Duration, 0, samples)
	rangeMiddleSamples := make([]time.Duration, 0, samples)
	cursorFirstSamples := make([]time.Duration, 0, samples)
	cursorMiddleSamples := make([]time.Duration, 0, samples)
	for range samples {
		rangeFirstSamples = append(rangeFirstSamples, measureRange(0))
		rangeMiddleSamples = append(rangeMiddleSamples, measureRange(logicalCount/2))
		cursorFirstSamples = append(cursorFirstSamples, measureCursor(searchCursor{}, "perf-000001.txt"))
		cursorMiddleSamples = append(cursorMiddleSamples, measureCursor(middleCursor, "perf-050001.txt"))
	}
	median := func(values []time.Duration) time.Duration {
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[len(values)/2]
	}

	fmt.Printf(
		"FILEEXPLORER_SEARCH_100K_AFTER logical_count=%d page_size=200 range_first_median=%s range_middle_median=%s cursor_first_median=%s cursor_middle_median=%s samples=%d\n",
		logicalCount,
		median(rangeFirstSamples),
		median(rangeMiddleSamples),
		median(cursorFirstSamples),
		median(cursorMiddleSamples),
		samples,
	)

}
