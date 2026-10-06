package api

import (
	"encoding/json"
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

func TestFileExplorerDirectorySortPerformanceBaseline100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_DIRECTORY_SORT_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_DIRECTORY_SORT_PERF=1 to run the 100k directory-sort workload")
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

	schema := "directory_sort_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		DB:            db,
		Store:         store,
		Auth:          auth.New("directory-sort-perf-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "directory-sort-perf", "password")
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
	'item-' || lpad(gs::text, 6, '0') ||
		CASE (gs % 4)
			WHEN 0 THEN '.txt'
			WHEN 1 THEN '.jpg'
			WHEN 2 THEN '.pdf'
			ELSE '.zip'
		END,
	'file',
	?,
	1,
	TIMESTAMPTZ '2026-01-01 00:00:00+00',
	TIMESTAMPTZ '2026-01-01 00:00:00+00' + (gs % 10000) * INTERVAL '1 second'
FROM generate_series(1, ?) AS gs
`, root.ID, root.OwnerID, logicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (
	node_id, size, storage_key, sha256, created_at, updated_at
)
SELECT
	n.id,
	((n.id * 7919) % 100000000) + 1,
	'directory-sort-perf/' || n.id,
	'',
	n.created_at,
	n.updated_at
FROM xd_nodes n
WHERE n.owner_id = ? AND n.parent_id = ? AND n.type = 'file' AND n.deleted_at IS NULL
`, root.OwnerID, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_files").Error; err != nil {
		t.Fatal(err)
	}

	measure := func(sortKey string, offset int) time.Duration {
		path := fmt.Sprintf(
			"/api/v1/nodes/%d/children?offset=%d&limit=200&sort=%s&order=asc",
			root.ID,
			offset,
			url.QueryEscape(sortKey),
		)
		started := time.Now()
		response := request(t, router, http.MethodGet, path, token, nil, http.StatusOK)
		elapsed := time.Since(started)

		var page childrenRangeDTO
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if page.TotalCount != logicalCount {
			t.Fatalf("sort=%s offset=%d total_count=%d want=%d", sortKey, offset, page.TotalCount, logicalCount)
		}
		if len(page.Items) != 200 {
			t.Fatalf("sort=%s offset=%d items=%d want=200", sortKey, offset, len(page.Items))
		}
		return elapsed
	}

	median := func(values []time.Duration) time.Duration {
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[len(values)/2]
	}

	const samples = 3
	for _, sortKey := range []string{"name", "updated", "size", "type"} {
		// Warm PostgreSQL buffers and handler allocation paths before measuring.
		_ = measure(sortKey, 0)
		_ = measure(sortKey, logicalCount/2)

		firstSamples := make([]time.Duration, 0, samples)
		middleSamples := make([]time.Duration, 0, samples)
		for range samples {
			firstSamples = append(firstSamples, measure(sortKey, 0))
			middleSamples = append(middleSamples, measure(sortKey, logicalCount/2))
		}
		t.Logf(
			"FILEEXPLORER_DIRECTORY_SORT_100K_BASELINE sort=%s logical_count=%d page_size=200 first_range_median=%s middle_range_median=%s samples=%d",
			sortKey,
			logicalCount,
			median(firstSamples),
			median(middleSamples),
			samples,
		)
	}
}
