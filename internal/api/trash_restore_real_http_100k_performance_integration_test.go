package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestTrashRestoreRealHTTPPerformance10K100K(t *testing.T) {
	if os.Getenv("XD_TRASH_RESTORE_HTTP_PERF") != "1" {
		t.Skip("enable XD_TRASH_RESTORE_HTTP_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL absent")
	}
	count, err := strconv.Atoi(os.Getenv("XD_TRASH_RESTORE_HTTP_COUNT"))
	if err != nil || (count != 10000 && count != 100000) {
		t.Fatal("XD_TRASH_RESTORE_HTTP_COUNT must be 10000 or 100000")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn).Session(&gorm.Session{Logger: logger.Discard})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{},
	); err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		DB: db, Auth: auth.New("trash-restore-real-http-perf", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := srv.Router()
	token := createTestUser(t, db, router, "trash-restore-owner", "password-restore")
	otherToken := createTestUser(t, db, router, "trash-restore-foreign", "password-foreign")
	var owner meta.User
	if err := db.Where("username = ?", "trash-restore-owner").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	var parent meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", owner.ID).First(&parent).Error; err != nil {
		t.Fatal(err)
	}
	selected := meta.Node{
		ParentID: &parent.ID, Name: "restore-many",
		Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 2,
	}
	sibling := meta.Node{
		ParentID: &parent.ID, Name: "unselected",
		Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sibling).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	deleted := time.Now().UTC().Add(-time.Hour)
	if err := db.Model(&meta.Node{}).Where("id = ?", selected.ID).
		Updates(map[string]any{"deleted_at": deleted, "trash_root_id": selected.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision,
  deleted_at, trash_root_id, created_at, updated_at)
SELECT ?, 'file-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1,
  ?, ?, NOW(), NOW()
FROM generate_series(1, ?) AS gs
`, selected.ID, owner.ID, deleted, selected.ID, count).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (node_id, size, storage_key, sha256, created_at, updated_at)
SELECT n.id, 1024, 'perf/restore/' || n.id::text, '', NOW(), NOW()
FROM xd_nodes AS n
WHERE n.parent_id = ? AND n.owner_id = ?
`, selected.ID, owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	httpServer := httptest.NewServer(router)
	t.Cleanup(httpServer.Close)
	client := &http.Client{Timeout: 20 * time.Second}
	url := fmt.Sprintf("%s/api/v1/trash/%d/restore", httpServer.URL, selected.ID)
	request := func(accessToken string) (*http.Response, error) {
		req, err := http.NewRequest(http.MethodPost, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("If-Match", strconv.Quote("2"))
		return client.Do(req)
	}
	otherResponse, err := request(otherToken)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, otherResponse.Body)
	_ = otherResponse.Body.Close()
	if otherResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign account restore status=%d want 404", otherResponse.StatusCode)
	}
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	start := time.Now()
	resp, requestErr := request(token)
	status := 0
	var responseBytes []byte
	if resp != nil {
		status = resp.StatusCode
		responseBytes, err = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	elapsedMS := float64(time.Since(start).Microseconds()) / 1000
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	var correct, invalid, files int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND trash_root_id IS NULL AND revision = 1", owner.ID, selected.ID).
		Count(&correct).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ?", owner.ID, selected.ID).
		Where("deleted_at IS NOT NULL OR trash_root_id IS NOT NULL OR revision <> 1").
		Count(&invalid).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).
		Joins("JOIN xd_nodes AS n ON n.id = xd_files.node_id").
		Where("n.parent_id = ? AND n.owner_id = ?", selected.ID, owner.ID).
		Count(&files).Error; err != nil {
		t.Fatal(err)
	}
	var root, unaffected meta.Node
	if err := db.First(&root, selected.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&unaffected, sibling.ID).Error; err != nil {
		t.Fatal(err)
	}
	rootRestored := root.DeletedAt == nil && root.TrashRootID == nil && root.Revision == 3
	siblingUnchanged := unaffected.DeletedAt == nil && unaffected.TrashRootID == nil && unaffected.Revision == 1
	result := map[string]any{
		"count": count, "seed_ms": seedMS, "http_ms": elapsedMS,
		"status": status, "http_error": fmt.Sprint(requestErr),
		"response_bytes": len(responseBytes),
		"restored":       correct, "invalid": invalid, "file_rows": files,
		"root_restored": rootRestored, "sibling_unchanged": siblingUnchanged,
		"go_total_alloc_delta_bytes": after.TotalAlloc - before.TotalAlloc,
		"workload":                   "real-Gin-authenticated-PostgreSQL17-trash-restore",
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("TRASH_RESTORE_REAL_HTTP_PERF %s", encoded)
	if requestErr != nil || status != http.StatusOK ||
		correct != int64(count) || invalid != 0 || files != int64(count) ||
		!rootRestored || !siblingUnchanged {
		t.Fatalf("real HTTP Trash restore invalid: %+v body=%q", result, responseBytes)
	}
	var node nodeDTO
	if err := json.Unmarshal(responseBytes, &node); err != nil {
		t.Fatal(err)
	}
	if node.ID != selected.ID || node.Revision != 3 {
		t.Fatalf("restored HTTP node mismatch: %+v", node)
	}
}
