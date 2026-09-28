package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
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

func TestUploadQuotaReservationSerializesConcurrentSessions(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "quota_reservation_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth:       auth.New("quota-reservation-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 32 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "quota-reserve-user", "password-a")
	var user meta.User
	if err := db.Where("username = ?", "quota-reserve-user").First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&user).Update("quota_bytes", 10).Error; err != nil {
		t.Fatal(err)
	}
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	type result struct {
		code int
		body string
	}
	results := make(chan result, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := fmt.Sprintf(`{"parent_id":%d,"name":"file-%d.bin","size":8,"chunk_size":%d}`, root.ID, i, int64(4<<20))
			req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			results <- result{code: res.Code, body: res.Body.String()}
		}()
	}
	wg.Wait()
	close(results)

	created := 0
	rejected := 0
	createdSessionID := ""
	for got := range results {
		switch got.code {
		case http.StatusCreated:
			created++
			var session uploadSessionDTO
			if err := json.Unmarshal([]byte(got.body), &session); err != nil {
				t.Fatal(err)
			}
			createdSessionID = session.ID
			if session.QuotaReservedBytes != 8 {
				t.Fatalf("session quota reservation=%d want=8", session.QuotaReservedBytes)
			}
		case http.StatusInsufficientStorage:
			rejected++
			if !strings.Contains(got.body, "quota_exceeded") {
				t.Fatalf("unexpected rejection body=%s", got.body)
			}
		default:
			t.Fatalf("unexpected concurrent create status=%d body=%s", got.code, got.body)
		}
	}
	if created != 1 || rejected != 1 {
		t.Fatalf("concurrent quota reservations created=%d rejected=%d", created, rejected)
	}
	usage := quotaUsageForTest(t, router, token)
	if usage.PhysicalUsedBytes != 0 || usage.ReservedBytes != 8 || usage.AvailableBytes != 2 {
		t.Fatalf("quota after reservation=%+v", usage)
	}
	request(t, router, http.MethodDelete, "/api/v1/uploads/"+createdSessionID, token, nil, http.StatusNoContent)
	usage = quotaUsageForTest(t, router, token)
	if usage.ReservedBytes != 0 || usage.AvailableBytes != 10 {
		t.Fatalf("quota after abort=%+v", usage)
	}
}
