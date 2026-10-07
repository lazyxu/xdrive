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

	median := func(values []time.Duration) time.Duration {
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[len(values)/2]
	}
	const samples = 3

	measure := func(sortKey string, offset int, includeCount bool) time.Duration {
		path := fmt.Sprintf(
			"/api/v1/nodes/%d/children?offset=%d&limit=200&sort=%s&order=asc",
			root.ID,
			offset,
			url.QueryEscape(sortKey),
		)
		if !includeCount {
			path += "&include_count=false"
		}
		started := time.Now()
		response := request(t, router, http.MethodGet, path, token, nil, http.StatusOK)
		elapsed := time.Since(started)

		var page childrenRangeDTO
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if includeCount {
			if !page.TotalCountIncluded || page.TotalCount != logicalCount {
				t.Fatalf(
					"sort=%s offset=%d counted range total_count=%d included=%v want=%d/true",
					sortKey,
					offset,
					page.TotalCount,
					page.TotalCountIncluded,
					logicalCount,
				)
			}
		} else if page.TotalCountIncluded || page.TotalCount != 0 {
			t.Fatalf(
				"sort=%s offset=%d count-free range total_count=%d included=%v want=0/false",
				sortKey,
				offset,
				page.TotalCount,
				page.TotalCountIncluded,
			)
		}
		if len(page.Items) != 200 {
			t.Fatalf("sort=%s offset=%d items=%d want=200", sortKey, offset, len(page.Items))
		}
		return elapsed
	}

	for _, sortKey := range []string{"name", "updated", "size", "type"} {
		// Match the production count-once contract: the first generation range is
		// counted, while later viewport ranges reuse that count and omit COUNT(*).
		_ = measure(sortKey, 0, true)
		_ = measure(sortKey, logicalCount/2, false)

		firstSamples := make([]time.Duration, 0, samples)
		middleSamples := make([]time.Duration, 0, samples)
		for range samples {
			firstSamples = append(firstSamples, measure(sortKey, 0, true))
			middleSamples = append(middleSamples, measure(sortKey, logicalCount/2, false))
		}
		t.Logf(
			"FILEEXPLORER_DIRECTORY_SORT_100K_CURRENT sort=%s logical_count=%d page_size=200 first_counted_range_median=%s middle_count_free_range_median=%s samples=%d",
			sortKey,
			logicalCount,
			median(firstSamples),
			median(middleSamples),
			samples,
		)
	}

	const rankExpr = "(CASE WHEN xd_nodes.type = 'dir' THEN 0 ELSE 1 END)"
	const typeExpr = "(CASE WHEN xd_nodes.type = 'dir' THEN '' WHEN strpos(xd_nodes.name, '.') > 1 AND right(xd_nodes.name, 1) <> '.' THEN lower(regexp_replace(xd_nodes.name, '^.*\\.', '')) ELSE '' END)"

	runTypeQuery := func(sortExpr string, offset int, includeCount bool) ([]childrenPageRow, time.Duration) {
		selectClause := `SELECT xd_nodes.id, xd_nodes.parent_id, xd_nodes.name, xd_nodes.type,
			xd_nodes.revision, xd_nodes.created_at, xd_nodes.updated_at,
			COALESCE(child_file.size, 0) AS file_size,
			COALESCE(child_file.sha256, '') AS file_sha256`
		if includeCount {
			selectClause += ", COUNT(*) OVER() AS total_count"
		}
		statement := fmt.Sprintf(`%s
FROM xd_nodes
LEFT JOIN xd_files AS child_file ON child_file.node_id = xd_nodes.id
JOIN xd_nodes AS parent_node
	ON parent_node.id = ?
	AND parent_node.owner_id = ?
	AND parent_node.type = ?
	AND parent_node.deleted_at IS NULL
WHERE xd_nodes.owner_id = ?
	AND xd_nodes.parent_id = ?
	AND xd_nodes.deleted_at IS NULL
ORDER BY %s ASC, %s ASC, lower(xd_nodes.name) ASC, xd_nodes.id ASC
OFFSET ? LIMIT 200`, selectClause, rankExpr, sortExpr)

		var rows []childrenPageRow
		started := time.Now()
		if err := db.Raw(
			statement,
			root.ID,
			root.OwnerID,
			meta.NodeTypeDir,
			root.OwnerID,
			root.ID,
			offset,
		).Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		elapsed := time.Since(started)
		if len(rows) != 200 {
			t.Fatalf("type-sort offset=%d rows=%d want=200", offset, len(rows))
		}
		if includeCount && rows[0].TotalCount != logicalCount {
			t.Fatalf("type-sort offset=%d total_count=%d want=%d", offset, rows[0].TotalCount, logicalCount)
		}
		return rows, elapsed
	}

	idsOf := func(rows []childrenPageRow) []uint64 {
		out := make([]uint64, len(rows))
		for i := range rows {
			out[i] = rows[i].ID
		}
		return out
	}
	sameIDs := func(left, right []uint64) bool {
		if len(left) != len(right) {
			return false
		}
		for i := range left {
			if left[i] != right[i] {
				return false
			}
		}
		return true
	}
	type variantResult struct {
		first     time.Duration
		middle    time.Duration
		firstIDs  []uint64
		middleIDs []uint64
	}
	benchmarkVariant := func(label, sortExpr string) variantResult {
		firstWarm, _ := runTypeQuery(sortExpr, 0, true)
		middleWarm, _ := runTypeQuery(sortExpr, logicalCount/2, false)
		firstIDs := idsOf(firstWarm)
		middleIDs := idsOf(middleWarm)

		firstSamples := make([]time.Duration, 0, samples)
		middleSamples := make([]time.Duration, 0, samples)
		for range samples {
			firstRows, firstElapsed := runTypeQuery(sortExpr, 0, true)
			middleRows, middleElapsed := runTypeQuery(sortExpr, logicalCount/2, false)
			if !sameIDs(firstIDs, idsOf(firstRows)) || !sameIDs(middleIDs, idsOf(middleRows)) {
				t.Fatalf("type-sort variant=%s changed ordered node IDs between samples", label)
			}
			firstSamples = append(firstSamples, firstElapsed)
			middleSamples = append(middleSamples, middleElapsed)
		}
		result := variantResult{
			first:     median(firstSamples),
			middle:    median(middleSamples),
			firstIDs:  firstIDs,
			middleIDs: middleIDs,
		}
		t.Logf(
			"FILEEXPLORER_DIRECTORY_TYPE_SORT_100K variant=%s logical_count=%d page_size=200 first_counted_median=%s middle_count_free_median=%s samples=%d",
			label,
			logicalCount,
			result.first,
			result.middle,
			samples,
		)
		return result
	}

	baseline := benchmarkVariant("dynamic-expression", typeExpr)

	expressionIndexStarted := time.Now()
	if err := db.Exec(`
CREATE INDEX idx_xd_nodes_children_type_expr_bench
ON xd_nodes (
	owner_id,
	parent_id,
	((CASE WHEN type = 'dir' THEN 0 ELSE 1 END)),
	((CASE
		WHEN type = 'dir' THEN ''
		WHEN strpos(name, '.') > 1 AND right(name, 1) <> '.'
			THEN lower(regexp_replace(name, '^.*\.', ''))
		ELSE ''
	END)),
	lower(name),
	id
)
WHERE parent_id IS NOT NULL AND deleted_at IS NULL
`).Error; err != nil {
		t.Fatal(err)
	}
	expressionIndexBuild := time.Since(expressionIndexStarted)
	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	expressionIndexed := benchmarkVariant("expression-index", typeExpr)
	if !sameIDs(baseline.firstIDs, expressionIndexed.firstIDs) ||
		!sameIDs(baseline.middleIDs, expressionIndexed.middleIDs) {
		t.Fatal("expression index changed type-sort ordered node IDs")
	}

	if err := db.Exec("DROP INDEX idx_xd_nodes_children_type_expr_bench").Error; err != nil {
		t.Fatal(err)
	}

	persistedBackfillStarted := time.Now()
	if err := db.Exec("ALTER TABLE xd_nodes ADD COLUMN xdrive_type_sort_key text").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
