package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
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

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const fileExplorerVideoPosterPerfItems = 100_000
const fileExplorerVideoPosterPerfWorkers = 6
const fileExplorerVideoPosterPerfPerPage = 34

type fileExplorerVideoPosterPerfPhase struct {
	Phase        string  `json:"phase"`
	Sample       int     `json:"sample"`
	Requests     int     `json:"requests"`
	PeakInFlight int64   `json:"peak_in_flight"`
	Bytes        int64   `json:"bytes"`
	BatchMs      float64 `json:"batch_ms"`
	P50Ms        float64 `json:"p50_ms"`
	P95Ms        float64 `json:"p95_ms"`
}

func fileExplorerVideoPosterPerfJPEG(t *testing.T) []byte {
	t.Helper()
	imageData := image.NewRGBA(image.Rect(0, 0, 320, 240))
	for y := 0; y < 240; y++ {
		for x := 0; x < 320; x++ {
			imageData.SetRGBA(x, y, color.RGBA{
				R: uint8((x + y) % 256),
				G: uint8((2*y + 47) % 256),
				B: uint8((x/2 + 71) % 256),
				A: 255,
			})
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, imageData, &jpeg.Options{Quality: 82}); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func fileExplorerVideoPosterPerfHTTPBatch(
	client *http.Client,
	baseURL, token string,
	nodeIDs []uint64,
	method string,
	wantStatus int,
	poster []byte,
	sample int,
	phase string,
) (fileExplorerVideoPosterPerfPhase, error) {
	type result struct {
		duration time.Duration
		size     int64
		err      error
	}
	jobs := make(chan uint64)
	results := make(chan result, len(nodeIDs))
	var workers sync.WaitGroup
	var active, peak atomic.Int64

	for i := 0; i < fileExplorerVideoPosterPerfWorkers; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for id := range jobs {
				current := active.Add(1)
				for {
					observed := peak.Load()
					if current <= observed || peak.CompareAndSwap(observed, current) {
						break
					}
				}
				started := time.Now()
				endpoint := fmt.Sprintf("%s/api/v1/media/items/%d/thumbnail", baseURL, id)
				var payload io.Reader
				if method == http.MethodPut {
					endpoint = fmt.Sprintf("%s/api/v1/media/items/%d/video-poster", baseURL, id)
					payload = bytes.NewReader(poster)
				}
				req, err := http.NewRequest(method, endpoint, payload)
				if err == nil {
					req.Header.Set("Authorization", "Bearer "+token)
					if method == http.MethodPut {
						req.Header.Set("Content-Type", "image/jpeg")
						req.Header.Set("If-Match", "\"1\"")
					}
				}
				var length int64
				if err == nil {
					var response *http.Response
					response, err = client.Do(req)
					if err == nil {
						var body []byte
						body, err = io.ReadAll(response.Body)
						_ = response.Body.Close()
						if err == nil && response.StatusCode != wantStatus {
							err = fmt.Errorf("%s node=%d HTTP=%d want=%d body=%s", phase, id, response.StatusCode, wantStatus, string(body))
						}
						if err == nil && wantStatus == http.StatusOK {
							if response.Header.Get("Content-Type") != "image/jpeg" || response.Header.Get("ETag") == "" || !bytes.Equal(body, poster) {
								err = fmt.Errorf("%s node=%d returned a different or uncached JPEG", phase, id)
							}
						}
						if err == nil {
							length = int64(len(body))
						}
					}
				}
				active.Add(-1)
				results <- result{duration: time.Since(started), size: length, err: err}
			}
		}()
	}

	started := time.Now()
	for _, id := range nodeIDs {
		jobs <- id
	}
	close(jobs)
	workers.Wait()
	close(results)
	var all []time.Duration
	var totalBytes int64
	var firstError error
	for result := range results {
		if firstError == nil {
			firstError = result.err
		}
		all = append(all, result.duration)
		totalBytes += result.size
	}
	if firstError != nil {
		return fileExplorerVideoPosterPerfPhase{}, firstError
	}
	if len(all) != len(nodeIDs) {
		return fileExplorerVideoPosterPerfPhase{}, fmt.Errorf("phase=%s returned=%d want=%d", phase, len(all), len(nodeIDs))
	}
	sort.Slice(all, func(i, j int) bool { return all[i] < all[j] })
	return fileExplorerVideoPosterPerfPhase{
		Phase:        phase,
		Sample:       sample,
		Requests:     len(all),
		PeakInFlight: peak.Load(),
		Bytes:        totalBytes,
		BatchMs:      fileExplorerMediaPerfMilliseconds(time.Since(started)),
		P50Ms:        fileExplorerMediaPerfMilliseconds(fileExplorerMediaPerfPercentile(all, 50)),
		P95Ms:        fileExplorerMediaPerfMilliseconds(fileExplorerMediaPerfPercentile(all, 95)),
	}, nil
}

