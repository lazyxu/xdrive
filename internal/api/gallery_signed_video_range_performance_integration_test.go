package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const galleryVideoRangeProbeBytes int64 = 1 << 20

// A media-sized but deliberately NOT codec-decodable fixture: this bench
// measures the existing signed Go HTTP transport, NOT video first-frame cost.
type galleryVideoRangePattern struct {
	position uint64
}

func (r *galleryVideoRangePattern) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte((r.position + uint64(i)) % 251)
	}
	r.position += uint64(len(p))
	return len(p), nil
}

type galleryVideoRangeCountingStore struct {
	inner        storage.Store
	originalOpen atomic.Int64
	posterOpen   atomic.Int64
}

func (s *galleryVideoRangeCountingStore) Put(ctx context.Context, key string, reader io.Reader) (int64, error) {
	return s.inner.Put(ctx, key, reader)
}

func (s *galleryVideoRangeCountingStore) Open(ctx context.Context, key string) (*os.File, error) {
	file, err := s.inner.Open(ctx, key)
	if err == nil {
		if strings.HasPrefix(key, mediapkg.VideoPosterStoragePrefix) {
			s.posterOpen.Add(1)
		} else {
			s.originalOpen.Add(1)
		}
	}
	return file, err
}

func (s *galleryVideoRangeCountingStore) Delete(ctx context.Context, key string) error {
	return s.inner.Delete(ctx, key)
}

type galleryVideoRangeDelayedWriter struct {
	http.ResponseWriter
	decodedBodyBytes atomic.Int64
}

func (w *galleryVideoRangeDelayedWriter) Write(body []byte) (int, error) {
	n, err := w.ResponseWriter.Write(body)
	w.decodedBodyBytes.Add(int64(n))
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
	time.Sleep(30 * time.Millisecond)
	return n, err
}

func (w *galleryVideoRangeDelayedWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

type galleryVideoRangeAsset struct {
	label   string
	size    int64
	codec   string
	preview bool
	source  string
	node    meta.Node
	sha     string
}

func galleryVideoRangeSeedAsset(t *testing.T, db *gorm.DB, store storage.Store, userID uint64, asset galleryVideoRangeAsset) galleryVideoRangeAsset {
	t.Helper()
	key := "gallery-range-bench/" + asset.label + ".mp4"
	reader := &galleryVideoRangePattern{}
	hash := sha256.New()
	written, err := store.Put(t.Context(), key,
		io.TeeReader(io.LimitReader(reader, asset.size), hash))
	if err != nil {
		t.Fatal(err)
	}
	if written != asset.size {
		t.Fatalf("seed %s bytes=%d want=%d", asset.label, written, asset.size)
	}
	asset.sha = fmt.Sprintf("%x", hash.Sum(nil))
	node := meta.Node{
		Name:     asset.label + ".mp4",
		OwnerID:  userID,
		Revision: 1,
		Type:     meta.NodeTypeFile,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     node.ID,
		StorageKey: key,
		SHA256:     asset.sha,
		Size:       asset.size,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if !asset.preview {
		metaRow := meta.MediaMetadata{
			NodeID:                  node.ID,
			OwnerID:                 userID,
			NodeRevision:            node.Revision,
			SHA256:                  asset.sha,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
			MediaKind:               meta.MediaKindVideo,
			MIMEType:                "video/mp4",
			IndexState:              meta.MediaIndexStateReady,
			Width:                   3840,
			Height:                  2160,
		}
		if err := db.Create(&metaRow).Error; err != nil {
			t.Fatal(err)
		}
		var jpegData bytes.Buffer
		if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 32, 32)), nil); err != nil {
			t.Fatal(err)
		}
		posterKey := mediapkg.VideoPosterStorageKey(node.ID, node.Revision, asset.sha)
		if _, err := store.Put(t.Context(), posterKey, bytes.NewReader(jpegData.Bytes())); err != nil {
			t.Fatal(err)
		}
	}
	asset.node = node
	return asset
}

func galleryVideoRangePreviewTicket(t *testing.T, client *http.Client, base string, nodeID uint64, token string) filePreviewTicketDTO {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		fmt.Sprintf("%s/api/v1/files/%d/preview-ticket", base, nodeID), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		t.Fatalf("preview ticket node=%d status=%d body=%q", nodeID, response.StatusCode, body)
	}
	var out filePreviewTicketDTO
	if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Kind != "video" || out.MIMEType != "video/mp4" || !strings.Contains(out.URL, "/api/v1/file-preview/") {
		t.Fatalf("wrong signed Preview Engine contract: %+v", out)
	}
	return out
}

