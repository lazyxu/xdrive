package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type trashPermanentPerfLogger struct {
	logger.Interface
	mu     sync.Mutex
	errors []string
}

func (l *trashPermanentPerfLogger) Trace(ctx context.Context, begin time.Time, callback func() (string, int64), err error) {
	if err != nil {
		l.mu.Lock()
		l.errors = append(l.errors, err.Error())
		l.mu.Unlock()
	}
}

func (l *trashPermanentPerfLogger) hasBindOverflow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, value := range l.errors {
		if strings.Contains(strings.ToLower(value), "65535") {
			return true
		}
	}
	return false
}

// TestTrashPermanentDeleteRealHTTPPerformance10K100K runs the authentic
// authenticated DELETE /trash/:id transaction against native PostgreSQL.
// All File/FileVersion storage keys are deliberately empty: this measures
// durable metadata, Share, and audit SQL, not physical CAS file deletion.
func TestTrashPermanentDeleteRealHTTPPerformance10K100K(t *testing.T) {
	if os.Getenv("XD_TRASH_PERMANENT_HTTP_PERF") != "1" {
		t.Skip("enable XD_TRASH_PERMANENT_HTTP_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is absent")
	}
	count, err := strconv.Atoi(os.Getenv("XD_TRASH_PERMANENT_HTTP_COUNT"))
	if err != nil || (count != 10000 && count != 100000) {
		t.Fatal("XD_TRASH_PERMANENT_HTTP_COUNT must be 10000 or 100000")
	}
	expectFixed := os.Getenv("XD_TRASH_PERMANENT_HTTP_EXPECT_FIXED") == "1"
	gin.SetMode(gin.TestMode)
	dbLogger := &trashPermanentPerfLogger{Interface: logger.Discard}
	db := fileExplorerMediaPerfDatabase(t, dsn).Session(&gorm.Session{Logger: dbLogger})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{},
	); err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Auth: auth.New("trash-permanent-100k-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "permanent-owner", "password-permanent")
	other := createTestUser(t, db, router, "permanent-other", "password-other")
	var owner meta.User
	if err := db.Where("username = ?", "permanent-owner").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	var parent meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", owner.ID).First(&parent).Error; err != nil {
		t.Fatal(err)
	}
	selected := meta.Node{
		ParentID: &parent.ID, Name: "permanent-selected", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 2,
	}
	sibling := meta.Node{
		ParentID: &parent.ID, Name: "permanent-unselected", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sibling).Error; err != nil {
		t.Fatal(err)
	}
	seedStarted := time.Now()
	deletedAt := time.Now().UTC().Add(-time.Hour)
	if err := db.Model(&meta.Node{}).Where("id = ?", selected.ID).
		Updates(map[string]any{"deleted_at": deletedAt, "trash_root_id": selected.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, deleted_at, trash_root_id, created_at, updated_at) "+
		"SELECT ?, 'purge-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, ?, ?, NOW(), NOW() "+
		"FROM generate_series(1, ?) AS gs", selected.ID, owner.ID, deletedAt, selected.ID, count).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_files (node_id, size, storage_key, sha256, created_at, updated_at) "+
		"SELECT n.id, 1024, '', '', NOW(), NOW() FROM xd_nodes n "+
		"WHERE n.owner_id = ? AND n.parent_id = ?", owner.ID, selected.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_file_versions (node_id, revision, size, storage_key, sha256, created_at) "+
		"SELECT n.id, 0, 1024, '', '', NOW() FROM xd_nodes n "+
		"WHERE n.owner_id = ? AND n.parent_id = ?", owner.ID, selected.ID).Error; err != nil {
		t.Fatal(err)
	}
	var representative meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ?", owner.ID, selected.ID).
		Order("id ASC").First(&representative).Error; err != nil {
		t.Fatal(err)
	}
	inScope := meta.Share{OwnerID: owner.ID, NodeID: representative.ID, TokenHash: strings.Repeat("a", 64)}
	outScope := meta.Share{OwnerID: owner.ID, NodeID: sibling.ID, TokenHash: strings.Repeat("b", 64)}
	if err := db.Create(&inScope).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outScope).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_file_versions", "xd_shares"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	client := &http.Client{Timeout: 75 * time.Second}
	url := fmt.Sprintf("%s/api/v1/trash/%d", httpServer.URL, selected.ID)
	perform := func(accessToken string, revision uint64) (int, []byte, error) {
		req, err := http.NewRequest(http.MethodDelete, url, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
		response, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return response.StatusCode, body, err
	}
	foreignStatus, _, err := perform(other, 2)
	if err != nil || foreignStatus != http.StatusNotFound {
		t.Fatalf("foreign owner scope violated: status=%d err=%v", foreignStatus, err)
	}
	staleStatus, _, err := perform(token, 999)
	if err != nil || staleStatus != http.StatusConflict {
		t.Fatalf("revision protection violated: status=%d err=%v", staleStatus, err)
	}
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	started := time.Now()
	status, body, requestErr := perform(token, 2)
	elapsedMS := float64(time.Since(started).Microseconds()) / 1000
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	var nodes, fileRows, versionRows, innerShares, outerShares, auditRows int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND (id = ? OR parent_id = ?)", owner.ID, selected.ID, selected.ID).
		Count(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Count(&fileRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileVersion{}).Count(&versionRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Share{}).Where("id = ?", inScope.ID).Count(&innerShares).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Share{}).Where("id = ?", outScope.ID).Count(&outerShares).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AuditEvent{}).
		Where("actor_user_id = ? AND target_id = ?", owner.ID, strconv.FormatUint(selected.ID, 10)).
		Count(&auditRows).Error; err != nil {
		t.Fatal(err)
	}
	var unaffected meta.Node
	if err := db.First(&unaffected, sibling.ID).Error; err != nil {
		t.Fatal(err)
	}
	siblingUnchanged := unaffected.DeletedAt == nil && unaffected.TrashRootID == nil && unaffected.Revision == 1
	bindError := dbLogger.hasBindOverflow()
	result := map[string]any{
		"workload": "real-HTTP-trash-permanent-delete-100k", "count": count,
		"expect_fixed": expectFixed, "seed_ms": seedMS, "http_ms": elapsedMS,
		"status": status, "response_bytes": len(body), "http_error": fmt.Sprint(requestErr),
		"go_total_alloc_delta_bytes": after.TotalAlloc - before.TotalAlloc,
		"bind_overflow_65535":        bindError, "remaining_nodes": nodes,
		"remaining_files": fileRows, "remaining_file_versions": versionRows,
		"remaining_in_scope_shares": innerShares, "remaining_out_of_scope_shares": outerShares,
		"audit_rows": auditRows, "sibling_unchanged": siblingUnchanged,
		"scope": "signed authenticated Gin HTTP + native PostgreSQL17 10k/100k deleted tree, File+FileVersion metadata; no physical CAS data or browser/IPC",
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("TRASH_PERMANENT_REAL_HTTP_PERF %s", encoded)
	if requestErr != nil || !siblingUnchanged || outerShares != 1 {
		t.Fatalf("permanent delete owner/sibling/transport contract failed: %+v", result)
	}
	if count == 100000 && !expectFixed {
		if status != http.StatusInternalServerError || !bindError || nodes != int64(count+1) ||
			fileRows != int64(count) || versionRows != int64(count) || innerShares != 1 || auditRows != 0 {
			t.Fatalf("original production did not reproduce atomic PostgreSQL 65535-bind failure: %+v body=%q", result, body)
		}
		return
	}
	if status != http.StatusNoContent || len(body) != 0 || bindError ||
		nodes != 0 || fileRows != 0 || versionRows != 0 ||
		innerShares != 0 || auditRows != 1 {
		t.Fatalf("permanent delete did not finish 10k/100k atomic metadata cleanup: %+v body=%q", result, body)
	}
	if count == 10000 && elapsedMS > 5000 {
		t.Fatalf("10k HTTP permanent delete exceeded 5000ms sample cap: %.3fms", elapsedMS)
	}
	if count == 100000 && (elapsedMS > 40000 || after.TotalAlloc-before.TotalAlloc > 512<<20) {
		t.Fatalf("100k HTTP permanent delete exceeded 40s / 512MiB TotalAlloc cap: %+v", result)
	}
}
