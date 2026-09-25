package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	adminpkg "github.com/lazyxu/xdrive/internal/admin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestUserQuotaCountsCurrentTrashAndHistory(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "quota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store,
		Auth:           auth.New("quota-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()

	adminUser, err := adminpkg.Bootstrap(db, "quota-admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	if adminUser.Role != meta.UserRoleAdmin {
		t.Fatalf("admin role=%q", adminUser.Role)
	}
	adminSession := loginTestUser(t, router, "quota-admin", "admin-password", http.StatusOK)

	createdRes := request(t, router, http.MethodPost, "/api/v1/admin/users", adminSession.AccessToken,
		strings.NewReader(`{"username":"quota-user","password":"quota-password","role":"user","must_change_password":false,"quota_bytes":20}`),
		http.StatusCreated)
	var managed userDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &managed); err != nil {
		t.Fatal(err)
	}
	if managed.QuotaBytes != 20 || managed.PhysicalUsedBytes != 0 || managed.OverQuota {
		t.Fatalf("created quota user=%+v", managed)
	}
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"quota_bytes":-1}`), http.StatusBadRequest)

	userSession := loginTestUser(t, router, "quota-user", "quota-password", http.StatusOK)
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", userSession.AccessToken, nil, http.StatusOK)

	first := uploadQuotaTestFile(t, router, userSession.AccessToken, root.ID, "one.txt", "123456", http.StatusCreated)
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 20, PhysicalUsedBytes: 6, LogicalFileBytes: 6,
	})

	first = requestNodeWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", first.ID),
		userSession.AccessToken, strings.NewReader("1234567"), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", first.Revision)})
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 20, PhysicalUsedBytes: 13, LogicalFileBytes: 7, HistoryBytes: 6,
	})

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", first.ID), userSession.AccessToken,
		nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", first.Revision)})
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 20, PhysicalUsedBytes: 13, TrashBytes: 7, HistoryBytes: 6,
	})
	trash := quotaTrash(t, router, userSession.AccessToken)
	first = requestNodeWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/trash/%d/restore", first.ID),
		userSession.AccessToken, nil, http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[first.ID].Revision)})
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 20, PhysicalUsedBytes: 13, LogicalFileBytes: 7, HistoryBytes: 6,
	})

	uploadQuotaTestFile(t, router, userSession.AccessToken, root.ID, "blocked.txt", "12345678", http.StatusInsufficientStorage)
	blockedInit := fmt.Sprintf(`{"parent_id":%d,"name":"blocked.bin","size":8,"chunk_size":%d}`, root.ID, int64(4<<20))
	request(t, router, http.MethodPost, "/api/v1/uploads", userSession.AccessToken, strings.NewReader(blockedInit), http.StatusInsufficientStorage)

	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"quota_bytes":30}`), http.StatusOK)

	pendingData := []byte("abcdefghij")
	pendingHash := quotaSHA256(pendingData)
	pendingInit := fmt.Sprintf(
		`{"parent_id":%d,"name":"pending.bin","size":%d,"chunk_size":%d,"sha256":%q,"resume_key":%q}`,
		root.ID, len(pendingData), int64(4<<20), pendingHash, pendingHash,
	)
	initRes := request(t, router, http.MethodPost, "/api/v1/uploads", userSession.AccessToken, strings.NewReader(pendingInit), http.StatusCreated)
	var pending uploadSessionDTO
	if err := json.Unmarshal(initRes.Body.Bytes(), &pending); err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/uploads/%s/chunks/0", pending.ID),
		userSession.AccessToken, bytes.NewReader(pendingData), http.StatusCreated,
		map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": pendingHash})
	// In-progress chunks are temporary staging data, not retained quota usage.
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 30, PhysicalUsedBytes: 13, LogicalFileBytes: 7, HistoryBytes: 6,
	})

	second := uploadQuotaTestFile(t, router, userSession.AccessToken, root.ID, "two.txt", "12345678", http.StatusCreated)
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 30, PhysicalUsedBytes: 21, LogicalFileBytes: 15, HistoryBytes: 6,
	})

	// The session was admitted when space existed, but finalize is authoritative.
	request(t, router, http.MethodPost, "/api/v1/uploads/"+pending.ID+"/finalize", userSession.AccessToken,
		strings.NewReader(`{}`), http.StatusInsufficientStorage)

	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", second.ID), userSession.AccessToken,
		nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", second.Revision)})
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 30, PhysicalUsedBytes: 21, LogicalFileBytes: 7, TrashBytes: 8, HistoryBytes: 6,
	})
	// Recycle-bin moves do not free quota.
	request(t, router, http.MethodPost, "/api/v1/uploads/"+pending.ID+"/finalize", userSession.AccessToken,
		strings.NewReader(`{}`), http.StatusInsufficientStorage)

	trash = quotaTrash(t, router, userSession.AccessToken)
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", second.ID), userSession.AccessToken,
		nil, http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", trash[second.ID].Revision)})
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 30, PhysicalUsedBytes: 13, LogicalFileBytes: 7, HistoryBytes: 6,
	})

	// Permanent deletion freed the eight retained bytes, so the existing session can finalize.
	finalRes := request(t, router, http.MethodPost, "/api/v1/uploads/"+pending.ID+"/finalize", userSession.AccessToken,
		strings.NewReader(`{}`), http.StatusOK)
	var finalized uploadSessionDTO
	if err := json.Unmarshal(finalRes.Body.Bytes(), &finalized); err != nil {
		t.Fatal(err)
	}
	if finalized.Result == nil || finalized.Result.Size != int64(len(pendingData)) {
		t.Fatalf("unexpected finalized upload: %+v", finalized)
	}
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 30, PhysicalUsedBytes: 23, LogicalFileBytes: 17, HistoryBytes: 6,
	})

	// Overwrite growth is the full new blob size because the old current blob
	// remains retained as history after a successful overwrite.
	requestWithHeaders(t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", first.ID),
		userSession.AccessToken, strings.NewReader("12345678"), http.StatusInsufficientStorage,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", first.Revision)})
	current := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", first.ID),
		userSession.AccessToken, nil, http.StatusOK)
	if current.Body.String() != "1234567" {
		t.Fatalf("quota-rejected overwrite changed content: %q", current.Body.String())
	}

	usersRes := request(t, router, http.MethodGet, "/api/v1/admin/users", adminSession.AccessToken, nil, http.StatusOK)
	var users []userDTO
	if err := json.Unmarshal(usersRes.Body.Bytes(), &users); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, user := range users {
		if user.ID == managed.ID {
			found = true
			if user.PhysicalUsedBytes != 23 || user.LogicalFileBytes != 17 || user.HistoryBytes != 6 {
				t.Fatalf("admin quota view=%+v", user)
			}
		}
	}
	if !found {
		t.Fatal("quota user missing from admin list")
	}

	// Lowering below current usage is allowed and does not delete existing data.
	updatedRes := request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"quota_bytes":20}`), http.StatusOK)
	var updated userDTO
	if err := json.Unmarshal(updatedRes.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.PhysicalUsedBytes != 23 || !updated.OverQuota {
		t.Fatalf("quota update response missing live usage: %+v", updated)
	}
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 20, PhysicalUsedBytes: 23, LogicalFileBytes: 17, HistoryBytes: 6, OverQuota: true,
	})
	uploadQuotaTestFile(t, router, userSession.AccessToken, root.ID, "still-blocked.txt", "x", http.StatusInsufficientStorage)

	// quota_bytes=0 means unlimited.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", managed.ID), adminSession.AccessToken,
		strings.NewReader(`{"quota_bytes":0}`), http.StatusOK)
	assertQuotaUsage(t, router, userSession.AccessToken, quotaUsageDTO{
		QuotaBytes: 0, PhysicalUsedBytes: 23, LogicalFileBytes: 17, HistoryBytes: 6,
	})
}

func uploadQuotaTestFile(t *testing.T, h http.Handler, token string, parentID uint64, name, content string, status int) nodeDTO {
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
	if res.Code != status {
		t.Fatalf("upload code=%d want=%d body=%s", res.Code, status, res.Body.String())
	}
	if status/100 != 2 {
		return nodeDTO{}
	}
	var out nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func quotaUsageForTest(t *testing.T, h http.Handler, token string) quotaUsageDTO {
	t.Helper()
	res := request(t, h, http.MethodGet, "/api/v1/me/quota", token, nil, http.StatusOK)
	var out quotaUsageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func assertQuotaUsage(t *testing.T, h http.Handler, token string, want quotaUsageDTO) {
	t.Helper()
	got := quotaUsageForTest(t, h, token)
	if got != want {
		t.Fatalf("quota usage=%+v want=%+v", got, want)
	}
}

func quotaTrash(t *testing.T, h http.Handler, token string) map[uint64]nodeDTO {
	t.Helper()
	res := request(t, h, http.MethodGet, "/api/v1/trash", token, nil, http.StatusOK)
	var nodes []nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &nodes); err != nil {
		t.Fatal(err)
	}
	out := make(map[uint64]nodeDTO, len(nodes))
	for _, node := range nodes {
		out[node.ID] = node
	}
	return out
}

func quotaSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
