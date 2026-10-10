package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// A genuine 96x64 H264 MP4 from the already accepted Chromium video-poster fixture.
// This sample is deliberately small. Never present it as 4K or HEVC decoding.
const fileExplorerH264Real100KVideo = "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"

func TestFileExplorerRealH264PosterBrowser100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_REAL_H264_100K_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_REAL_H264_100K_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyFile := os.Getenv("XD_FILEEXPLORER_REAL_H264_READY_FILE")
	if dsn == "" || readyFile == "" {
		t.Fatal("native PostgreSQL and ready-file required")
	}
	videoBytes, err := base64.StdEncoding.DecodeString(fileExplorerH264Real100KVideo)
	if err != nil || len(videoBytes) < 1000 || !bytes.Contains(videoBytes, []byte("ftyp")) {
		t.Fatalf("invalid decodable H264 fixture bytes=%d err=%v", len(videoBytes), err)
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_real_video_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) " +
		"WHERE parent_id IS NOT NULL AND deleted_at IS NULL").Error; err != nil {
		t.Fatal(err)
	}
	disk, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &galleryVideoRangeCountingStore{inner: disk}
	app := &Server{DB: db, Store: store, Auth: auth.New("real-h264-100k", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 16 << 20}
	router := app.Router()
	token := createTestUser(t, db, router, "real-h264-video-100k", "perf-only-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader("{\"name\":\"100k Real H264 Videos\"}"), http.StatusCreated)
	var rootNode meta.Node
	if err := db.First(&rootNode, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := db.Exec("INSERT INTO xd_nodes(parent_id,name,type,owner_id,revision,created_at,updated_at) "+
		"SELECT ?, 'clip-' || lpad(gs::text,6,'0') || '.mp4','file',?,1,NOW(),NOW() "+
		"FROM generate_series(1,100000) gs", folder.ID, rootNode.OwnerID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_files(node_id,size,storage_key,sha256,created_at,updated_at) "+
		"SELECT n.id, 20971520, 'no-physical-original-for-100k', '', NOW(),NOW() "+
		"FROM xd_nodes n WHERE n.owner_id=? AND n.parent_id=?", rootNode.OwnerID, folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_media_metadata(node_id,owner_id,node_revision,sha256,media_kind,mime_type,"+
		"relation_evidence_version,width,height,index_state,created_at,updated_at) "+
		"SELECT n.id,n.owner_id,n.revision,f.sha256,?,'video/mp4',?,96,64,?,NOW(),NOW() "+
		"FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id WHERE n.owner_id=? AND n.parent_id=?",
		meta.MediaKindVideo, mediapkg.RelationEvidenceVersion, meta.MediaIndexStateReady,
		rootNode.OwnerID, folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	sampleIDs := make([]uint64, 0, 6)
	uniqueSHAs := make(map[string]struct{}, 6)
	for _, offset := range []int{0, 50000, 99998} {
		var nodes []meta.Node
		if err := db.Where("owner_id=? AND parent_id=?", rootNode.OwnerID, folder.ID).
			Order("id").Offset(offset).Limit(2).Find(&nodes).Error; err != nil {
			t.Fatal(err)
		}
		if len(nodes) != 2 {
			t.Fatalf("offset %d nodes=%d", offset, len(nodes))
		}
		for _, node := range nodes {
			// A valid trailing ISO BMFF free box makes each already decodable
			// clip content-unique without changing its H264 bitstream.
			variant := append(append([]byte(nil), videoBytes...), 0, 0, 0, 12, 'f', 'r', 'e', 'e',
				byte(node.ID>>24), byte(node.ID>>16), byte(node.ID>>8), byte(node.ID))
			variantSHA := fmt.Sprintf("%x", sha256.Sum256(variant))
			if _, exists := uniqueSHAs[variantSHA]; exists {
				t.Fatalf("duplicate content-hash performance fixture for node=%d", node.ID)
			}
			uniqueSHAs[variantSHA] = struct{}{}
			key := fmt.Sprintf("h264-100k/%d.mp4", node.ID)
			if n, e := store.Put(t.Context(), key, bytes.NewReader(variant)); e != nil || n != int64(len(variant)) {
				t.Fatalf("seed H264 node=%d length=%d err=%v", node.ID, n, e)
			}
			if err := db.Model(&meta.File{}).Where("node_id=?", node.ID).
				Updates(map[string]any{"storage_key": key, "size": len(variant), "sha256": variantSHA}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&meta.MediaMetadata{}).Where("node_id=?", node.ID).
				Update("sha256", variantSHA).Error; err != nil {
				t.Fatal(err)
			}
			sampleIDs = append(sampleIDs, node.ID)
		}
	}
	var count int64
	if err := db.Model(&meta.Node{}).Where("owner_id=? AND parent_id=? AND deleted_at IS NULL",
		rootNode.OwnerID, folder.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 100000 || len(sampleIDs) != 6 {
		t.Fatalf("incorrect namespace %d sample %d", count, len(sampleIDs))
	}
	for _, sql := range []string{"ANALYZE xd_nodes", "ANALYZE xd_files", "ANALYZE xd_media_metadata"} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedMs := float64(time.Since(started).Microseconds()) / 1000
	config := map[string]any{"token": token, "folder_id": folder.ID, "total_count": count,
		"sample_node_ids": sampleIDs, "video_bytes": len(videoBytes) + 12, "unique_sha256_count": len(uniqueSHAs), "seed_ms": seedMs}
	done := make(chan struct{})
	var once sync.Once
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<!doctype html><html><body>100k real H264 performance fixture</body></html>"))
		case "/__perf/config":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(config)
		case "/__perf/stats":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int64{
				"original_open": store.originalOpen.Load(), "poster_open": store.posterOpen.Load()})
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(done) })
			w.WriteHeader(http.StatusNoContent)
		default:
			router.ServeHTTP(w, r)
		}
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{"url": server.URL, "config": config})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyFile, payload, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("FILEEXPLORER_REAL_H264_100K_READY %s", payload)
	select {
	case <-done:
		t.Logf("FILEEXPLORER_REAL_H264_100K_DONE originals=%d posters=%d seed_ms=%.3f",
			store.originalOpen.Load(), store.posterOpen.Load(), seedMs)
	case <-time.After(5 * time.Minute):
		t.Fatal("real Chromium browser did not stop the native 100k video fixture")
	}
}