UPDATE xd_nodes
SET xdrive_type_sort_key = CASE
	WHEN type = 'dir' THEN ''
	WHEN strpos(name, '.') > 1 AND right(name, 1) <> '.'
		THEN lower(regexp_replace(name, '^.*\.', ''))
	ELSE ''
END
`).Error; err != nil {
		t.Fatal(err)
	}
	persistedBackfill := time.Since(persistedBackfillStarted)

	persistedIndexStarted := time.Now()
	if err := db.Exec(`
CREATE INDEX idx_xd_nodes_children_type_key_bench
ON xd_nodes (
	owner_id,
	parent_id,
	((CASE WHEN type = 'dir' THEN 0 ELSE 1 END)),
	xdrive_type_sort_key,
	lower(name),
	id
)
WHERE parent_id IS NOT NULL AND deleted_at IS NULL
`).Error; err != nil {
		t.Fatal(err)
	}
	persistedIndexBuild := time.Since(persistedIndexStarted)
	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	persisted := benchmarkVariant("persisted-key-index", "xd_nodes.xdrive_type_sort_key")
	if !sameIDs(baseline.firstIDs, persisted.firstIDs) ||
		!sameIDs(baseline.middleIDs, persisted.middleIDs) {
		t.Fatal("persisted type-sort key changed ordered node IDs")
	}

	reduction := func(before, after time.Duration) float64 {
		return (1 - float64(after)/float64(before)) * 100
	}
	t.Logf(
		"FILEEXPLORER_DIRECTORY_TYPE_SORT_100K_AB baseline_first=%s expression_index_first=%s expression_index_first_delta_pct=%.2f persisted_first=%s persisted_first_delta_pct=%.2f baseline_middle=%s expression_index_middle=%s expression_index_middle_delta_pct=%.2f persisted_middle=%s persisted_middle_delta_pct=%.2f expression_index_build=%s persisted_backfill=%s persisted_index_build=%s",
		baseline.first,
		expressionIndexed.first,
		reduction(baseline.first, expressionIndexed.first),
		persisted.first,
		reduction(baseline.first, persisted.first),
		baseline.middle,
		expressionIndexed.middle,
		reduction(baseline.middle, expressionIndexed.middle),
		persisted.middle,
		reduction(baseline.middle, persisted.middle),
		expressionIndexBuild,
		persistedBackfill,
		persistedIndexBuild,
	)
}
