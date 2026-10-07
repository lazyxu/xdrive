package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	fileExplorerMediaPerfLogicalCount = 100_000
	fileExplorerMediaPerfVariants     = 128
	fileExplorerMediaPerfSamplePerRun = 34
	fileExplorerMediaPerfConcurrency  = 6
)

type fileExplorerMediaPerfStore struct {
	inner storage.Store

	originalOpenSuccess   atomic.Int64
	derivativeOpenSuccess atomic.Int64
	derivativePutSuccess  atomic.Int64
}

type fileExplorerMediaPerfStoreSnapshot struct {
	OriginalOpenSuccess   int64
	DerivativeOpenSuccess int64
	DerivativePutSuccess  int64
}

func (s *fileExplorerMediaPerfStore) Put(
	ctx context.Context,
	key string,
	reader io.Reader,
) (int64, error) {
	written, err := s.inner.Put(ctx, key, reader)
	if err == nil && strings.HasPrefix(key, mediapkg.ThumbnailStoragePrefix) {
		s.derivativePutSuccess.Add(1)
	}
	return written, err
}

func (s *fileExplorerMediaPerfStore) Open(
	ctx context.Context,
	key string,
) (*os.File, error) {
	file, err := s.inner.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(key, mediapkg.ThumbnailStoragePrefix) {
		s.derivativeOpenSuccess.Add(1)
	} else {
		s.originalOpenSuccess.Add(1)
	}
	return file, nil
}

func (s *fileExplorerMediaPerfStore) Delete(
	ctx context.Context,
	key string,
) error {
	return s.inner.Delete(ctx, key)
}

func (s *fileExplorerMediaPerfStore) Reset() {
	s.originalOpenSuccess.Store(0)
	s.derivativeOpenSuccess.Store(0)
	s.derivativePutSuccess.Store(0)
}

func (s *fileExplorerMediaPerfStore) Snapshot() fileExplorerMediaPerfStoreSnapshot {
	return fileExplorerMediaPerfStoreSnapshot{
		OriginalOpenSuccess:   s.originalOpenSuccess.Load(),
		DerivativeOpenSuccess: s.derivativeOpenSuccess.Load(),
		DerivativePutSuccess:  s.derivativePutSuccess.Load(),
	}
}

type fileExplorerMediaPerfThumbnailMetrics struct {
	RequestCount    int
	PeakConcurrency int64
	TotalBytes      int64
	TotalDuration   time.Duration
	P50Latency      time.Duration
	P95Latency      time.Duration
}

