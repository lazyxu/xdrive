//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
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
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// SH-P005: real owner PostgreSQL17 + 100k independently decodable physical
// JPEG LocalCAS originals + original read-only shared-folder APIs (test-only).
func TestSHP005RealBrowserPhysicalJPEG100KFixture(t *testing.T) {
	if os.Getenv("XD_SH_P005_BROWSER_PHYSICAL_PERF") != "1" {
		t.Skip("opt-in authentic physical 100k public share browser")
	}
	dist := os.Getenv("XD_SH_P005_WEB_DIST")
	readyFile := os.Getenv("XD_SH_P005_READY_FILE")
	if os.Getenv("XD_TEST_DATABASE_URL") == "" || dist == "" || readyFile == "" {
		t.Fatal("SH-P005 requires genuine PostgreSQL17 and built production Web dist")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatalf("missing actual production Web: %v", err)
	}
	const count = 100000
	const sample = "shared-browser-corpus"
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, os.Getenv("XD_TEST_DATABASE_URL"))
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.Share{}, &meta.ContentBlob{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileOperation{},
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("shp004-original-physical-sharing", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	userName := "shp004-physical-owner-" + sample
	token := createTestUser(t, db, router, userName, "password-for-test")
	foreignToken := createTestUser(t, db, router, "shp004-other-"+sample, "other-password")
	var user meta.User
	if err := db.Where("username = ?", userName).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Node{
		ParentID: &root.ID, Name: "public-100k-JPEG-folder", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	target := meta.Node{
		ParentID: &root.ID, Name: "unshared-empty-sibling", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	sentinel := meta.Node{
		ParentID: &root.ID, Name: "outside-private.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	for _, node := range []*meta.Node{&source, &target, &sentinel} {
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at) "+
			"SELECT ?, 'photo-' || lpad(gs::text, 6, '0') || '.jpg', 'file', ?, 1, NOW(), NOW() "+
			"FROM generate_series(0, ?) AS gs",
		source.ID, user.ID, count-1,
	).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := db.Raw(
		"SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY name",
		source.ID, user.ID,
	).Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, count)
	for rows.Next() {
		var id uint64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rowsErr := rows.Err()
	_ = rows.Close()
	if rowsErr != nil || len(ids) != count {
		t.Fatalf("not all physical source Nodes seeded: %d %v", len(ids), rowsErr)
	}
	aggregate := sha256.New()
	var sourceBytes int64
	uniques := make(map[string]bool, count)
	blobs := make([]meta.ContentBlob, 0, 250)
	files := make([]meta.File, 0, 250)
	flush := func() {
		if err := db.CreateInBatches(&blobs, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&files, 250).Error; err != nil {
			t.Fatal(err)
		}
		blobs = blobs[:0]
		files = files[:0]
	}
	for i, id := range ids {
		payload, err := fileExplorerPhysicalJPEG(i)
		if err != nil {
			t.Fatal(err)
		}
		sourceBytes += int64(len(payload))
		digest := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", digest[:])
		if uniques[hash] {
			t.Fatal("100k source originals must have unique complete SHA")
		}
		uniques[hash] = true
		_, _ = aggregate.Write(digest[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		wrote, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || wrote != int64(len(payload)) {
			t.Fatalf("physical Local.Put original=%d n=%d err=%v", i, wrote, err)
		}
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: int64(len(payload)),
			RefCount: 1, State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: id, Size: int64(len(payload)), SHA256: hash, StorageKey: key,
		})
		if len(blobs) == 250 {
			flush()
		}
	}
	if len(blobs) > 0 {
		flush()
	}
	outside, err := fileExplorerPhysicalJPEG(count)
	if err != nil {
		t.Fatal(err)
	}
	outsideDigest := sha256.Sum256(outside)
	outsideHash := fmt.Sprintf("%x", outsideDigest[:])
	if uniques[outsideHash] {
		t.Fatal("protected physical sentinel hash duplicate")
	}
	outsideKey, err := storage.ContentAddressedKey(outsideHash)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := store.Put(ctx, outsideKey, bytes.NewReader(outside)); err != nil || n != int64(len(outside)) {
		t.Fatalf("physical protected CAS sentinel: n=%d err=%v", n, err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: outsideHash, Size: int64(len(outside)), StorageKey: outsideKey,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: sentinel.ID, Size: int64(len(outside)), SHA256: outsideHash,
		StorageKey: outsideKey,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sourceHash := fmt.Sprintf("%x", aggregate.Sum(nil))
	preCount, preAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || preCount != int64(count+1) || preAllocated < int64(count+1)*4096 {
		t.Fatalf("real original physical CAS inventory=%d allocated=%d err=%v", preCount, preAllocated, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	ids = nil
	uniques = nil
	blobs = nil
	files = nil

	// Seed time is excluded from page/display/download timings. The original
	// storage bytes and their SHA are independently verified in the saved CAS.
	testShare := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID), token,
		strings.NewReader("{\"max_downloads\":0}"), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(testShare.Body.Bytes(), &share); err != nil || len(share.Token) < 40 {
		t.Fatal("actual Owner share was not created")
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID), foreignToken,
		nil, http.StatusNotFound)

	originalExpected := make([]map[string]any, 0, 2)
	for _, i := range []int{0, 100} {
		body, err := fileExplorerPhysicalJPEG(i)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		originalExpected = append(originalExpected, map[string]any{
			"name":   fmt.Sprintf("photo-%06d.jpg", i),
			"sha256": fmt.Sprintf("%x", digest[:]),
			"bytes":  len(body),
		})
	}
	var pageCalls, ticketCalls, originalStreams atomic.Int64
	stopped := make(chan struct{})
	var stopOnce sync.Once
	filesOnDisk := http.FileServer(http.Dir(dist))
	fixtureHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__perf/config":
			w.Header().Set("Cache-Control", "private, no-store")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"share_token":             share.Token,
				"directory_id":            source.ID,
				"physical_jpeg_originals": count,
				"physical_cas_inodes":     preCount,
				"allocated_bytes":         preAllocated,
				"original_bytes":          sourceBytes,
				"source_aggregate_sha256": sourceHash,
				"seed_ms_excluded":        seedMS,
				"downloads":               originalExpected,
			})
		case "/__perf/state":
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int64{
				"public_page_calls":       pageCalls.Load(),
				"signed_ticket_calls":     ticketCalls.Load(),
				"original_download_calls": originalStreams.Load(),
			})
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			stopOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
		default:
			if strings.HasPrefix(r.URL.Path, "/api/") {
				if r.URL.Path == "/api/v1/public/share/children" && r.Method == http.MethodPost {
					pageCalls.Add(1)
				}
				if r.URL.Path == "/api/v1/public/share/download-ticket" && r.Method == http.MethodPost {
					ticketCalls.Add(1)
				}
				if strings.HasPrefix(r.URL.Path, "/api/v1/public-share-download/") &&
					r.Method == http.MethodGet {
					originalStreams.Add(1)
				}
				router.ServeHTTP(w, r)
				return
			}
			filesOnDisk.ServeHTTP(w, r)
		}
	})
	httpFixture := httptest.NewServer(fixtureHandler)
	defer httpFixture.Close()
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	// This private 0600 file intentionally contains NO bearer or signed URL.
	ready, err := json.Marshal(map[string]any{
		"url":                     httpFixture.URL,
		"physical_jpeg_originals": count,
		"physical_cas_inodes":     preCount,
		"allocated_bytes":         preAllocated,
		"original_bytes":          sourceBytes,
		"seed_ms_excluded":        seedMS,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyFile, ready, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("SH_P005_PHYSICAL_READY originals=%d cas_inodes=%d physical_allocated=%d seed_excluded_ms=%.3f", count, preCount, preAllocated, seedMS)
	select {
	case <-stopped:
		t.Logf("SH_P005_PHYSICAL_STOP pages=%d signed_tickets=%d completed_download_requests=%d",
			pageCalls.Load(), ticketCalls.Load(), originalStreams.Load())
	case <-time.After(18 * time.Minute):
		t.Fatal("SH-P005 real Chromium browser never requested fixture stop")
	}
}
