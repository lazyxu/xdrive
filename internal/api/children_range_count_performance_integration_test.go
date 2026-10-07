package api

import (
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	fileExplorerRangeCountPerfLogicalCount = 100_000
	fileExplorerRangeCountPerfPageSize     = 200
	fileExplorerRangeCountPerfRanges       = 20
	fileExplorerRangeCountPerfSamples      = 3
)

func TestFileExplorerRangeCountPerformanceBaseline100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_RANGE_COUNT_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_RANGE_COUNT_PERF=1 to run the 100k sparse-range count A/B workload")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	db := fileExplorerRangeCountPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
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

	user := meta.User{
		Username:       "range-count-perf",
		PasswordHash:   "not-used",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name:     "",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(`
INSERT INTO xd_nodes (
	parent_id, name, type, owner_id, revision, created_at, updated_at
)
SELECT
	?,
	'item-' || lpad(gs::text, 6, '0') ||
		CASE (gs % 4)
			WHEN 0 THEN '.jpg'
			WHEN 1 THEN '.txt'
			WHEN 2 THEN '.pdf'
			ELSE '.zip'
		END,
	'file',
	?,
	1,
	TIMESTAMPTZ '2026-10-07 00:00:00+00',
	TIMESTAMPTZ '2026-10-07 00:00:00+00'
FROM generate_series(1, ?) AS gs
`, root.ID, user.ID, fileExplorerRangeCountPerfLogicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (
	node_id, size, storage_key, sha256, created_at, updated_at
)
SELECT
	n.id,
	((n.id * 7919) % 100000000) + 1,
	'range-count-perf/' || n.id,
	'',
	n.created_at,
	n.updated_at
FROM xd_nodes AS n
WHERE n.owner_id = ? AND n.parent_id = ? AND n.type = 'file' AND n.deleted_at IS NULL
`, user.ID, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_files"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}

	offsets := make([]int, 0, fileExplorerRangeCountPerfRanges)
	const stride = fileExplorerRangeCountPerfLogicalCount / fileExplorerRangeCountPerfRanges
	for index := 0; index < fileExplorerRangeCountPerfRanges; index++ {
		offset := fileExplorerRangeCountPerfPageSize + index*stride
		if offset+fileExplorerRangeCountPerfPageSize > fileExplorerRangeCountPerfLogicalCount {
			offset = fileExplorerRangeCountPerfLogicalCount - fileExplorerRangeCountPerfPageSize
		}
		offsets = append(offsets, offset)
	}

	readRange := func(offset int, counted bool) ([]childrenPageRow, error) {
		selectClause := `xd_nodes.id, xd_nodes.parent_id, xd_nodes.name, xd_nodes.type,
			xd_nodes.revision, xd_nodes.created_at, xd_nodes.updated_at,
			COALESCE(child_file.size, 0) AS file_size,
			COALESCE(child_file.sha256, '') AS file_sha256`
		if counted {
			selectClause += ", COUNT(*) OVER() AS total_count"
		}
		var rows []childrenPageRow
		err := db.
			Table("xd_nodes").
			Select(selectClause).
			Joins("LEFT JOIN xd_files AS child_file ON child_file.node_id = xd_nodes.id").
			Joins(`JOIN xd_nodes AS parent_node
				ON parent_node.id = ?
				AND parent_node.owner_id = ?
				AND parent_node.type = ?
				AND parent_node.deleted_at IS NULL`,
				root.ID,
				user.ID,
				meta.NodeTypeDir,
			).
			Where(
				"xd_nodes.owner_id = ? AND xd_nodes.parent_id = ? AND xd_nodes.deleted_at IS NULL",
				user.ID,
				root.ID,
			).
			Order("(CASE WHEN xd_nodes.type = 'dir' THEN 0 ELSE 1 END) ASC, lower(xd_nodes.name) ASC, lower(xd_nodes.name) ASC, xd_nodes.id ASC").
			Offset(offset).
			Limit(fileExplorerRangeCountPerfPageSize).
			Scan(&rows).Error
		return rows, err
	}

	// Validate the paired query shape before timing it. The candidate is useful
	// only if removing COUNT(*) OVER() preserves the exact row window.
	for _, offset := range offsets {
		countedRows, err := readRange(offset, true)
		if err != nil {
			t.Fatal(err)
		}
		rowsOnly, err := readRange(offset, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(countedRows) != fileExplorerRangeCountPerfPageSize ||
			len(rowsOnly) != fileExplorerRangeCountPerfPageSize {
			t.Fatalf(
				"offset=%d counted=%d rows_only=%d want=%d",
				offset,
				len(countedRows),
				len(rowsOnly),
				fileExplorerRangeCountPerfPageSize,
			)
		}
		if countedRows[0].TotalCount != fileExplorerRangeCountPerfLogicalCount {
			t.Fatalf(
				"offset=%d total_count=%d want=%d",
				offset,
				countedRows[0].TotalCount,
				fileExplorerRangeCountPerfLogicalCount,
			)
		}
		for index := range countedRows {
			if countedRows[index].ID != rowsOnly[index].ID {
				t.Fatalf(
					"offset=%d index=%d counted_id=%d rows_only_id=%d",
					offset,
					index,
					countedRows[index].ID,
					rowsOnly[index].ID,
				)
			}
		}
	}

	// Warm the first-page count and both subsequent-range query paths.
	_, _ = readRange(0, true)
	for _, offset := range offsets {
		_, _ = readRange(offset, true)
		_, _ = readRange(offset, false)
	}

	measureOne := func(offset int, counted bool) time.Duration {
		started := time.Now()
		rows, err := readRange(offset, counted)
		elapsed := time.Since(started)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != fileExplorerRangeCountPerfPageSize {
			t.Fatalf(
				"offset=%d counted=%t rows=%d want=%d",
				offset,
				counted,
				len(rows),
				fileExplorerRangeCountPerfPageSize,
			)
		}
		if counted && rows[0].TotalCount != fileExplorerRangeCountPerfLogicalCount {
			t.Fatalf(
				"offset=%d counted total=%d want=%d",
				offset,
				rows[0].TotalCount,
				fileExplorerRangeCountPerfLogicalCount,
			)
		}
		return elapsed
	}
	measureBatch := func(counted bool) time.Duration {
		started := time.Now()
		for _, offset := range offsets {
			rows, err := readRange(offset, counted)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != fileExplorerRangeCountPerfPageSize {
				t.Fatalf(
					"offset=%d counted=%t rows=%d want=%d",
					offset,
					counted,
					len(rows),
					fileExplorerRangeCountPerfPageSize,
				)
			}
		}
		return time.Since(started)
	}

	sequentialOffsets := make([]int, 0, fileExplorerRangeCountPerfRanges)
	for page := 1; page <= fileExplorerRangeCountPerfRanges; page++ {
		sequentialOffsets = append(
			sequentialOffsets,
			page*fileExplorerRangeCountPerfPageSize,
		)
	}
	measureSequentialSession := func(countEveryPage bool) time.Duration {
		started := time.Now()
		firstRows, err := readRange(0, true)
		if err != nil {
			t.Fatal(err)
		}
		if len(firstRows) != fileExplorerRangeCountPerfPageSize ||
			firstRows[0].TotalCount != fileExplorerRangeCountPerfLogicalCount {
			t.Fatalf(
				"sequential first range rows=%d total=%d",
				len(firstRows),
				firstRows[0].TotalCount,
			)
		}
		for _, offset := range sequentialOffsets {
			rows, err := readRange(offset, countEveryPage)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != fileExplorerRangeCountPerfPageSize {
				t.Fatalf(
					"sequential offset=%d counted=%t rows=%d want=%d",
					offset,
					countEveryPage,
					len(rows),
					fileExplorerRangeCountPerfPageSize,
				)
			}
		}
		return time.Since(started)
	}
	median := func(values []time.Duration) time.Duration {
		copied := append([]time.Duration(nil), values...)
		sort.Slice(copied, func(i, j int) bool { return copied[i] < copied[j] })
		return copied[len(copied)/2]
	}

	firstCounted := make([]time.Duration, 0, fileExplorerRangeCountPerfSamples)
	countedBatches := make([]time.Duration, 0, fileExplorerRangeCountPerfSamples)
	rowsOnlyBatches := make([]time.Duration, 0, fileExplorerRangeCountPerfSamples)
	countEverySequential := make([]time.Duration, 0, fileExplorerRangeCountPerfSamples)
	countOnceSequential := make([]time.Duration, 0, fileExplorerRangeCountPerfSamples)
	for sample := 0; sample < fileExplorerRangeCountPerfSamples; sample++ {
		firstCounted = append(firstCounted, measureOne(0, true))
		if sample%2 == 0 {
			countedBatches = append(countedBatches, measureBatch(true))
			rowsOnlyBatches = append(rowsOnlyBatches, measureBatch(false))
		} else {
			rowsOnlyBatches = append(rowsOnlyBatches, measureBatch(false))
			countedBatches = append(countedBatches, measureBatch(true))
		}
		if sample%2 == 0 {
			countEverySequential = append(
				countEverySequential,
				measureSequentialSession(true),
			)
			countOnceSequential = append(
				countOnceSequential,
				measureSequentialSession(false),
			)
		} else {
			countOnceSequential = append(
				countOnceSequential,
				measureSequentialSession(false),
			)
			countEverySequential = append(
				countEverySequential,
				measureSequentialSession(true),
			)
		}
	}

	firstMedian := median(firstCounted)
	countedMedian := median(countedBatches)
	rowsOnlyMedian := median(rowsOnlyBatches)
	delta := 0.0
	if countedMedian > 0 {
		delta = 100 * (1 - float64(rowsOnlyMedian)/float64(countedMedian))
	}
	t.Logf(
		"FILEEXPLORER_RANGE_COUNT_100K logical_count=%d page_size=%d ranges=%d samples=%d first_counted_median_ms=%.3f counted_batch_median_ms=%.3f rows_only_batch_median_ms=%.3f counted_per_range_ms=%.3f rows_only_per_range_ms=%.3f rows_only_reduction_pct=%.2f counted_samples_ms=%s rows_only_samples_ms=%s offsets=%s",
		fileExplorerRangeCountPerfLogicalCount,
		fileExplorerRangeCountPerfPageSize,
		len(offsets),
		fileExplorerRangeCountPerfSamples,
		fileExplorerRangeCountPerfMilliseconds(firstMedian),
		fileExplorerRangeCountPerfMilliseconds(countedMedian),
		fileExplorerRangeCountPerfMilliseconds(rowsOnlyMedian),
		fileExplorerRangeCountPerfMilliseconds(countedMedian)/float64(len(offsets)),
		fileExplorerRangeCountPerfMilliseconds(rowsOnlyMedian)/float64(len(offsets)),
		delta,
		fileExplorerRangeCountPerfDurations(countedBatches),
		fileExplorerRangeCountPerfDurations(rowsOnlyBatches),
		fileExplorerRangeCountPerfOffsets(offsets),
	)

	countEverySequentialMedian := median(countEverySequential)
	countOnceSequentialMedian := median(countOnceSequential)
	sequentialDelta := 0.0
	if countEverySequentialMedian > 0 {
		sequentialDelta = 100 * (1 -
			float64(countOnceSequentialMedian)/float64(countEverySequentialMedian))
	}
	t.Logf(
		"FILEEXPLORER_RANGE_COUNT_100K_SEQUENTIAL logical_count=%d page_size=%d subsequent_ranges=%d samples=%d count_every_page_median_ms=%.3f count_once_median_ms=%.3f count_once_reduction_pct=%.2f count_every_samples_ms=%s count_once_samples_ms=%s offsets=%s",
		fileExplorerRangeCountPerfLogicalCount,
		fileExplorerRangeCountPerfPageSize,
		len(sequentialOffsets),
		fileExplorerRangeCountPerfSamples,
		fileExplorerRangeCountPerfMilliseconds(countEverySequentialMedian),
		fileExplorerRangeCountPerfMilliseconds(countOnceSequentialMedian),
		sequentialDelta,
		fileExplorerRangeCountPerfDurations(countEverySequential),
		fileExplorerRangeCountPerfDurations(countOnceSequential),
		fileExplorerRangeCountPerfOffsets(sequentialOffsets),
	)
}

func fileExplorerRangeCountPerfDatabase(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
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

	schema := "range_count_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
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
	return db
}

func fileExplorerRangeCountPerfMilliseconds(value time.Duration) float64 {
	return float64(value.Microseconds()) / 1000
}

func fileExplorerRangeCountPerfDurations(values []time.Duration) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("%.3f", fileExplorerRangeCountPerfMilliseconds(value)))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func fileExplorerRangeCountPerfOffsets(offsets []int) string {
	parts := make([]string, 0, len(offsets))
	for _, offset := range offsets {
		parts = append(parts, fmt.Sprintf("%d", offset))
	}
	return "[" + strings.Join(parts, ",") + "]"
}
