package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	adminpkg "github.com/lazyxu/xdrive/internal/admin"
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
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
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
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 30 * 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "alice", "password-a")
	tokenB := createTestUser(t, db, router, "bob-user", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)

	dir := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID), tokenA, strings.NewReader(`{"name":"docs"}`), http.StatusCreated)
	file := uploadTestFile(t, router, tokenA, dir.ID, "hello.txt", "hello world")
	if file.Size != 11 {
		t.Fatalf("size=%d", file.Size)
	}

	// Another user cannot read or mutate Alice's node IDs.
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenB, nil, http.StatusNotFound)
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", dir.ID), tokenB, nil, http.StatusNotFound, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", dir.Revision)})

	res := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusOK)
	if got := res.Body.String(); got != "hello world" {
		t.Fatalf("download=%q", got)
	}

	res = requestWithHeaders(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusPartialContent, map[string]string{"Range": "bytes=6-10"})
	if got := res.Body.String(); got != "world" {
		t.Fatalf("range=%q", got)
	}

	updated := requestNodeWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, strings.NewReader("updated"), http.StatusOK, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	if updated.Size != 7 {
		t.Fatalf("updated size=%d", updated.Size)
	}

	renamed := requestNodeWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID), tokenA, strings.NewReader(`{"name":"renamed.txt"}`), http.StatusOK, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", updated.Revision)})
	if renamed.Name != "renamed.txt" {
		t.Fatalf("renamed=%q", renamed.Name)
	}

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", dir.ID), tokenA, nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", dir.Revision)})
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), tokenA, nil, http.StatusNotFound)
}

func createTestUser(t *testing.T, db *gorm.DB, h http.Handler, username, password string) string {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	var user meta.User
	err = db.Transaction(func(tx *gorm.DB) error {
		user = meta.User{
			Username:       username,
			PasswordHash:   hash,
			Role:           meta.UserRoleUser,
			SessionVersion: 1,
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Create(&meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	out := loginTestUser(t, h, username, password, http.StatusOK)
	return out.AccessToken
}

func loginTestUser(t *testing.T, h http.Handler, username, password string, status int) authResponse {
	t.Helper()
	res := request(t, h, http.MethodPost, "/api/v1/auth/login", "", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)), status)
	var out authResponse
	if status/100 == 2 {
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.AccessToken == "" || out.RefreshToken == "" {
			t.Fatalf("login response missing tokens: %s", res.Body.String())
		}
	}
	return out
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

func requestNodeWithHeaders(t *testing.T, h http.Handler, method, path, token string, body io.Reader, status int, headers map[string]string) nodeDTO {
	t.Helper()
	res := requestWithHeaders(t, h, method, path, token, body, status, headers)
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

func TestRefreshTokenRotationAndLogout(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("integration-test-secret", 5*time.Minute),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	createTestUser(t, db, router, "refresh-user", "password-123")
	first := loginTestUser(t, router, "refresh-user", "password-123", http.StatusOK)
	if first.AccessToken == "" || first.RefreshToken == "" || first.Token != first.AccessToken {
		t.Fatalf("invalid initial session: %#v", first)
	}

	refreshBody := strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, first.RefreshToken))
	refreshed := request(t, router, http.MethodPost, "/api/v1/auth/refresh", "", refreshBody, http.StatusOK)
	var second authResponse
	if err := json.Unmarshal(refreshed.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.AccessToken == "" || second.RefreshToken == "" || second.RefreshToken == first.RefreshToken {
		t.Fatalf("refresh did not rotate session: %#v", second)
	}

	request(t, router, http.MethodPost, "/api/v1/auth/refresh", "", strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, first.RefreshToken)), http.StatusUnauthorized)
	request(t, router, http.MethodGet, "/api/v1/nodes/root", second.AccessToken, nil, http.StatusOK)
	request(t, router, http.MethodPost, "/api/v1/auth/logout", "", strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, second.RefreshToken)), http.StatusNoContent)
	request(t, router, http.MethodPost, "/api/v1/auth/refresh", "", strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, second.RefreshToken)), http.StatusUnauthorized)
}

