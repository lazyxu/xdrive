package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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

type failingReadyStore struct {
	storage.Store
}

func (f failingReadyStore) Ready(context.Context) error {
	return errors.New("storage unavailable")
}

func TestServerObservability(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "observability_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	var accessLog bytes.Buffer
	server := &Server{
		DB: db, Store: store, Auth: auth.New("observability-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
		obs: newServerObservability(slog.New(slog.NewJSONHandler(&accessLog, nil))),
	}
	router := server.Router()
	router.GET("/panic-test", func(c *gin.Context) {
		panic("panic-test")
	})

	health := request(t, router, http.MethodGet, "/api/v1/healthz", "", nil, http.StatusOK)
	if strings.Contains(health.Body.String(), "database") || strings.Contains(health.Body.String(), "storage") {
		t.Fatalf("liveness endpoint unexpectedly checks dependencies: %s", health.Body.String())
	}
	if health.Header().Get("X-Request-ID") == "" {
		t.Fatal("health response missing X-Request-ID")
	}

	ready := request(t, router, http.MethodGet, "/api/v1/readyz", "", nil, http.StatusOK)
	var readyBody map[string]any
	if err := json.Unmarshal(ready.Body.Bytes(), &readyBody); err != nil {
		t.Fatal(err)
	}
	if readyBody["database"] != "ok" || readyBody["storage"] != "ok" {
		t.Fatalf("unexpected readiness response: %s", ready.Body.String())
	}

	token := createTestUser(t, db, router, "metrics-user", "metrics-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	traceID := "trace-test-123"
	traced := requestWithHeaders(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK,
		map[string]string{"X-Request-ID": traceID})
	if traced.Header().Get("X-Request-ID") != traceID {
		t.Fatalf("request id=%q want=%q", traced.Header().Get("X-Request-ID"), traceID)
	}
	if !strings.Contains(accessLog.String(), `"msg":"http_access"`) ||
		!strings.Contains(accessLog.String(), `"request_id":"trace-test-123"`) ||
		!strings.Contains(accessLog.String(), `"route":"/api/v1/nodes/root"`) {
		t.Fatalf("structured access log missing trace fields: %s", accessLog.String())
	}

	loginTestUser(t, router, "metrics-user", "wrong-password", http.StatusUnauthorized)

	panicRes := requestWithHeaders(t, router, http.MethodGet, "/panic-test", "panic-access-token", nil, http.StatusInternalServerError,
		map[string]string{"X-XDrive-Share-Token": "panic-share-token"})
	if !strings.Contains(panicRes.Body.String(), "internal server error") {
		t.Fatalf("panic response=%s", panicRes.Body.String())
	}
	if strings.Contains(accessLog.String(), "panic-access-token") || strings.Contains(accessLog.String(), "panic-share-token") {
		t.Fatalf("panic logging leaked credential headers: %s", accessLog.String())
	}

	uploadQuotaTestFile(t, router, token, root.ID, "ok.txt", "ok", http.StatusCreated)
	sessionBody := fmt.Sprintf(`{"parent_id":%d,"name":"pending.bin","size":1,"chunk_size":%d}`, root.ID, int64(4<<20))
	request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(sessionBody), http.StatusCreated)

	if err := db.Model(&meta.User{}).Where("username = ?", "metrics-user").Update("quota_bytes", 2).Error; err != nil {
		t.Fatal(err)
	}
	uploadQuotaTestFile(t, router, token, root.ID, "blocked.txt", "x", http.StatusInsufficientStorage)

	metrics := request(t, router, http.MethodGet, "/metrics", "", nil, http.StatusOK)
	if got := metrics.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("metrics cache-control=%q", got)
	}
	body := metrics.Body.String()
	for _, want := range []string{
		"xdrive_metrics_collection_success 1",
		"xdrive_login_failures_total 1",
		"xdrive_quota_rejections_total 1",
		`xdrive_upload_operations_total{operation="multipart",result="success"} 1`,
		`xdrive_upload_operations_total{operation="multipart",result="failure"} 1`,
		"xdrive_upload_sessions_active 1",
		"xdrive_managed_blob_bytes 2",
		"xdrive_retained_blob_bytes 2",
		"xdrive_database_size_bytes ",
		"xdrive_api_5xx_total 2",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q:\n%s", want, body)
		}
	}

	unreadyServer := &Server{
		DB: db, Store: failingReadyStore{Store: store}, Auth: auth.New("observability-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}
	unready := request(t, unreadyServer.Router(), http.MethodGet, "/api/v1/readyz", "", nil, http.StatusServiceUnavailable)
	if !strings.Contains(unready.Body.String(), `"storage":"unavailable"`) {
		t.Fatalf("unready storage response=%s", unready.Body.String())
	}
}
