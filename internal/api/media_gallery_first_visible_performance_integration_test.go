package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const (
	galleryFirstVisibleViewport             = 56
	galleryFirstVisibleThumbnailConcurrency = 6
	galleryFirstVisibleVideoConcurrency     = 3
	galleryFirstVisibleImageVariants        = 64
	galleryFirstVisibleVideoMP4Base64       = "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"
)

type galleryFirstVisibleRequestMetrics struct {
	RequestCount       int
	PeakConcurrency    int64
	TotalBytes         int64
	FirstVisible       time.Duration
	FirstTwelveVisible time.Duration
	TotalDuration      time.Duration
	P50Latency         time.Duration
	P95Latency         time.Duration
}

func TestMediaGalleryFirstVisiblePerformance100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_FIRST_VISIBLE_PERF") != "1" {
		t.Skip("set XD_GALLERY_FIRST_VISIBLE_PERF=1 to run the 100k Gallery first-visible benchmark")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.AuditEvent{},
		&meta.Source{},
		&meta.SourceItem{},
		&meta.SourceCollection{},
		&meta.SourceCollectionItem{},
		&meta.MediaMetadata{},
		&meta.MediaDerivedResource{},
		&meta.MediaGroup{},
		&meta.MediaGroupItem{},
		&meta.PhotoAsset{},
		&meta.PhotoResource{},
		&meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{},
		&meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{},
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
				background.ResourceMediaCPU: galleryFirstVisibleThumbnailConcurrency,
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
		Auth:                auth.New("gallery-first-visible-perf-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      16 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "gallery-first-visible-perf", "password-gallery-first-visible")
	rootDTO := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folderDTO := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootDTO.ID),
		token,
		strings.NewReader("{\"name\":\"100k Gallery Visible\"}"),
		http.StatusCreated,
	)
	var root meta.Node
	if err := db.First(&root, rootDTO.ID).Error; err != nil {
		t.Fatal(err)
	}

	mediaGallerySeedFirstOpen100K(t, db, root.OwnerID, folderDTO.ID)

	rangeStarted := time.Now()
	page, err := server.queryMediaItemRange(
		context.Background(),
		root.OwnerID,
		mediaQueryOptions{},
		"",
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	rangeElapsed := time.Since(rangeStarted)
	if len(page.Items) < galleryFirstVisibleViewport {
		t.Fatalf("first range items=%d want>=%d", len(page.Items), galleryFirstVisibleViewport)
	}
	viewport := append([]mediaItemDTO(nil), page.Items[:galleryFirstVisibleViewport]...)

	imageIDs, videoIDs, liveCount := galleryFirstVisibleSeedObjects(
		t,
		db,
		countingStore,
		viewport,
	)
	if len(imageIDs) == 0 || len(videoIDs) == 0 || liveCount == 0 {
		t.Fatalf(
			"first viewport is not mixed: image_like=%d videos=%d live=%d",
			len(imageIDs),
			len(videoIDs),
			liveCount,
		)
	}

	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 60 * time.Second}

	countingStore.Reset()
	coldThumb, err := galleryFirstVisibleFetchThumbnails(
		client,
		httpServer.URL,
		token,
		imageIDs,
		galleryFirstVisibleThumbnailConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	coldStore := countingStore.Snapshot()

	countingStore.Reset()
	warmThumb, err := galleryFirstVisibleFetchThumbnails(
		client,
		httpServer.URL,
		token,
		imageIDs,
		galleryFirstVisibleThumbnailConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	warmStore := countingStore.Snapshot()

	countingStore.Reset()
	videoCold, err := galleryFirstVisibleFetchVideoPreviewRanges(
		client,
		httpServer.URL,
		token,
		videoIDs,
		galleryFirstVisibleVideoConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	videoColdStore := countingStore.Snapshot()

	countingStore.Reset()
	videoWarm, err := galleryFirstVisibleFetchVideoPreviewRanges(
		client,
		httpServer.URL,
		token,
		videoIDs,
		galleryFirstVisibleVideoConcurrency,
	)
	if err != nil {
		t.Fatal(err)
	}
	videoWarmStore := countingStore.Snapshot()

	if coldStore.OriginalOpenSuccess != int64(len(imageIDs)) {
		t.Fatalf("cold original opens=%d want=%d", coldStore.OriginalOpenSuccess, len(imageIDs))
	}
	if coldStore.DerivativePutSuccess != int64(len(imageIDs)) {
		t.Fatalf("cold derivative puts=%d want=%d", coldStore.DerivativePutSuccess, len(imageIDs))
	}
	if warmStore.OriginalOpenSuccess != 0 || warmStore.DerivativePutSuccess != 0 {
		t.Fatalf("warm thumbnails regenerated originals/derivatives: %+v", warmStore)
	}
	if warmStore.DerivativeOpenSuccess < int64(len(imageIDs)) {
		t.Fatalf("warm derivative opens=%d want>=%d", warmStore.DerivativeOpenSuccess, len(imageIDs))
	}
	if videoColdStore.OriginalOpenSuccess != int64(len(videoIDs)) ||
		videoWarmStore.OriginalOpenSuccess != int64(len(videoIDs)) {
		t.Fatalf(
			"video preview opens cold/warm=%d/%d want=%d/%d",
			videoColdStore.OriginalOpenSuccess,
			videoWarmStore.OriginalOpenSuccess,
			len(videoIDs),
			len(videoIDs),
		)
	}

	t.Logf(
		"GALLERY_FIRST_VISIBLE_SERVER_100K mix_photos=%d mix_videos=%d mix_live=%d viewport=%d range_ms=%.3f thumbnail_cold_first_ms=%.3f thumbnail_cold_first12_ms=%.3f thumbnail_cold_all_ms=%.3f thumbnail_cold_p50_ms=%.3f thumbnail_cold_p95_ms=%.3f thumbnail_warm_first_ms=%.3f thumbnail_warm_first12_ms=%.3f thumbnail_warm_all_ms=%.3f thumbnail_warm_p50_ms=%.3f thumbnail_warm_p95_ms=%.3f video_preview_cold_first_ms=%.3f video_preview_cold_all_ms=%.3f video_preview_warm_first_ms=%.3f video_preview_warm_all_ms=%.3f",
		len(imageIDs)-liveCount,
		len(videoIDs),
		liveCount,
		galleryFirstVisibleViewport,
		fileExplorerMediaPerfMilliseconds(rangeElapsed),
		fileExplorerMediaPerfMilliseconds(coldThumb.FirstVisible),
		fileExplorerMediaPerfMilliseconds(coldThumb.FirstTwelveVisible),
		fileExplorerMediaPerfMilliseconds(coldThumb.TotalDuration),
		fileExplorerMediaPerfMilliseconds(coldThumb.P50Latency),
		fileExplorerMediaPerfMilliseconds(coldThumb.P95Latency),
		fileExplorerMediaPerfMilliseconds(warmThumb.FirstVisible),
		fileExplorerMediaPerfMilliseconds(warmThumb.FirstTwelveVisible),
		fileExplorerMediaPerfMilliseconds(warmThumb.TotalDuration),
		fileExplorerMediaPerfMilliseconds(warmThumb.P50Latency),
		fileExplorerMediaPerfMilliseconds(warmThumb.P95Latency),
		fileExplorerMediaPerfMilliseconds(videoCold.FirstVisible),
		fileExplorerMediaPerfMilliseconds(videoCold.TotalDuration),
		fileExplorerMediaPerfMilliseconds(videoWarm.FirstVisible),
		fileExplorerMediaPerfMilliseconds(videoWarm.TotalDuration),
	)

	if coldThumb.FirstVisible > 750*time.Millisecond {
		t.Fatalf("cold first thumbnail=%s exceeds 750ms budget", coldThumb.FirstVisible)
	}
	if coldThumb.FirstTwelveVisible > 1500*time.Millisecond {
		t.Fatalf("cold first 12 thumbnails=%s exceeds 1.5s budget", coldThumb.FirstTwelveVisible)
	}
	if warmThumb.FirstVisible > 250*time.Millisecond {
		t.Fatalf("warm first thumbnail=%s exceeds 250ms budget", warmThumb.FirstVisible)
	}
	if videoCold.FirstVisible > 500*time.Millisecond {
		t.Fatalf("cold first video preview bytes=%s exceeds 500ms budget", videoCold.FirstVisible)
	}
}

func galleryFirstVisibleSeedObjects(
	t *testing.T,
	db *gorm.DB,
	store *fileExplorerMediaPerfStore,
	viewport []mediaItemDTO,
) ([]uint64, []uint64, int) {
	t.Helper()

	variants := make([]fileExplorerMediaPerfVariant, 0, galleryFirstVisibleImageVariants)
	for index := 0; index < galleryFirstVisibleImageVariants; index++ {
		data := fileExplorerMediaPerfJPEG(t, 300+index)
		sum := sha256.Sum256(data)
		hash := fmt.Sprintf("%x", sum[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.Put(context.Background(), key, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
		variants = append(variants, fileExplorerMediaPerfVariant{
			SHA256:     hash,
			StorageKey: key,
			Size:       int64(len(data)),
		})
	}

	videoBytes, err := base64.StdEncoding.DecodeString(galleryFirstVisibleVideoMP4Base64)
	if err != nil {
		t.Fatal(err)
	}
	videoSum := sha256.Sum256(videoBytes)
	videoHash := fmt.Sprintf("%x", videoSum[:])
	videoKey, err := storage.ContentAddressedKey(videoHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), videoKey, bytes.NewReader(videoBytes)); err != nil {
		t.Fatal(err)
	}

	imageIDs := make([]uint64, 0, len(viewport))
	videoIDs := make([]uint64, 0, len(viewport))
	liveCount := 0
	for index, item := range viewport {
		nodeID := item.Node.ID
		variant := variants[index%len(variants)]
		fileUpdate := map[string]any{
			"storage_key": variant.StorageKey,
			"sha256":      variant.SHA256,
			"size":        variant.Size,
		}
		metadataHash := variant.SHA256
		if item.Metadata.MediaKind == meta.MediaKindVideo {
			videoIDs = append(videoIDs, nodeID)
			fileUpdate = map[string]any{
				"storage_key": videoKey,
				"sha256":      videoHash,
				"size":        int64(len(videoBytes)),
			}
			metadataHash = videoHash
		} else {
			imageIDs = append(imageIDs, nodeID)
			if item.AssetKind == meta.PhotoAssetKindLivePhoto {
				liveCount++
			}
		}
		if err := db.Model(&meta.File{}).
			Where("node_id = ?", nodeID).
			Updates(fileUpdate).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.MediaMetadata{}).
			Where("node_id = ?", nodeID).
			Updates(map[string]any{
				"sha256":              metadataHash,
				"thumbnail_key":       "",
				"thumbnail_mime_type": "",
				"thumbnail_width":     0,
				"thumbnail_height":    0,
			}).Error; err != nil {
			t.Fatal(err)
		}
	}
	store.Reset()
	return imageIDs, videoIDs, liveCount
}

func galleryFirstVisibleFetchThumbnails(
	client *http.Client,
	baseURL, token string,
	nodeIDs []uint64,
	concurrency int,
) (galleryFirstVisibleRequestMetrics, error) {
	return galleryFirstVisibleRunRequests(nodeIDs, concurrency, func(nodeID uint64) (int64, error) {
		req, err := http.NewRequest(
			http.MethodGet,
			fmt.Sprintf("%s/api/v1/media/items/%d/thumbnail", baseURL, nodeID),
			nil,
		)
		if err != nil {
			return 0, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		response, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			return 0, err
		}
		if response.StatusCode != http.StatusOK {
			return 0, fmt.Errorf("thumbnail node=%d status=%d body=%s", nodeID, response.StatusCode, string(body))
		}
		if contentType := response.Header.Get("Content-Type"); contentType != "image/jpeg" {
			return 0, fmt.Errorf("thumbnail node=%d content-type=%q", nodeID, contentType)
		}
		return int64(len(body)), nil
	})
}

func galleryFirstVisibleFetchVideoPreviewRanges(
	client *http.Client,
	baseURL, token string,
	nodeIDs []uint64,
	concurrency int,
) (galleryFirstVisibleRequestMetrics, error) {
	return galleryFirstVisibleRunRequests(nodeIDs, concurrency, func(nodeID uint64) (int64, error) {
		req, err := http.NewRequest(
			http.MethodPost,
			fmt.Sprintf("%s/api/v1/files/%d/preview-ticket", baseURL, nodeID),
			nil,
		)
		if err != nil {
			return 0, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		response, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			return 0, readErr
		}
		if response.StatusCode != http.StatusOK {
			return 0, fmt.Errorf("preview ticket node=%d status=%d body=%s", nodeID, response.StatusCode, string(body))
		}
		var ticket struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(body, &ticket); err != nil {
			return 0, err
		}
		if strings.TrimSpace(ticket.URL) == "" {
			return 0, fmt.Errorf("preview ticket node=%d returned empty url", nodeID)
		}
		previewURL := ticket.URL
		if !strings.HasPrefix(previewURL, "http://") && !strings.HasPrefix(previewURL, "https://") {
			previewURL = baseURL + previewURL
		}
		previewReq, err := http.NewRequest(http.MethodGet, previewURL, nil)
		if err != nil {
			return 0, err
		}
		previewReq.Header.Set("Range", "bytes=0-65535")
		previewResponse, err := client.Do(previewReq)
		if err != nil {
			return 0, err
		}
		defer previewResponse.Body.Close()
		previewBody, err := io.ReadAll(previewResponse.Body)
		if err != nil {
			return 0, err
		}
		if previewResponse.StatusCode != http.StatusPartialContent &&
			previewResponse.StatusCode != http.StatusOK {
			return 0, fmt.Errorf(
				"preview node=%d status=%d body=%s",
				nodeID,
				previewResponse.StatusCode,
				string(previewBody),
			)
		}
		return int64(len(previewBody)), nil
	})
}

func galleryFirstVisibleRunRequests(
	nodeIDs []uint64,
	concurrency int,
	request func(uint64) (int64, error),
) (galleryFirstVisibleRequestMetrics, error) {
	if concurrency < 1 {
		concurrency = 1
	}
	type requestResult struct {
		latency    time.Duration
		completion time.Duration
		bytes      int64
		err        error
	}

	jobs := make(chan uint64)
	results := make(chan requestResult, len(nodeIDs))
	var active atomic.Int64
	var peak atomic.Int64
	var workers sync.WaitGroup
	startedAll := time.Now()

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
				size, err := request(nodeID)
				latency := time.Since(started)
				completion := time.Since(startedAll)
				active.Add(-1)
				results <- requestResult{
					latency:    latency,
					completion: completion,
					bytes:      size,
					err:        err,
				}
			}
		}()
	}

	go func() {
		for _, nodeID := range nodeIDs {
			jobs <- nodeID
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()

	latencies := make([]time.Duration, 0, len(nodeIDs))
	completions := make([]time.Duration, 0, len(nodeIDs))
	var totalBytes int64
	for result := range results {
		if result.err != nil {
			return galleryFirstVisibleRequestMetrics{}, result.err
		}
		latencies = append(latencies, result.latency)
		completions = append(completions, result.completion)
		totalBytes += result.bytes
	}
	totalDuration := time.Since(startedAll)
	if len(latencies) != len(nodeIDs) {
		return galleryFirstVisibleRequestMetrics{}, fmt.Errorf(
			"request results=%d want=%d",
			len(latencies),
			len(nodeIDs),
		)
	}
	if len(latencies) == 0 {
		return galleryFirstVisibleRequestMetrics{}, fmt.Errorf("request set is empty")
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	sort.Slice(completions, func(i, j int) bool { return completions[i] < completions[j] })
	firstTwelveIndex := 11
	if firstTwelveIndex >= len(completions) {
		firstTwelveIndex = len(completions) - 1
	}
	return galleryFirstVisibleRequestMetrics{
		RequestCount:       len(latencies),
		PeakConcurrency:    peak.Load(),
		TotalBytes:         totalBytes,
		FirstVisible:       completions[0],
		FirstTwelveVisible: completions[firstTwelveIndex],
		TotalDuration:      totalDuration,
		P50Latency:         fileExplorerMediaPerfPercentile(latencies, 50),
		P95Latency:         fileExplorerMediaPerfPercentile(latencies, 95),
	}, nil
}
