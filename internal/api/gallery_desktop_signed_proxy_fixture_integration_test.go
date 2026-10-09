package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
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

// TestGalleryDesktopSignedVideoProxyFixture serves the ACTUAL Gin Preview
// Engine against PostgreSQL and local object storage, long enough for the
// external production Agent IPC + Electron Main proxy benchmark to run.
// Assets deliberately contain nondecodable pseudo bytes of previously measured
// 4K encoded sizes. No playback/codec claims are made here.
func TestGalleryDesktopSignedVideoProxyFixture(t *testing.T) {
	if os.Getenv("XD_GALLERY_DESKTOP_PROXY_PERF") != "1" {
		t.Skip("set XD_GALLERY_DESKTOP_PROXY_PERF=1 for Desktop Agent proxy fixture")
	}
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	readyFile := strings.TrimSpace(os.Getenv("XD_GALLERY_DESKTOP_PROXY_READY_FILE"))
	if dsn == "" || readyFile == "" {
		t.Fatal("fixture requires XD_TEST_DATABASE_URL and XD_GALLERY_DESKTOP_PROXY_READY_FILE")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "gallery_desktop_proxy_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
		sqlDB, dbErr := root.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	parsedDSN, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsedDSN.Query()
	query.Set("search_path", schema)
	parsedDSN.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsedDSN.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	innerStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &galleryVideoRangeCountingStore{inner: innerStore}
	server := &Server{
		DB:         db,
		Store:      store,
		Auth:       auth.New("gallery-desktop-proxy-real-agent-fixture", time.Hour),
		RefreshTTL: 24 * time.Hour,
	}
	password := "gallery-desktop-proxy-fixture-password"
	hashed, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:       "gallery-desktop-proxy",
		PasswordHash:   hashed,
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	rootNode := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&rootNode).Error; err != nil {
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
	for i, spec := range cases {
		asset := galleryVideoRangeSeedAsset(t, db, store, user.ID, spec)
		if err := db.Model(&meta.Node{}).Where("id = ?", asset.node.ID).
			Update("parent_id", rootNode.ID).Error; err != nil {
			t.Fatal(err)
		}
		cases[i] = asset
	}
	router := server.Router()
	var activeSlow atomic.Int64
	var cancelledSlow atomic.Int64
	var emittedSlow atomic.Int64
	stopped := make(chan struct{})
	var stopOnce sync.Once
	transport := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__bench/stats":
			_ = json.NewEncoder(w).Encode(map[string]int64{
				"original_open":  store.originalOpen.Load(),
				"poster_open":    store.posterOpen.Load(),
				"active_slow":    activeSlow.Load(),
				"cancelled_slow": cancelledSlow.Load(),
				"emitted_slow":   emittedSlow.Load(),
			})
			return
		case "/__bench/stop":
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			stopOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
			return
		}
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
	httpServer := httptest.NewServer(transport)
	defer httpServer.Close()
	type fixtureInfo struct {
		Label      string `json:"label"`
		NodeID     uint64 `json:"node_id"`
		Size       int64  `json:"size"`
		CodecLabel string `json:"codec_label"`
		Preview    bool   `json:"preview"`
		Source     string `json:"source,omitempty"`
	}
	rows := make([]fixtureInfo, 0, len(cases))
	for _, item := range cases {
		rows = append(rows, fixtureInfo{
			Label:      item.label,
			NodeID:     item.node.ID,
			Size:       item.size,
			CodecLabel: item.codec,
			Preview:    item.preview,
			Source:     item.source,
		})
	}
	ready := map[string]any{
		"url":                 httpServer.URL,
		"username":            user.Username,
		"password":            password,
		"assets":              rows,
		"real_gin_postgresql": true,
		"decodable_video":     false,
	}
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	readyData, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyFile, readyData, 0600); err != nil {
		t.Fatal(err)
	}
	// Do not log the fixture password or signed preview tokens.
	t.Logf("GALLERY_DESKTOP_SIGNED_PROXY_FIXTURE_READY assets=%d", len(rows))
	select {
	case <-stopped:
		t.Log("GALLERY_DESKTOP_SIGNED_PROXY_FIXTURE_STOP")
	case <-time.After(8 * time.Minute):
		t.Fatal("native Desktop Agent/Preview Engine fixture not stopped within eight minutes")
	case <-t.Context().Done():
		t.Fatal("desktop preview benchmark context cancelled")
	}
}
