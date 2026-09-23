package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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

func TestFileCRUDAndUserIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.File{}, &meta.Node{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour),
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := registerTestUser(t, router, "alice", "password-a")
	tokenB := registerTestUser(t, router, "bob-user", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)

	dir := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID), tokenA, strings.NewReader(`{"name":"docs"}`), http.StatusCreated)
	file := uploadTestFile(t, router, tokenA, dir.ID, "hello.txt", "hello world")
	if file.Size != 11 {
		t.Fatalf("size=%d", file.Size)
	}

	// Another user cannot read or mutate Alice's node IDs.
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenB, nil, http.StatusNotFound)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", dir.ID), tokenB, nil, http.StatusNotFound)

	res := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusOK)
	if got := res.Body.String(); got != "hello world" {
		t.Fatalf("download=%q", got)
	}

	res = requestWithHeaders(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusPartialContent, map[string]string{"Range": "bytes=6-10"})
	if got := res.Body.String(); got != "world" {
		t.Fatalf("range=%q", got)
	}

	updated := requestNode(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, strings.NewReader("updated"), http.StatusOK)
	if updated.Size != 7 {
		t.Fatalf("updated size=%d", updated.Size)
	}

	renamed := requestNode(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID), tokenA, strings.NewReader(`{"name":"renamed.txt"}`), http.StatusOK)
	if renamed.Name != "renamed.txt" {
		t.Fatalf("renamed=%q", renamed.Name)
	}

	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", dir.ID), tokenA, nil, http.StatusNoContent)
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusNotFound)
}

func registerTestUser(t *testing.T, h http.Handler, username, password string) string {
	t.Helper()
	res := request(t, h, http.MethodPost, "/api/v1/auth/register", "", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)), http.StatusCreated)
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil || out.Token == "" {
		t.Fatalf("register response %s err=%v", res.Body.String(), err)
	}
	return out.Token
}

func uploadTestFile(t *testing.T, h http.Handler, token string, parentID uint64, name, content string) nodeDTO {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(part, content)
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/files", parentID), &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("upload code=%d body=%s", res.Code, res.Body.String())
	}
	var out nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func requestNode(t *testing.T, h http.Handler, method, path, token string, body io.Reader, status int) nodeDTO {
	t.Helper()
	res := request(t, h, method, path, token, body, status)
	var out nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func request(t *testing.T, h http.Handler, method, path, token string, body io.Reader, status int) *httptest.ResponseRecorder {
	t.Helper()
	return requestWithHeaders(t, h, method, path, token, body, status, nil)
}

func requestWithHeaders(t *testing.T, h http.Handler, method, path, token string, body io.Reader, status int, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil && method != http.MethodPut {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != status {
		t.Fatalf("%s %s code=%d want=%d body=%s", method, path, res.Code, status, res.Body.String())
	}
	return res
}
