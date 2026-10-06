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

func TestFileExplorerDirectoryPerformanceBaseline100K(t *testing.T) {
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

	schema := "directory_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		Auth:          auth.New("directory-perf-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "directory-perf", "password")
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
	'item-' || lpad(gs::text, 6, '0') || '.txt',
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

	measure := func(offset int) time.Duration {
		path := fmt.Sprintf(
			"/api/v1/nodes/%d/children?offset=%d&limit=200&sort=name&order=asc",
			root.ID,
			offset,
		)
		started := time.Now()
		response := request(t, router, http.MethodGet, path, token, nil, http.StatusOK)
		elapsed := time.Since(started)

		var page childrenRangeDTO
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
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

	// Warm PostgreSQL buffers and handler allocation paths before measuring.
	_ = measure(0)
	_ = measure(logicalCount / 2)

	const samples = 3
	firstSamples := make([]time.Duration, 0, samples)
	middleSamples := make([]time.Duration, 0, samples)
	for range samples {
		firstSamples = append(firstSamples, measure(0))
		middleSamples = append(middleSamples, measure(logicalCount/2))
	}
	median := func(values []time.Duration) time.Duration {
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[len(values)/2]
	}

	firstMedian := median(firstSamples)
	middleMedian := median(middleSamples)
	t.Logf(
		"FILEEXPLORER_DIRECTORY_100K_BASELINE logical_count=%d page_size=200 first_range_median=%s middle_range_median=%s samples=%d",
		logicalCount,
		firstMedian,
		middleMedian,
		samples,
	)
	if firstMedian > 500*time.Millisecond {
		t.Fatalf("FileExplorer first 100k directory range regressed: %s > 500ms", firstMedian)
	}
	if middleMedian > 750*time.Millisecond {
		t.Fatalf("FileExplorer middle 100k directory range regressed: %s > 750ms", middleMedian)
	}
}
