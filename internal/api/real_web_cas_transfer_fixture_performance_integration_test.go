//go:build linux

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestRealWebLargeTransferCASFixture runs the actual upload and download
// Server.Router against native PostgreSQL and physical Local CAS. Only
// the static web hosting and /__perf/ endpoints are test-specific.
func TestRealWebLargeTransferCASFixture(t *testing.T) {
	if os.Getenv("XD_REAL_WEB_CAS_PERF") != "1" {
		t.Skip("enable XD_REAL_WEB_CAS_PERF for real Web-to-Server/CAS browser test")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyFile := os.Getenv("XD_REAL_WEB_CAS_READY_FILE")
	dist := os.Getenv("XD_REAL_WEB_CAS_DIST")
	sample := os.Getenv("XD_REAL_WEB_CAS_SAMPLE")
	if dsn == "" || readyFile == "" || sample == "" || dist == "" {
		t.Fatal("native PostgreSQL17 DSN, sample, ready file and built Web dist required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.DownloadProgress{},
		&meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	capacity, err := local.Capacity(context.Background())
	if err != nil || capacity.AvailableBytes < 4<<30 {
		t.Fatalf("native physical CAS storage insufficient: capacity=%+v err=%v", capacity, err)
	}
	server := &Server{
		DB: db, Store: local,
		Auth:           auth.New("web-large-cas-native-perf", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 5 << 30,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "cas-web-"+sample, "native-perf-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var rootNode meta.Node
	if err := db.First(&rootNode, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	const size int64 = 1 << 30
	var putCount atomic.Int64
	var declaredPutBytes atomic.Int64
	var getCount atomic.Int64
	stopped := make(chan struct{})
	var stoppedOnce sync.Once
	name := "upload-" + sample + ".bin"
	state := func(includeToken bool) map[string]any {
		out := map[string]any{
			"sample":                sample,
			"root_id":               root.ID,
			"size_bytes":            size,
			"upload_name":           name,
			"put_count":             putCount.Load(),
			"declared_upload_bytes": declaredPutBytes.Load(),
			"download_get_count":    getCount.Load(),
			"uploaded_node_id":      uint64(0),
			"cas_valid":             false,
			"cas_bytes":             int64(0),
		}
		if includeToken {
			out["token"] = token
		}
		var node meta.Node
		if err := db.Where("owner_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
			rootNode.OwnerID, name, meta.NodeTypeFile).First(&node).Error; err != nil {
			return out
		}
		out["uploaded_node_id"] = node.ID
		out["node_revision"] = node.Revision
		var file meta.File
		if err := db.First(&file, "node_id = ?", node.ID).Error; err != nil {
			return out
		}
		out["file_sha256"] = file.SHA256
		out["file_bytes"] = file.Size
		var blob meta.ContentBlob
		if err := db.First(&blob, "sha256 = ?", file.SHA256).Error; err != nil {
			return out
		}
		key, err := storage.ContentAddressedKey(file.SHA256)
		if err != nil {
			return out
		}
		f, err := local.Open(context.Background(), key)
		if err != nil {
			return out
		}
		info, statErr := f.Stat()
		_ = f.Close()
		if statErr != nil {
			return out
		}
		out["cas_bytes"] = info.Size()
		out["cas_valid"] = file.Size == size && blob.Size == size &&
			info.Size() == size && blob.StorageKey == key && blob.RefCount >= 1
		return out
	}
	fileServer := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__perf/web-transfer-config":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(state(true))
			return
		case "/__perf/web-transfer-stats":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(state(false))
			return
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			stoppedOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Method == http.MethodPut &&
				strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") &&
				strings.Contains(r.URL.Path, "/chunks/") {
				putCount.Add(1)
				if r.ContentLength > 0 {
					declaredPutBytes.Add(r.ContentLength)
				}
			}
			if r.Method == http.MethodGet &&
				strings.HasPrefix(r.URL.Path, "/api/v1/files/") &&
				strings.HasSuffix(r.URL.Path, "/content") {
				getCount.Add(1)
			}
			router.ServeHTTP(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
	peer := httptest.NewServer(mux)
	defer peer.Close()
	ready := map[string]any{
		"url": peer.URL, "size_bytes": size, "sample": sample,
		"physical_cas": true, "postgres17": true,
	}
	body, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyFile, body, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("WEB_REAL_SERVER_CAS_FIXTURE_READY %s", body)
	select {
	case <-stopped:
		result := state(false)
		t.Logf("WEB_REAL_SERVER_CAS_FIXTURE_FINAL %v", result)
		if putCount.Load() != 128 || declaredPutBytes.Load() != size || getCount.Load() != 1 ||
			result["cas_valid"] != true || result["cas_bytes"] != size {
			t.Fatalf("real Web/Server/CAS integrity failed: %v", result)
		}
	case <-time.After(11 * time.Minute):
		t.Fatal("real Web upload/download runner did not stop fixture")
	}
}
