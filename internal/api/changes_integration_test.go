package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestNodeChangeJournalLifecycleAndOwnerScope(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP TRIGGER IF EXISTS xd_nodes_change_journal ON xd_nodes`).Error; err != nil {
		// xd_nodes may not exist in a fresh database.
		_ = err
	}
	if err := db.Migrator().DropTable(
		&meta.NodeChange{}, &meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{},
		&meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := meta.InstallNodeChangeJournal(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("node-change-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	token := createTestUser(t, db, router, "journal-user", "password-123")
	initial := requestNodeChangePage(t, router, token, 0, 100)
	if initial.LatestCursor == 0 {
		t.Fatal("root creation was not journaled")
	}
	cursor := initial.LatestCursor
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	docs := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"docs"}`), http.StatusCreated)
	file := uploadTestFile(t, router, token, docs.ID, "a.txt", "hello")

	created := requestNodeChangePage(t, router, token, cursor, 100)
	assertNodeChange(t, created.Changes, docs.ID, "upsert", "docs")
	assertNodeChange(t, created.Changes, file.ID, "upsert", "docs/a.txt")
	if created.NextCursor <= cursor || created.LatestCursor < created.NextCursor {
		t.Fatalf("created page=%+v", created)
	}

	cursor = created.LatestCursor
	renamed := requestNodeWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token,
		strings.NewReader(`{"name":"b.txt"}`), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf(`"%d"`, file.Revision)})
	changed := requestNodeChangePage(t, router, token, cursor, 100)
	assertNodeChange(t, changed.Changes, file.ID, "upsert", "docs/b.txt")
	if renamed.Revision <= file.Revision {
		t.Fatalf("rename revision=%d old=%d", renamed.Revision, file.Revision)
	}

	cursor = changed.LatestCursor
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf(`"%d"`, renamed.Revision)})
	deleted := requestNodeChangePage(t, router, token, cursor, 100)
	assertNodeChange(t, deleted.Changes, file.ID, "delete", "")

	cursor = deleted.LatestCursor
	_ = createTestUser(t, db, router, "journal-user-2", "password-456")
	scoped := requestNodeChangePage(t, router, token, cursor, 100)
	if len(scoped.Changes) != 0 || scoped.LatestCursor != cursor {
		t.Fatalf("other user's changes leaked into page: %+v", scoped)
	}

	reset := requestNodeChangePage(t, router, token, cursor+1000, 100)
	if !reset.ResetRequired || reset.NextCursor != cursor || reset.LatestCursor != cursor {
		t.Fatalf("reset page=%+v", reset)
	}
}

func requestNodeChangePage(t *testing.T, h http.Handler, token string, after uint64, limit int) nodeChangePageDTO {
	t.Helper()
	res := request(t, h, http.MethodGet,
		fmt.Sprintf("/api/v1/changes?after=%d&limit=%d", after, limit), token, nil, http.StatusOK)
	var page nodeChangePageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func assertNodeChange(t *testing.T, changes []nodeChangeDTO, nodeID uint64, operation, path string) {
	t.Helper()
	for _, change := range changes {
		if change.NodeID != nodeID {
			continue
		}
		if change.Operation != operation {
			t.Fatalf("node %d operation=%q want=%q", nodeID, change.Operation, operation)
		}
		if change.Path != path {
			t.Fatalf("node %d path=%q want=%q", nodeID, change.Path, path)
		}
		if operation == "upsert" && change.Node == nil {
			t.Fatalf("node %d upsert has no node payload", nodeID)
		}
		if operation == "delete" && change.Node != nil {
			t.Fatalf("node %d delete unexpectedly has node payload", nodeID)
		}
		return
	}
	t.Fatalf("node %d change not found in %+v", nodeID, changes)
}
