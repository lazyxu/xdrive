package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestDownloadShareLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
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
		DB: db, Store: store, Auth: auth.New("share-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	ownerToken := createTestUser(t, db, router, "share-owner", "owner-password")
	otherToken := createTestUser(t, db, router, "share-other", "other-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	file := uploadTestFile(t, router, ownerToken, root.ID, "shared-report.txt", "share-content")

	expiresAt := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	createBody := fmt.Sprintf(`{"expires_at":%q,"password":"share-password","max_downloads":2}`, expiresAt.Format(time.RFC3339))
	createRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(createBody), http.StatusCreated)
	if createRes.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("share creation response is cacheable: %q", createRes.Header().Get("Cache-Control"))
	}

	var created createdShareDTO
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if len(created.Token) < 40 || created.Status != "active" || !created.HasPassword ||
		created.MaxDownloads != 2 || created.DownloadCount != 0 {
		t.Fatalf("unexpected created share: %+v", created)
	}

	var stored meta.Share
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == created.Token || len(stored.TokenHash) != 64 {
		t.Fatalf("raw share token was stored or hash is malformed: %q", stored.TokenHash)
	}
	if stored.PasswordHash == "" || stored.PasswordHash == "share-password" ||
		auth.CheckPassword(stored.PasswordHash, "share-password") != nil {
		t.Fatal("share password was not safely hashed")
	}

	listRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, nil, http.StatusOK)
	if strings.Contains(listRes.Body.String(), created.Token) || strings.Contains(listRes.Body.String(), stored.TokenHash) {
		t.Fatalf("share list leaked token material: %s", listRes.Body.String())
	}
	var listed []shareDTO
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("unexpected share list: %+v", listed)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		otherToken, nil, http.StatusNotFound)

	metaRes := publicShareRequest(t, router, http.MethodGet, created.Token, nil, http.StatusOK)
	var public publicShareDTO
	if err := json.Unmarshal(metaRes.Body.Bytes(), &public); err != nil {
		t.Fatal(err)
	}
	if public.Name != file.Name || public.Size != int64(len("share-content")) || !public.RequiresPassword ||
		public.MaxDownloads != 2 || public.DownloadCount != 0 {
		t.Fatalf("unexpected public metadata: %+v", public)
	}

	publicShareRequest(t, router, http.MethodPost, created.Token,
		strings.NewReader(`{"password":"wrong-password"}`), http.StatusUnauthorized)
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DownloadCount != 0 {
		t.Fatalf("wrong password consumed download count: %d", stored.DownloadCount)
	}

	first := publicShareRequest(t, router, http.MethodPost, created.Token,
		strings.NewReader(`{"password":"share-password"}`), http.StatusOK)
	if got := first.Body.String(); got != "share-content" {
		t.Fatalf("first shared download=%q", got)
	}
	second := publicShareRequest(t, router, http.MethodPost, created.Token,
		strings.NewReader(`{"password":"share-password"}`), http.StatusOK)
	if got := second.Body.String(); got != "share-content" {
		t.Fatalf("second shared download=%q", got)
	}
	publicShareRequest(t, router, http.MethodPost, created.Token,
		strings.NewReader(`{"password":"share-password"}`), http.StatusGone)
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DownloadCount != 2 {
		t.Fatalf("download_count=%d want=2", stored.DownloadCount)
	}

	unlimitedRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var unlimited createdShareDTO
	if err := json.Unmarshal(unlimitedRes.Body.Bytes(), &unlimited); err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", unlimited.ID),
		otherToken, nil, http.StatusNotFound)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", unlimited.ID),
		ownerToken, nil, http.StatusNoContent)
	publicShareRequest(t, router, http.MethodGet, unlimited.Token, nil, http.StatusGone)

	deleteRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var deleteShare createdShareDTO
	if err := json.Unmarshal(deleteRes.Body.Bytes(), &deleteShare); err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		ownerToken, nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})
	publicShareRequest(t, router, http.MethodGet, deleteShare.Token, nil, http.StatusGone)

	var revoked meta.Share
	if err := db.First(&revoked, deleteShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revoked.RevokedAt == nil {
		t.Fatal("soft delete did not revoke file share")
	}

	trashRes := request(t, router, http.MethodGet, "/api/v1/trash", ownerToken, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 || trash[0].ID != file.ID {
		t.Fatalf("unexpected recycle bin after shared file delete: %+v", trash)
	}
	restored := requestNodeWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/trash/%d/restore", file.ID),
		ownerToken, nil, http.StatusOK, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})
	publicShareRequest(t, router, http.MethodGet, deleteShare.Token, nil, http.StatusGone)

	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(fmt.Sprintf(`{"expires_at":%q}`, past)), http.StatusBadRequest)

	permanentRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var permanentShare createdShareDTO
	if err := json.Unmarshal(permanentRes.Body.Bytes(), &permanentShare); err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		ownerToken, nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", restored.Revision)})
	trashRes = request(t, router, http.MethodGet, "/api/v1/trash", ownerToken, nil, http.StatusOK)
	trash = nil
	if err := json.Unmarshal(trashRes.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 || trash[0].ID != file.ID {
		t.Fatalf("unexpected recycle bin before permanent delete: %+v", trash)
	}
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", file.ID),
		ownerToken, nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[0].Revision)})
	if err := db.First(&meta.Share{}, permanentShare.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("permanently deleted file left share metadata: %v", err)
	}
	publicShareRequest(t, router, http.MethodGet, permanentShare.Token, nil, http.StatusNotFound)
	publicShareRequest(t, router, http.MethodGet, "not-a-real-token", nil, http.StatusNotFound)
}

func publicShareRequest(t *testing.T, h http.Handler, method, token string, body io.Reader, status int) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/public/share"
	if method == http.MethodPost {
		path += "/download"
	}
	return requestWithHeaders(t, h, method, path, "", body, status, map[string]string{
		"X-XDrive-Share-Token": token,
	})
}

func TestShareDownloadLimitIsAtomic(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
	); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("share-race-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	ownerToken := createTestUser(t, db, router, "share-race-owner", "owner-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	file := uploadTestFile(t, router, ownerToken, root.ID, "race.txt", "race-content")
	createRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/shares", file.ID),
		ownerToken, strings.NewReader(`{"max_downloads":1}`), http.StatusCreated)
	var created createdShareDTO
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, "/api/v1/public/share/download", strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-XDrive-Share-Token", created.Token)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results <- rec.Code
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	successes, exhausted := 0, 0
	for status := range results {
		switch status {
		case http.StatusOK:
			successes++
		case http.StatusGone:
			exhausted++
		default:
			t.Fatalf("unexpected concurrent download status: %d", status)
		}
	}
	if successes != 1 || exhausted != 1 {
		t.Fatalf("concurrent results success=%d gone=%d want 1/1", successes, exhausted)
	}

	var stored meta.Share
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DownloadCount != 1 {
		t.Fatalf("download_count=%d want=1", stored.DownloadCount)
	}
}
