package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
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
		&meta.AuditEvent{}, &meta.FileOperation{}, &meta.NotesNamespace{}, &meta.Note{},
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
		tokenA, strings.NewReader(`{"name":"@笔记"}`), http.StatusConflict)
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
		tokenA, strings.NewReader("{\"name\":\"Other Files\"}"), http.StatusCreated)

	// Files reads stay available to the owning account, while every ordinary
	// Files mutation route remains blocked for a managed Notes Markdown Node.
	const originalMarkdown = "# protected Notes bytes"
	created := request(t, router, http.MethodPost, "/api/v1/notes", tokenA,
		strings.NewReader("{\"title\":\"Protected file\",\"markdown\":\"# protected Notes bytes\"}"),
		http.StatusCreated)
	var note notesDTO
	if err := json.Unmarshal(created.Body.Bytes(), &note); err != nil {
		t.Fatal(err)
	}
	if note.NodeID == 0 || note.Revision != 1 {
		t.Fatalf("invalid managed Note receipt: %+v", note)
	}
	ownedNode := requestNode(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", note.NodeID), tokenA, nil, http.StatusOK)
	if ownedNode.ID != note.NodeID {
		t.Fatalf("Owner could not read managed Notes Node: %+v", ownedNode)
	}
	content := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", note.NodeID), tokenA, nil, http.StatusOK)
	if content.Body.String() != originalMarkdown {
		t.Fatalf("Owner Files read changed Notes bytes: %q", content.Body.String())
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", note.NodeID), tokenB, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", note.NodeID), tokenB, nil, http.StatusNotFound)

	updatedResponse := request(t, router, http.MethodPut, "/api/v1/notes/"+note.ID, tokenA,
		strings.NewReader("{\"title\":\"Protected file\",\"markdown\":\"# version two\",\"expected_revision\":1}"),
		http.StatusOK)
	var updated notesDTO
	if err := json.Unmarshal(updatedResponse.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 {
		t.Fatalf("Notes API did not create a versioned update: %+v", updated)
	}
	var oldVersion meta.FileVersion
	if err := db.Where("node_id = ? AND revision = ?", note.NodeID, 1).First(&oldVersion).Error; err != nil {
		t.Fatal(err)
	}
	managedPath := fmt.Sprintf("/api/v1/nodes/%d", note.NodeID)
	requestWithIfMatch(t, router, http.MethodPatch, managedPath, tokenA,
		"{\"name\":\"renamed.md\"}", updated.Revision, http.StatusConflict)
	requestWithIfMatch(t, router, http.MethodPatch, managedPath, tokenA,
		fmt.Sprintf("{\"parent_id\":%d}", rootA.ID), updated.Revision, http.StatusConflict)
	requestWithIfMatch(t, router, http.MethodDelete, managedPath, tokenA,
		"", updated.Revision, http.StatusConflict)
	request(t, router, http.MethodPost, managedPath+"/copy", tokenA,
		strings.NewReader(fmt.Sprintf("{\"parent_id\":%d}", rootA.ID)), http.StatusConflict)

	batchBody := func() string {
		return fmt.Sprintf("{\"items\":[{\"id\":%d,\"revision\":%d}],\"parent_id\":%d}",
			note.NodeID, updated.Revision, rootA.ID)
	}
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/copy", tokenA,
		strings.NewReader(batchBody()), http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/move", tokenA,
		strings.NewReader(batchBody()), http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/delete", tokenA,
		strings.NewReader(fmt.Sprintf("{\"items\":[{\"id\":%d,\"revision\":%d}]}",
			note.NodeID, updated.Revision)), http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/file-operations", tokenA,
		strings.NewReader(fmt.Sprintf("{\"type\":\"copy\",\"items\":[{\"id\":%d,\"revision\":%d}],\"parent_id\":%d}",
			note.NodeID, updated.Revision, rootA.ID)), http.StatusConflict)
	request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", note.NodeID), tokenA,
		strings.NewReader("{\"access\":\"view\"}"), http.StatusConflict)
	requestWithIfMatch(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/restore", note.NodeID, oldVersion.ID),
		tokenA, "", updated.Revision, http.StatusConflict)

	// The Notes-specific editor remains the only supported write path.
	finalRead := request(t, router, http.MethodGet, "/api/v1/notes/"+note.ID,
		tokenA, nil, http.StatusOK)
	var finalNote notesDTO
	if err := json.Unmarshal(finalRead.Body.Bytes(), &finalNote); err != nil {
		t.Fatal(err)
	}
	if finalNote.Revision != 2 || finalNote.Markdown == nil || *finalNote.Markdown != "# version two" {
		t.Fatalf("blocked Files mutations changed the authoritative Note: %+v", finalNote)
	}
}

func requestWithIfMatch(
	t *testing.T, router http.Handler, method, path, token, body string,
	revision uint64, expected int,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("If-Match", strconv.FormatUint(revision, 10))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != expected {
		t.Fatalf("%s %s: HTTP %d want %d: %s", method, path, response.Code, expected, response.Body.String())
	}
	return response
}