// Measurement-only: exercise real Gin auth/routing, PostgreSQL owner/revision
// checks and storage.Local poster PUT/GET on one 100k-video namespace.
// The fake original video bytes deliberately keep codec decode/Range preview
// outside this benchmark; those have a separate native Chromium measurement.
func TestFileExplorerVideoPosterCachePerformance100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_VIDEO_POSTER_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_VIDEO_POSTER_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := background.NewScheduler(context.Background(), background.Config{
		Capacity:      map[background.ResourceClass]int{background.ResourceMediaCPU: fileExplorerVideoPosterPerfWorkers},
		QueueCapacity: map[background.ResourceClass]int{background.ResourceMediaCPU: 256},
	})
	defer scheduler.Close()

	server := &Server{
		DB: db, Store: store, Auth: auth.New("video-poster-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20, BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "video-poster-perf", "password-video-poster")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader("{\"name\":\"100k Videos\"}"), http.StatusCreated)
	var rootNode meta.Node
	if err := db.First(&rootNode, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	// One set-based seed per table, not 100k client API calls.
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at) "+
			"SELECT ?, 'video-' || lpad(gs::text, 6, '0') || '.mp4', 'file', ?, 1, NOW(), NOW() "+
			"FROM generate_series(1, ?) AS gs",
		folder.ID, rootNode.OwnerID, fileExplorerVideoPosterPerfItems,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO xd_files (node_id, size, storage_key, sha256, created_at, updated_at) "+
			"SELECT n.id, 20971520, 'video-poster-perf-no-original', '', NOW(), NOW() "+
			"FROM xd_nodes n WHERE n.owner_id=? AND n.parent_id=? AND n.deleted_at IS NULL",
		rootNode.OwnerID, folder.ID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO xd_media_metadata "+
			"(node_id, owner_id, node_revision, sha256, media_kind, mime_type, relation_evidence_version, "+
			"width, height, orientation, index_state, created_at, updated_at) "+
			"SELECT n.id, n.owner_id, n.revision, f.sha256, ?, 'video/mp4', ?, 1920, 1080, 1, ?, NOW(), NOW() "+
			"FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id "+
			"WHERE n.owner_id=? AND n.parent_id=? AND n.deleted_at IS NULL",
		meta.MediaKindVideo, mediapkg.RelationEvidenceVersion, meta.MediaIndexStateReady,
		rootNode.OwnerID, folder.ID,
	).Error; err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"ANALYZE xd_nodes", "ANALYZE xd_files", "ANALYZE xd_media_metadata",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}

	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 45 * time.Second}
	nodeIDs := make([]uint64, 0, 3*fileExplorerVideoPosterPerfPerPage)
	for _, offset := range []int{0, 50000, 99746} {
		page, _ := fileExplorerMediaPerfListRange(t, client, httpServer.URL, token, folder.ID, offset)
		for _, node := range page.Items[:fileExplorerVideoPosterPerfPerPage] {
			if !strings.HasSuffix(node.Name, ".mp4") {
				t.Fatalf("unexpected name=%q", node.Name)
			}
			nodeIDs = append(nodeIDs, node.ID)
		}
	}
	if len(nodeIDs) != 102 {
		t.Fatalf("video samples=%d want=102", len(nodeIDs))
	}
	poster := fileExplorerVideoPosterPerfJPEG(t)
	if len(poster) == 0 || len(poster) > (4<<20) {
		t.Fatalf("poster bytes=%d", len(poster))
	}
	var collected []fileExplorerVideoPosterPerfPhase
	for sample := 1; sample <= 3; sample++ {
		// Cache misses must be actual 404 responses, not synthetic delays.
		cold, err := fileExplorerVideoPosterPerfHTTPBatch(client, httpServer.URL, token, nodeIDs, http.MethodGet, http.StatusNotFound, poster, sample, "cold-miss")
		if err != nil {
			t.Fatal(err)
		}
		put, err := fileExplorerVideoPosterPerfHTTPBatch(client, httpServer.URL, token, nodeIDs, http.MethodPut, http.StatusNoContent, poster, sample, "poster-put")
		if err != nil {
			t.Fatal(err)
		}
		warm, err := fileExplorerVideoPosterPerfHTTPBatch(client, httpServer.URL, token, nodeIDs, http.MethodGet, http.StatusOK, poster, sample, "warm-hit")
		if err != nil {
			t.Fatal(err)
		}
		if warm.Bytes != int64(len(poster)*len(nodeIDs)) {
			t.Fatalf("warm bytes=%d want=%d", warm.Bytes, len(poster)*len(nodeIDs))
		}
		for _, phase := range []fileExplorerVideoPosterPerfPhase{cold, put, warm} {
			if phase.PeakInFlight > fileExplorerVideoPosterPerfWorkers {
				t.Fatalf("%s in-flight=%d", phase.Phase, phase.PeakInFlight)
			}
			collected = append(collected, phase)
		}
		for _, nodeID := range nodeIDs {
			if err := store.Delete(context.Background(), mediapkg.VideoPosterStorageKey(nodeID, 1, "")); err != nil {
				t.Fatalf("reset poster id=%d: %v", nodeID, err)
			}
		}
	}
	encoded, err := json.Marshal(map[string]any{
		"workload":           "video-poster-server-http-100k",
		"logical_items":      fileExplorerVideoPosterPerfItems,
		"sample_node_count":  len(nodeIDs),
		"samples_per_phase":  3,
		"concurrency_budget": fileExplorerVideoPosterPerfWorkers,
		"poster_bytes":       len(poster),
		"phases":             collected,
		"limits":             "real Gin/PostgreSQL/storage.Local GET miss, revision-validated PUT and warm GET; synthetic JPEG backfill; no MP4 decode/preview transport",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("FILEEXPLORER_VIDEO_POSTER_SERVER_100K " + string(encoded))
}