func TestFileExplorerMediaServerObjectStorePerformance100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_MEDIA_SERVER_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_MEDIA_SERVER_PERF=1 to run the real Server/object-store media benchmark")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.AuditEvent{},
		&meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	countingStore := &fileExplorerMediaPerfStore{inner: local}

	scheduler := background.NewScheduler(
		context.Background(),
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: fileExplorerMediaPerfConcurrency,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 256,
			},
		},
	)
	defer scheduler.Close()

	server := &Server{
		DB:                  db,
		Store:               countingStore,
		Auth:                auth.New("file-explorer-media-perf-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      16 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "file-explorer-media-perf", "password-media-perf")
	rootDTO := requestNode(
		t,
		router,
		http.MethodGet,
		"/api/v1/nodes/root",
		token,
		nil,
		http.StatusOK,
	)
	imageFolder := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootDTO.ID),
		token,
		strings.NewReader(`{"name":"100k Images"}`),
		http.StatusCreated,
	)
	videoFolder := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootDTO.ID),
		token,
		strings.NewReader(`{"name":"100k Videos"}`),
		http.StatusCreated,
	)

	var root meta.Node
	if err := db.First(&root, rootDTO.ID).Error; err != nil {
		t.Fatal(err)
	}

	variants := fileExplorerMediaPerfSeedImageVariants(t, countingStore)
	fileExplorerMediaPerfSeedNamespace(
		t,
		db,
		root.OwnerID,
		imageFolder.ID,
		videoFolder.ID,
		variants,
	)
	countingStore.Reset()

	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 60 * time.Second}

	imageRangeMedians := fileExplorerMediaPerfMeasureRanges(
		t,
		client,
		httpServer.URL,
		token,
		imageFolder.ID,
	)
	videoRangeMedians := fileExplorerMediaPerfMeasureRanges(
		t,
		client,
		httpServer.URL,
		token,
		videoFolder.ID,
	)

	sampleOffsets := []int{0, 50_000, 99_746}
	sampleIDs := make([]uint64, 0, len(sampleOffsets)*fileExplorerMediaPerfSamplePerRun)
	for _, offset := range sampleOffsets {
		page, _ := fileExplorerMediaPerfListRange(
			t,
			client,
			httpServer.URL,
			token,
			imageFolder.ID,
			offset,
		)
		if len(page.Items) < fileExplorerMediaPerfSamplePerRun {
			t.Fatalf("image sample offset=%d items=%d want>=%d", offset, len(page.Items), fileExplorerMediaPerfSamplePerRun)
		}
		for _, item := range page.Items[:fileExplorerMediaPerfSamplePerRun] {
			sampleIDs = append(sampleIDs, item.ID)
		}
	}
	if got, want := len(sampleIDs), 102; got != want {
		t.Fatalf("sample ids=%d want=%d", got, want)
	}

	var uniqueSampleObjects int64
	if err := db.Model(&meta.File{}).
		Where("node_id IN ?", sampleIDs).
		Distinct("sha256").
		Count(&uniqueSampleObjects).Error; err != nil {
		t.Fatal(err)
	}
	if uniqueSampleObjects != int64(len(sampleIDs)) {
		t.Fatalf(
			"sample object mapping is not unique: distinct_sha=%d samples=%d",
			uniqueSampleObjects,
			len(sampleIDs),
		)
	}

	countingStore.Reset()
	coldMetrics, err := fileExplorerMediaPerfFetchThumbnails(
		client,
		httpServer.URL,
		token,
		sampleIDs,
		fileExplorerMediaPerfConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	coldStore := countingStore.Snapshot()
	if coldMetrics.RequestCount != len(sampleIDs) {
		t.Fatalf("cold requests=%d want=%d", coldMetrics.RequestCount, len(sampleIDs))
	}
	if coldMetrics.PeakConcurrency > fileExplorerMediaPerfConcurrency {
		t.Fatalf(
			"cold HTTP concurrency=%d exceeds=%d",
			coldMetrics.PeakConcurrency,
			fileExplorerMediaPerfConcurrency,
		)
	}
	if coldStore.OriginalOpenSuccess != int64(len(sampleIDs)) {
		t.Fatalf(
			"cold original opens=%d want=%d",
			coldStore.OriginalOpenSuccess,
			len(sampleIDs),
		)
	}
	if coldStore.DerivativePutSuccess != int64(len(sampleIDs)) {
		t.Fatalf(
			"cold derivative puts=%d want=%d",
			coldStore.DerivativePutSuccess,
			len(sampleIDs),
		)
	}

	countingStore.Reset()
	warmMetrics, err := fileExplorerMediaPerfFetchThumbnails(
		client,
		httpServer.URL,
		token,
		sampleIDs,
		fileExplorerMediaPerfConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	warmStore := countingStore.Snapshot()
	if warmMetrics.RequestCount != len(sampleIDs) {
		t.Fatalf("warm requests=%d want=%d", warmMetrics.RequestCount, len(sampleIDs))
	}
	if warmMetrics.PeakConcurrency > fileExplorerMediaPerfConcurrency {
		t.Fatalf(
			"warm HTTP concurrency=%d exceeds=%d",
			warmMetrics.PeakConcurrency,
			fileExplorerMediaPerfConcurrency,
		)
	}
	if warmStore.OriginalOpenSuccess != 0 {
		t.Fatalf("warm original opens=%d want=0", warmStore.OriginalOpenSuccess)
	}
	if warmStore.DerivativePutSuccess != 0 {
		t.Fatalf("warm derivative puts=%d want=0", warmStore.DerivativePutSuccess)
	}
	if warmStore.DerivativeOpenSuccess < int64(len(sampleIDs)) {
		t.Fatalf(
			"warm derivative opens=%d want>=%d",
			warmStore.DerivativeOpenSuccess,
			len(sampleIDs),
		)
	}
	if warmMetrics.TotalBytes != coldMetrics.TotalBytes {
		t.Fatalf(
			"warm bytes=%d differ from cold bytes=%d",
			warmMetrics.TotalBytes,
			coldMetrics.TotalBytes,
		)
	}

	countingStore.Reset()
	videoProbe, _ := fileExplorerMediaPerfListRange(
		t,
		client,
		httpServer.URL,
		token,
		videoFolder.ID,
		50_000,
	)
	if len(videoProbe.Items) != 200 {
		t.Fatalf("video middle range items=%d want=200", len(videoProbe.Items))
	}
	for _, item := range videoProbe.Items {
		if !strings.HasSuffix(strings.ToLower(item.Name), ".mp4") {
			t.Fatalf("video icon-fallback namespace contains non-video item %q", item.Name)
		}
	}
	videoStore := countingStore.Snapshot()
	if videoStore != (fileExplorerMediaPerfStoreSnapshot{}) {
		t.Fatalf("video icon fallback unexpectedly touched object storage: %+v", videoStore)
	}

	t.Logf(
		"FILEEXPLORER_MEDIA_SERVER_100K scenario=image-cold logical_count=%d sample_requests=%d unique_originals=%d http_concurrency=%d first_range_median_ms=%.3f middle_range_median_ms=%.3f end_range_median_ms=%.3f thumbnail_total_ms=%.3f thumbnail_p50_ms=%.3f thumbnail_p95_ms=%.3f response_bytes=%d original_store_opens=%d derivative_store_opens=%d derivative_puts=%d",
		fileExplorerMediaPerfLogicalCount,
		coldMetrics.RequestCount,
		uniqueSampleObjects,
		coldMetrics.PeakConcurrency,
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[0]),
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[1]),
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[2]),
		fileExplorerMediaPerfMilliseconds(coldMetrics.TotalDuration),
		fileExplorerMediaPerfMilliseconds(coldMetrics.P50Latency),
		fileExplorerMediaPerfMilliseconds(coldMetrics.P95Latency),
		coldMetrics.TotalBytes,
		coldStore.OriginalOpenSuccess,
		coldStore.DerivativeOpenSuccess,
		coldStore.DerivativePutSuccess,
	)
	t.Logf(
		"FILEEXPLORER_MEDIA_SERVER_100K scenario=image-warm logical_count=%d sample_requests=%d unique_originals=%d http_concurrency=%d first_range_median_ms=%.3f middle_range_median_ms=%.3f end_range_median_ms=%.3f thumbnail_total_ms=%.3f thumbnail_p50_ms=%.3f thumbnail_p95_ms=%.3f response_bytes=%d original_store_opens=%d derivative_store_opens=%d derivative_puts=%d",
		fileExplorerMediaPerfLogicalCount,
		warmMetrics.RequestCount,
		uniqueSampleObjects,
		warmMetrics.PeakConcurrency,
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[0]),
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[1]),
		fileExplorerMediaPerfMilliseconds(imageRangeMedians[2]),
		fileExplorerMediaPerfMilliseconds(warmMetrics.TotalDuration),
		fileExplorerMediaPerfMilliseconds(warmMetrics.P50Latency),
		fileExplorerMediaPerfMilliseconds(warmMetrics.P95Latency),
		warmMetrics.TotalBytes,
		warmStore.OriginalOpenSuccess,
		warmStore.DerivativeOpenSuccess,
		warmStore.DerivativePutSuccess,
	)
	t.Logf(
		"FILEEXPLORER_MEDIA_SERVER_100K scenario=video-icons logical_count=%d thumbnail_requests=0 first_range_median_ms=%.3f middle_range_median_ms=%.3f end_range_median_ms=%.3f object_store_opens=0 derivative_puts=0",
		fileExplorerMediaPerfLogicalCount,
		fileExplorerMediaPerfMilliseconds(videoRangeMedians[0]),
		fileExplorerMediaPerfMilliseconds(videoRangeMedians[1]),
		fileExplorerMediaPerfMilliseconds(videoRangeMedians[2]),
	)
}