func TestRevisionConflictPreservesServerContent(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
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
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 30 * 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	token := createTestUser(t, db, router, "conflict-user", "password-conflict")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	file := uploadTestFile(t, router, token, root.ID, "shared.txt", "base")
	if file.Revision != 1 {
		t.Fatalf("initial revision=%d want=1", file.Revision)
	}

	first := requestNodeWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token,
		strings.NewReader("writer-a"), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	if first.Revision != 2 {
		t.Fatalf("first revision=%d want=2", first.Revision)
	}

	conflict := requestWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token,
		strings.NewReader("writer-b"), http.StatusConflict,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	var conflictBody struct {
		Error    string `json:"error"`
		Expected uint64 `json:"expected_revision"`
		Current  uint64 `json:"current_revision"`
	}
	if err := json.Unmarshal(conflict.Body.Bytes(), &conflictBody); err != nil {
		t.Fatal(err)
	}
	if conflictBody.Error != "revision_conflict" || conflictBody.Expected != 1 || conflictBody.Current != 2 {
		t.Fatalf("unexpected conflict response: %+v", conflictBody)
	}

	res := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token, nil, http.StatusOK)
	if got := res.Body.String(); got != "writer-a" {
		t.Fatalf("content after conflict=%q want writer-a", got)
	}

	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token,
		strings.NewReader(`{"name":"stale.txt"}`), http.StatusConflict,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil,
		http.StatusConflict, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", first.Revision)})
}

func TestMutationRequiresIfMatch(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	token := createTestUser(t, db, router, "precondition-user", "password-123")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	file := uploadTestFile(t, router, token, root.ID, "a.txt", "a")
	request(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token, strings.NewReader("b"), http.StatusPreconditionRequired)
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, strings.NewReader(`{"name":"b.txt"}`), http.StatusPreconditionRequired)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil, http.StatusPreconditionRequired)
}

func TestAdminUserLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 30 * 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}
	router := server.Router()

	// Public account creation is intentionally absent.
	request(t, router, http.MethodPost, "/api/v1/auth/register", "", strings.NewReader(`{"username":"nope","password":"password-123"}`), http.StatusNotFound)

	adminUser, err := adminpkg.Bootstrap(db, "root-admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	adminSession := loginTestUser(t, router, "root-admin", "admin-password", http.StatusOK)
	if adminSession.Role != meta.UserRoleAdmin || adminSession.MustChangePassword {
		t.Fatalf("unexpected admin session: %#v", adminSession)
	}

	createdRes := request(t, router, http.MethodPost, "/api/v1/admin/users", adminSession.AccessToken,
		strings.NewReader(`{"username":"alice-managed","password":"temporary-123","role":"user","must_change_password":true}`), http.StatusCreated)
	var managed userDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &managed); err != nil {
		t.Fatal(err)
	}
	if managed.Role != meta.UserRoleUser || !managed.MustChangePassword || managed.Disabled {
		t.Fatalf("unexpected managed user: %#v", managed)
	}

	aliceInitial := loginTestUser(t, router, "alice-managed", "temporary-123", http.StatusOK)
	if !aliceInitial.MustChangePassword {
		t.Fatal("temporary-password user was not marked must_change_password")
	}
	request(t, router, http.MethodGet, "/api/v1/nodes/root", aliceInitial.AccessToken, nil, http.StatusForbidden)

	changeRes := request(t, router, http.MethodPost, "/api/v1/me/change-password", aliceInitial.AccessToken,
		strings.NewReader(`{"current_password":"temporary-123","new_password":"alice-new-password"}`), http.StatusOK)
	var aliceSession authResponse
	if err := json.Unmarshal(changeRes.Body.Bytes(), &aliceSession); err != nil {
		t.Fatal(err)
	}
	if aliceSession.MustChangePassword || aliceSession.AccessToken == "" || aliceSession.RefreshToken == "" {
		t.Fatalf("password change did not create usable session: %#v", aliceSession)
	}
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", aliceSession.AccessToken, nil, http.StatusOK)

	// A normal user cannot access administrator APIs.
	request(t, router, http.MethodGet, "/api/v1/admin/users", aliceSession.AccessToken, nil, http.StatusForbidden)

	file := uploadTestFile(t, router, aliceSession.AccessToken, root.ID, "owned.txt", "owned-data")
	var stored meta.File
	if err := db.First(&stored, "node_id = ?", file.ID).Error; err != nil {
		t.Fatal(err)
	}

	// Disable is immediate for both access and refresh credentials.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"disabled":true}`), http.StatusOK)
	request(t, router, http.MethodGet, "/api/v1/nodes/root", aliceSession.AccessToken, nil, http.StatusForbidden)
	request(t, router, http.MethodPost, "/api/v1/auth/refresh", "",
		strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, aliceSession.RefreshToken)), http.StatusUnauthorized)

	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"disabled":false}`), http.StatusOK)
	aliceEnabled := loginTestUser(t, router, "alice-managed", "alice-new-password", http.StatusOK)

	// Password reset revokes current access + refresh immediately and replaces the password.
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/reset-password", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"password":"reset-password-123","must_change_password":true}`), http.StatusNoContent)
	request(t, router, http.MethodGet, "/api/v1/nodes/root", aliceEnabled.AccessToken, nil, http.StatusUnauthorized)
	request(t, router, http.MethodPost, "/api/v1/auth/refresh", "",
		strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, aliceEnabled.RefreshToken)), http.StatusUnauthorized)
	loginTestUser(t, router, "alice-managed", "alice-new-password", http.StatusUnauthorized)

	aliceReset := loginTestUser(t, router, "alice-managed", "reset-password-123", http.StatusOK)
	if !aliceReset.MustChangePassword {
		t.Fatal("reset password did not require password change")
	}
	changeRes = request(t, router, http.MethodPost, "/api/v1/me/change-password", aliceReset.AccessToken,
		strings.NewReader(`{"current_password":"reset-password-123","new_password":"alice-final-password"}`), http.StatusOK)
	if err := json.Unmarshal(changeRes.Body.Bytes(), &aliceSession); err != nil {
		t.Fatal(err)
	}

	// Explicit session revocation invalidates an existing access token immediately.
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/revoke-sessions", managed.ID), adminSession.AccessToken,
		nil, http.StatusNoContent)
	request(t, router, http.MethodGet, "/api/v1/nodes/root", aliceSession.AccessToken, nil, http.StatusUnauthorized)

	aliceFinal := loginTestUser(t, router, "alice-managed", "alice-final-password", http.StatusOK)
	// Role changes take effect immediately because requireAdmin reads the current DB row.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"role":"admin"}`), http.StatusOK)
	request(t, router, http.MethodGet, "/api/v1/admin/users", aliceFinal.AccessToken, nil, http.StatusOK)
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), aliceFinal.AccessToken,
		strings.NewReader(`{"role":"user"}`), http.StatusBadRequest)

	// Administrators cannot disable or delete their own account.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", adminUser.ID), adminSession.AccessToken,
		strings.NewReader(`{"disabled":true}`), http.StatusBadRequest)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/admin/users/%d", adminUser.ID), adminSession.AccessToken,
		nil, http.StatusBadRequest)

	// The original administrator can permanently delete the second administrator/user and its blobs.
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		nil, http.StatusNoContent)
	if err := db.First(&meta.User{}, managed.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("deleted user still exists: %v", err)
	}
	if _, err := store.Open(context.Background(), stored.StorageKey); err == nil {
		t.Fatal("deleted user's blob still exists")
	}
}