func galleryVideoRangeProbe(t *testing.T, client *http.Client, base string, ticket filePreviewTicketDTO, size int64) (int64, time.Duration) {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+ticket.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Range", fmt.Sprintf("bytes=0-%d", galleryVideoRangeProbeBytes-1))
	started := time.Now()
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	expected := min(size, galleryVideoRangeProbeBytes)
	actual, err := io.Copy(io.Discard, response.Body)
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(started)
	if response.StatusCode != http.StatusPartialContent ||
		actual != expected ||
		response.Header.Get("Cache-Control") != "private, no-store" ||
		response.Header.Get("Content-Type") != "video/mp4" {
		t.Fatalf("wrong Preview Engine Range response: status=%d actual=%d wanted=%d cache=%q content-type=%q",
			response.StatusCode, actual, expected,
			response.Header.Get("Cache-Control"), response.Header.Get("Content-Type"))
	}
	if want := fmt.Sprintf("bytes 0-%d/%d", expected-1, size); response.Header.Get("Content-Range") != want {
		t.Fatalf("incorrect Range content-range=%q want=%q", response.Header.Get("Content-Range"), want)
	}
	return actual, elapsed
}

func TestGalleryVideoSignedPreviewRangeRealServerBaseline(t *testing.T) {
	if os.Getenv("XD_GALLERY_REAL_SIGNED_VIDEO_RANGE_PERF") != "1" {
		t.Skip("set XD_GALLERY_REAL_SIGNED_VIDEO_RANGE_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "gallery_signed_range_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
		sqlDB, _ := root.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := dsnURL.Query()
	params.Set("search_path", schema)
	dsnURL.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	if sqlDB != nil {
		sqlDB.SetMaxOpenConns(4)
		sqlDB.SetMaxIdleConns(0)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &galleryVideoRangeCountingStore{inner: local}
	server := &Server{DB: db, Store: store,
		Auth:       auth.New("gallery-signed-video-range-benchmark", time.Hour),
		RefreshTTL: 24 * time.Hour,
	}
	router := server.Router()
	user := meta.User{Username: "gallery-range-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	token, err := server.Auth.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	cases := []galleryVideoRangeAsset{
		{label: "h264-4k-6s-original", size: 10204316, codec: "h264"},
		{label: "hevc-4k-6s-original", size: 11290579, codec: "hevc"},
		{label: "h264-4k-60s-original", size: 102035663, codec: "h264"},
		{label: "hevc-4k-60s-original", size: 112875577, codec: "hevc"},
		{label: "h264-4k-6s-480p", size: 155308, codec: "h264", preview: true, source: "h264-4k-6s-original"},
		{label: "h264-4k-6s-720p", size: 312647, codec: "h264", preview: true, source: "h264-4k-6s-original"},
		{label: "hevc-4k-6s-480p", size: 153430, codec: "h264", preview: true, source: "hevc-4k-6s-original"},
		{label: "hevc-4k-6s-720p", size: 307554, codec: "h264", preview: true, source: "hevc-4k-6s-original"},
		{label: "h264-4k-60s-480p", size: 155308, codec: "h264", preview: true, source: "h264-4k-60s-original"},
		{label: "h264-4k-60s-720p", size: 312485, codec: "h264", preview: true, source: "h264-4k-60s-original"},
		{label: "hevc-4k-60s-480p", size: 153390, codec: "h264", preview: true, source: "hevc-4k-60s-original"},
		{label: "hevc-4k-60s-720p", size: 307759, codec: "h264", preview: true, source: "hevc-4k-60s-original"},
	}
	for i, asset := range cases {
		cases[i] = galleryVideoRangeSeedAsset(t, db, store, user.ID, asset)
	}
	var activeSlow atomic.Int64
	var cancelledSlow atomic.Int64
	var emittedSlow atomic.Int64
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/file-preview/") &&
			r.URL.Query().Get("bench_delayed") == "1" {
			activeSlow.Add(1)
			defer activeSlow.Add(-1)
			defer func() {
				if r.Context().Err() == context.Canceled {
					cancelledSlow.Add(1)
				}
			}()
			writer := &galleryVideoRangeDelayedWriter{ResponseWriter: w}
			router.ServeHTTP(writer, r)
			emittedSlow.Add(writer.decodedBodyBytes.Load())
			return
		}
		router.ServeHTTP(w, r)
	})
	httpServer := httptest.NewServer(wrapped)
	defer httpServer.Close()
	client := &http.Client{Timeout: 12 * time.Second}
	type indexed struct {
		galleryVideoRangeAsset
		ticket filePreviewTicketDTO
	}
	artifacts := make([]indexed, 0, len(cases))
	for _, asset := range cases {
		ticket := galleryVideoRangePreviewTicket(t, client, httpServer.URL, asset.node.ID, token)
		artifacts = append(artifacts, indexed{galleryVideoRangeAsset: asset, ticket: ticket})
	}
	for _, sample := range artifacts {
		t.Run(sample.label, func(t *testing.T) {
			beforeOpen := store.originalOpen.Load()
			beforePoster := store.posterOpen.Load()
			if !sample.preview {
				for repeat := 1; repeat <= 3; repeat++ {
					req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
						fmt.Sprintf("%s/api/v1/media/items/%d/thumbnail?revision=1",
							httpServer.URL, sample.node.ID), nil)
					if err != nil {
						t.Fatal(err)
					}
					req.Header.Set("Authorization", "Bearer "+token)
					response, err := client.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
					_ = response.Body.Close()
					if err != nil || response.StatusCode != http.StatusOK ||
						len(payload) < 100 || response.Header.Get("Content-Type") != "image/jpeg" {
						t.Fatalf("warm cached poster status=%d bytes=%d err=%v", response.StatusCode, len(payload), err)
					}
				}
				if actual := store.originalOpen.Load() - beforeOpen; actual != 0 {
					t.Fatalf("warm persisted video poster re-opened original bytes %d times", actual)
				}
				if actual := store.posterOpen.Load() - beforePoster; actual != 3 {
					t.Fatalf("warm poster opens=%d want 3", actual)
				}
			}
			for repeat := 1; repeat <= 3; repeat++ {
				readBytes, duration := galleryVideoRangeProbe(t, client, httpServer.URL, sample.ticket, sample.size)
				row, _ := json.Marshal(map[string]any{
					"asset": sample.label, "source": sample.source, "profile": sample.preview,
					"codecLabel": sample.codec, "originalEncodedFixtureSize": sample.size,
					"rangeBytes": readBytes, "repeat": repeat,
					"httpElapsedMsDiagnostic":  float64(duration.Microseconds()) / 1e3,
					"serverOriginalStoreOpens": store.originalOpen.Load() - beforeOpen,
					"serverPosterStoreOpens":   store.posterOpen.Load() - beforePoster,
				})
				t.Logf("GALLERY_SIGNED_SERVER_SAMPLE %s", row)
			}
		})
	}
	// A cancellable preview Range still belongs to the existing shared ticket
	// stream; no Gallery-specific streaming route is permitted.
	var cancellable []indexed
	for _, asset := range artifacts {
		if asset.label == "h264-4k-60s-original" || asset.label == "h264-4k-60s-480p" {
			cancellable = append(cancellable, asset)
		}
	}
	if len(cancellable) != 2 {
		t.Fatal("expected original and short source for cancellation check")
	}
	for _, sample := range cancellable {
		for repeat := 1; repeat <= 3; repeat++ {
			ctx, cancel := context.WithCancel(t.Context())
			parsedURL, err := url.Parse(httpServer.URL + sample.ticket.URL)
			if err != nil {
				t.Fatal(err)
			}
			queries := parsedURL.Query()
			queries.Set("bench_delayed", "1")
			parsedURL.RawQuery = queries.Encode()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
			if err != nil {
				cancel()
				t.Fatal(err)
			}
			req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", galleryVideoRangeProbeBytes-1))
			resp, err := client.Do(req)
			if err != nil {
				cancel()
				t.Fatal(err)
			}
			if resp.StatusCode != http.StatusPartialContent {
				_ = resp.Body.Close()
				cancel()
				t.Fatalf("cancellable signed stream status=%d", resp.StatusCode)
			}
			buf := make([]byte, 1024)
			firstBytes, err := resp.Body.Read(buf)
			if err != nil && err != io.EOF {
				_ = resp.Body.Close()
				cancel()
				t.Fatal(err)
			}
			beforeCancelled := cancelledSlow.Load()
			beforeEmitted := emittedSlow.Load()
			cancel()
			_ = resp.Body.Close()
			// Exactly the same +160ms observation target as Gallery request
			// cancellation. Avoid inferring transport savings from UI state.
			time.Sleep(160 * time.Millisecond)
			emitted := emittedSlow.Load() - beforeEmitted
			row, _ := json.Marshal(map[string]any{
				"asset": sample.label, "repeat": repeat, "firstReadBytes": firstBytes,
				"serverActiveAt160Ms":      activeSlow.Load(),
				"serverCancelledAt160Ms":   cancelledSlow.Load() - beforeCancelled,
				"emittedAfterCancelSample": emitted,
			})
			t.Logf("GALLERY_SIGNED_SERVER_CANCEL %s", row)
			if activeSlow.Load() != 0 || cancelledSlow.Load()-beforeCancelled != 1 {
				t.Fatal("abandoned signed-preview HTTP Range did not release Server context by 160ms")
			}
			if emitted >= galleryVideoRangeProbeBytes {
				t.Fatal("abandoned signed preview sent the entire obsolete Range")
			}
		}
	}
}