func fileExplorerMediaPerfDatabase(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(8)
	baseSQL.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "media_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	sqlDB.SetMaxOpenConns(16)
	sqlDB.SetMaxIdleConns(8)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

type fileExplorerMediaPerfVariant struct {
	SHA256     string
	StorageKey string
	Size       int64
}

func fileExplorerMediaPerfSeedImageVariants(
	t *testing.T,
	store *fileExplorerMediaPerfStore,
) []fileExplorerMediaPerfVariant {
	t.Helper()
	variants := make([]fileExplorerMediaPerfVariant, 0, fileExplorerMediaPerfVariants)
	for variant := 0; variant < fileExplorerMediaPerfVariants; variant++ {
		data := fileExplorerMediaPerfJPEG(t, variant)
		sum := sha256.Sum256(data)
		hash := fmt.Sprintf("%x", sum[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		written, err := store.Put(context.Background(), key, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if written != int64(len(data)) {
			t.Fatalf("variant=%d written=%d want=%d", variant, written, len(data))
		}
		variants = append(variants, fileExplorerMediaPerfVariant{
			SHA256:     hash,
			StorageKey: key,
			Size:       int64(len(data)),
		})
	}
	return variants
}

func fileExplorerMediaPerfJPEG(t *testing.T, seed int) []byte {
	t.Helper()
	const width, height = 800, 600
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x + seed*17) % 256),
				G: uint8((y*2 + seed*29) % 256),
				B: uint8((x/3 + y/5 + seed*43) % 256),
				A: 255,
			})
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 88}); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func fileExplorerMediaPerfSeedNamespace(
	t *testing.T,
	db *gorm.DB,
	ownerID, imageFolderID, videoFolderID uint64,
	variants []fileExplorerMediaPerfVariant,
) {
	t.Helper()
	if len(variants) != fileExplorerMediaPerfVariants {
		t.Fatalf("variants=%d want=%d", len(variants), fileExplorerMediaPerfVariants)
	}
	if err := db.Exec(`
CREATE TEMP TABLE file_explorer_media_perf_variants (
	variant INTEGER PRIMARY KEY,
	sha256 TEXT NOT NULL,
	storage_key TEXT NOT NULL,
	size BIGINT NOT NULL
)
`).Error; err != nil {
		t.Fatal(err)
	}
	for index, variant := range variants {
		if err := db.Exec(
			"INSERT INTO file_explorer_media_perf_variants(variant, sha256, storage_key, size) VALUES (?, ?, ?, ?)",
			index,
			variant.SHA256,
			variant.StorageKey,
			variant.Size,
		).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := db.Exec(`
INSERT INTO xd_nodes (
	parent_id, name, type, owner_id, revision, created_at, updated_at
)
SELECT
	?,
	'image-' || lpad(gs::text, 6, '0') || '.jpg',
	'file',
	?,
	1,
	NOW(),
	NOW()
FROM generate_series(1, ?) AS gs
`, imageFolderID, ownerID, fileExplorerMediaPerfLogicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (
	node_id, size, storage_key, sha256, created_at, updated_at
)
SELECT
	n.id,
	v.size,
	v.storage_key,
	v.sha256,
	NOW(),
	NOW()
FROM xd_nodes AS n
JOIN file_explorer_media_perf_variants AS v
	ON v.variant = ((substring(n.name from 7 for 6)::integer - 1) % ?)
WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL
`, fileExplorerMediaPerfVariants, ownerID, imageFolderID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_media_metadata (
	node_id, owner_id, node_revision, sha256, media_kind, mime_type,
	relation_evidence_version, width, height, orientation,
	index_state, created_at, updated_at
)
SELECT
	n.id,
	n.owner_id,
	n.revision,
	f.sha256,
	?,
	'image/jpeg',
	?,
	800,
	600,
	1,
	?,
	NOW(),
	NOW()
FROM xd_nodes AS n
JOIN xd_files AS f ON f.node_id = n.id
WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL
`,
		meta.MediaKindImage,
		mediapkg.RelationEvidenceVersion,
		meta.MediaIndexStateReady,
		ownerID,
		imageFolderID,
	).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Exec(`
INSERT INTO xd_nodes (
	parent_id, name, type, owner_id, revision, created_at, updated_at
)
SELECT
	?,
	'video-' || lpad(gs::text, 6, '0') || '.mp4',
	'file',
	?,
	1,
	NOW(),
	NOW()
FROM generate_series(1, ?) AS gs
`, videoFolderID, ownerID, fileExplorerMediaPerfLogicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (
	node_id, size, storage_key, sha256, created_at, updated_at
)
SELECT
	n.id,
	20971520 + ((substring(n.name from 7 for 6)::bigint - 1) % 97) * 4096,
	'perf-video-icon-fallback',
	'',
	NOW(),
	NOW()
FROM xd_nodes AS n
WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL
`, ownerID, videoFolderID).Error; err != nil {
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
	for _, table := range []string{"xd_nodes", "xd_files", "xd_media_metadata"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func fileExplorerMediaPerfMeasureRanges(
	t *testing.T,
	client *http.Client,
	baseURL, token string,
	parentID uint64,
) [3]time.Duration {
	t.Helper()
	offsets := [3]int{0, 50_000, 99_800}
	var out [3]time.Duration
	for index, offset := range offsets {
		_, _ = fileExplorerMediaPerfListRange(
			t,
			client,
			baseURL,
			token,
			parentID,
			offset,
		)
		samples := make([]time.Duration, 0, 3)
		for range 3 {
			_, elapsed := fileExplorerMediaPerfListRange(
				t,
				client,
				baseURL,
				token,
				parentID,
				offset,
			)
			samples = append(samples, elapsed)
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		out[index] = samples[len(samples)/2]
	}
	return out
}

func fileExplorerMediaPerfListRange(
	t *testing.T,
	client *http.Client,
	baseURL, token string,
	parentID uint64,
	offset int,
) (childrenRangeDTO, time.Duration) {
	t.Helper()
	path := fmt.Sprintf(
		"%s/api/v1/nodes/%d/children?offset=%d&limit=200&sort=name&order=asc",
		baseURL,
		parentID,
		offset,
	)
	req, err := http.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	started := time.Now()
	response, err := client.Do(req)
	elapsed := time.Since(started)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list range status=%d body=%s", response.StatusCode, string(body))
	}
	var page childrenRangeDTO
	if err := json.Unmarshal(body, &page); err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != fileExplorerMediaPerfLogicalCount {
		t.Fatalf(
			"parent=%d offset=%d total_count=%d want=%d",
			parentID,
			offset,
			page.TotalCount,
			fileExplorerMediaPerfLogicalCount,
		)
	}
	if len(page.Items) != 200 {
		t.Fatalf("parent=%d offset=%d items=%d want=200", parentID, offset, len(page.Items))
	}
	return page, elapsed
}

func fileExplorerMediaPerfFetchThumbnails(
	client *http.Client,
	baseURL, token string,
	nodeIDs []uint64,
	concurrency int,
) (fileExplorerMediaPerfThumbnailMetrics, error) {
	if concurrency < 1 {
		concurrency = 1
	}
	type thumbnailResult struct {
		latency time.Duration
		bytes   int64
		err     error
	}
	jobs := make(chan uint64)
	results := make(chan thumbnailResult, len(nodeIDs))
	var active atomic.Int64
	var peak atomic.Int64
	var workers sync.WaitGroup

	for range concurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for nodeID := range jobs {
				current := active.Add(1)
				for {
					observed := peak.Load()
					if current <= observed || peak.CompareAndSwap(observed, current) {
						break
					}
				}
				started := time.Now()
				path := fmt.Sprintf(
					"%s/api/v1/media/items/%d/thumbnail",
					baseURL,
					nodeID,
				)
				req, err := http.NewRequest(http.MethodGet, path, nil)
				if err == nil {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				var size int64
				if err == nil {
					var response *http.Response
					response, err = client.Do(req)
					if err == nil {
						body, readErr := io.ReadAll(response.Body)
						_ = response.Body.Close()
						if readErr != nil {
							err = readErr
						} else if response.StatusCode != http.StatusOK {
							err = fmt.Errorf(
								"thumbnail node=%d status=%d body=%s",
								nodeID,
								response.StatusCode,
								string(body),
							)
						} else if contentType := response.Header.Get("Content-Type"); contentType != "image/jpeg" {
							err = fmt.Errorf(
								"thumbnail node=%d content-type=%q",
								nodeID,
								contentType,
							)
						} else {
							size = int64(len(body))
						}
					}
				}
				latency := time.Since(started)
				active.Add(-1)
				results <- thumbnailResult{latency: latency, bytes: size, err: err}
			}
		}()
	}

	started := time.Now()
	go func() {
		for _, nodeID := range nodeIDs {
			jobs <- nodeID
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()

	latencies := make([]time.Duration, 0, len(nodeIDs))
	var totalBytes int64
	for result := range results {
		if result.err != nil {
			return fileExplorerMediaPerfThumbnailMetrics{}, result.err
		}
		latencies = append(latencies, result.latency)
		totalBytes += result.bytes
	}
	totalDuration := time.Since(started)
	if len(latencies) != len(nodeIDs) {
		return fileExplorerMediaPerfThumbnailMetrics{}, fmt.Errorf(
			"thumbnail results=%d want=%d",
			len(latencies),
			len(nodeIDs),
		)
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	return fileExplorerMediaPerfThumbnailMetrics{
		RequestCount:    len(latencies),
		PeakConcurrency: peak.Load(),
		TotalBytes:      totalBytes,
		TotalDuration:   totalDuration,
		P50Latency:      fileExplorerMediaPerfPercentile(latencies, 50),
		P95Latency:      fileExplorerMediaPerfPercentile(latencies, 95),
	}, nil
}

func fileExplorerMediaPerfPercentile(
	values []time.Duration,
	percent int,
) time.Duration {
	if len(values) == 0 {
		return 0
	}
	index := (len(values)*percent + 99) / 100
	if index < 1 {
		index = 1
	}
	if index > len(values) {
		index = len(values)
	}
	return values[index-1]
}

func fileExplorerMediaPerfMilliseconds(value time.Duration) float64 {
	return float64(value.Microseconds()) / 1000
}