func TestTrashAndVersionHistory(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
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
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	token := createTestUser(t, db, router, "history-user", "history-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	file := uploadTestFile(t, router, token, root.ID, "history.txt", "version-one")
	versionTwo := requestNodeWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token,
		strings.NewReader("version-two"), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	if versionTwo.Revision != 2 {
		t.Fatalf("revision=%d want=2", versionTwo.Revision)
	}

	versionsRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/versions", file.ID), token, nil, http.StatusOK)
	var versions []fileVersionDTO
	if err := json.Unmarshal(versionsRes.Body.Bytes(), &versions); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0].Revision != 1 || versions[0].Size != int64(len("version-one")) {
		t.Fatalf("unexpected versions: %+v", versions)
	}
	oldVersion := versions[0]
	oldContent := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/content", file.ID, oldVersion.ID),
		token, nil, http.StatusOK)
	if got := oldContent.Body.String(); got != "version-one" {
		t.Fatalf("historical content=%q", got)
	}

	restored := requestNodeWithHeaders(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/restore", file.ID, oldVersion.ID),
		token, nil, http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", versionTwo.Revision)})
	if restored.Revision != 3 {
		t.Fatalf("restored revision=%d want=3", restored.Revision)
	}
	current := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token, nil, http.StatusOK)
	if got := current.Body.String(); got != "version-one" {
		t.Fatalf("restored current content=%q", got)
	}

	versionsRes = request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/versions", file.ID), token, nil, http.StatusOK)
	versions = nil
	if err := json.Unmarshal(versionsRes.Body.Bytes(), &versions); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0].Revision != 2 {
		t.Fatalf("restore should preserve former current as history: %+v", versions)
	}
	formerCurrent := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/content", file.ID, versions[0].ID),
		token, nil, http.StatusOK)
	if got := formerCurrent.Body.String(); got != "version-two" {
		t.Fatalf("former current history content=%q", got)
	}

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", restored.Revision)})
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token, nil, http.StatusNotFound)

	trashRes := request(t, router, http.MethodGet, "/api/v1/trash", token, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 || trash[0].ID != file.ID || trash[0].DeletedAt == nil {
		t.Fatalf("unexpected trash: %+v", trash)
	}

	restoredFromTrash := requestNodeWithHeaders(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/trash/%d/restore", file.ID), token, nil, http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})
	if restoredFromTrash.DeletedAt != nil {
		t.Fatalf("restored item still marked deleted: %+v", restoredFromTrash)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", file.ID), token, nil, http.StatusOK)

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", restoredFromTrash.Revision)})
	trashRes = request(t, router, http.MethodGet, "/api/v1/trash", token, nil, http.StatusOK)
	trash = nil
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 {
		t.Fatalf("trash after second delete=%+v", trash)
	}

	var currentFile meta.File
	if err := db.Where("node_id = ?", file.ID).First(&currentFile).Error; err != nil {
		t.Fatal(err)
	}
	var history []meta.FileVersion
	if err := db.Where("node_id = ?", file.ID).Find(&history).Error; err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 {
		t.Fatalf("history before permanent delete=%+v", history)
	}

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", file.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})

	if err := db.First(&meta.Node{}, file.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("permanently deleted node still exists: %v", err)
	}
	if _, err := store.Open(context.Background(), currentFile.StorageKey); err == nil {
		t.Fatal("current blob survived permanent delete")
	}
	for _, version := range history {
		if _, err := store.Open(context.Background(), version.StorageKey); err == nil {
			t.Fatalf("historical blob survived permanent delete: %s", version.StorageKey)
		}
	}
}

func TestTrashRestoreRejectsNameCollision(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.FileVersion{}, &meta.File{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
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
		DB: db, Store: store, Auth: auth.New("integration-test-secret", time.Hour), RefreshTTL: 24 * time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	token := createTestUser(t, db, router, "trash-collision", "trash-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	first := uploadTestFile(t, router, token, root.ID, "same.txt", "first")
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", first.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", first.Revision)})
	_ = uploadTestFile(t, router, token, root.ID, "same.txt", "second")
	trashRes := request(t, router, http.MethodGet, "/api/v1/trash", token, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 {
		t.Fatalf("trash=%+v", trash)
	}
	requestWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/trash/%d/restore", first.ID), token, nil,
		http.StatusConflict, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})
}
