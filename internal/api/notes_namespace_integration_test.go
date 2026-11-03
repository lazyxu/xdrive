package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
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

func TestNotesNamespaceOwnerBoundAndOrdinaryFilesCannotWrite(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "notes_namespace_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.AuditEvent{}, &meta.FileOperation{}, &meta.NotesNamespace{},
	); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{DB: db, Store: store,
		Auth:       auth.New("notes-namespace-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 8 << 20,
	}).Router()
	tokenA := createTestUser(t, db, router, "notes-owner-a", "notes-pass-a")
	tokenB := createTestUser(t, db, router, "notes-owner-b", "notes-pass-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	if rootA.ID == rootB.ID {
		t.Fatal("two Owners share a root")
	}

	// The system owns both reserved segments; ordinary Files cannot squat on them.
	request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"@xDrive"}`), http.StatusConflict)
	response := request(t, router, http.MethodPost,
		"/api/v1/notes/namespace", tokenA, strings.NewReader(`{}`), http.StatusOK)
	var first notesNamespaceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.SystemNodeID == 0 || first.NotesNodeID == 0 ||
		first.IOSNodeID == 0 || first.MineNodeID == 0 {
		t.Fatalf("missing nodes: %+v", first)
	}
	response = request(t, router, http.MethodPost,
		"/api/v1/notes/namespace", tokenA, strings.NewReader(`{}`), http.StatusOK)
	var again notesNamespaceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &again); err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Fatalf("bootstrap changed bindings: %+v -> %+v", first, again)
	}

	// Owner B has no access to Owner A's Notes, even by knowing the Node ID.
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", first.NotesNodeID),
		tokenB, nil, http.StatusNotFound)
	response = request(t, router, http.MethodPost, "/api/v1/notes/namespace",
		tokenB, strings.NewReader(`{}`), http.StatusOK)
	var second notesNamespaceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if first.NotesNodeID == second.NotesNodeID || first.SystemNodeID == second.SystemNodeID {
		t.Fatalf("Notes namespace leaked across Owners: %+v vs %+v", first, second)
	}

	// A normal Files upload, create, mutation, share or file-ops queue may
	// never write to the Notes tree or modify its structural parent.
	request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", first.MineNodeID),
		tokenA, strings.NewReader(`{"name":"oops"}`), http.StatusConflict)
	request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", first.SystemNodeID),
		tokenA, strings.NewReader(`{"name":"@备忘录"}`), http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/uploads", tokenA,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"a.md","size":1,"chunk_size":4194304}`, first.IOSNodeID)),
		http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/uploads", tokenA,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"a.md","size":1,"chunk_size":4194304}`, first.MineNodeID)),
		http.StatusConflict)
	request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", first.NotesNodeID),
		tokenA, strings.NewReader(`{"access":"view"}`), http.StatusConflict)

	var uid uint64
	if err := db.Model(&meta.Node{}).Select("owner_id").Where("id = ?", rootA.ID).
		Scan(&uid).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []uint64{first.SystemNodeID, first.NotesNodeID, first.IOSNodeID, first.MineNodeID} {
		locked, err := notesProtectedNodeTx(context.Background(), db, uid, id)
		if err != nil || !locked {
			t.Fatalf("managed node not protected id=%d result=%v err=%v", id, locked, err)
		}
	}
	locked, err := notesProtectedNodeTx(context.Background(), db, uid, rootA.ID)
	if err != nil || locked {
		t.Fatalf("Owner root must remain usable: %v %v", locked, err)
	}
	// Normal root file directory functions continue to work.
	requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"Other Files"}`), http.StatusCreated)
}
