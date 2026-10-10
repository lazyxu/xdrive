package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPostgresPoolBoundsAndUnmanagedDefaults(t *testing.T) {
	good := []postgresPoolValues{
		{MaxOpenConnections: 0, MaxIdleConnections: 2},
		{MaxOpenConnections: 8, MaxIdleConnections: 0},
		{MaxOpenConnections: 16, MaxIdleConnections: 8},
		{MaxOpenConnections: 256, MaxIdleConnections: 32},
	}
	for _, values := range good {
		if !validPostgresPoolValues(values) {
			t.Fatalf("valid pool bounds rejected: %+v", values)
		}
	}
	bad := []postgresPoolValues{
		{MaxOpenConnections: -1, MaxIdleConnections: 2},
		{MaxOpenConnections: 1, MaxIdleConnections: 1},
		{MaxOpenConnections: 7, MaxIdleConnections: 2},
		{MaxOpenConnections: 257, MaxIdleConnections: 2},
		{MaxOpenConnections: 16, MaxIdleConnections: -1},
		{MaxOpenConnections: 16, MaxIdleConnections: 17},
		{MaxOpenConnections: 64, MaxIdleConnections: 33},
	}
	for _, values := range bad {
		if validPostgresPoolValues(values) {
			t.Fatalf("unsafe PostgreSQL pool accepted: %+v", values)
		}
	}
	if desired, err := readPostgresPoolDesired(context.Background(), nil); err != nil ||
		desired.Revision != 0 || desired.Values != defaultPostgresPoolValues() {
		t.Fatalf("unmanaged Go default was altered: %+v %v", desired, err)
	}
}

func TestPostgresPoolAdminSaveReconcileRollbackAudit(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "postgres_pool_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminPostgresPoolSetting{}, &meta.AdminPostgresPoolRevision{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("test-postgres-pool-config-secret", time.Hour)}
	admin := meta.User{Username: "pool-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "pool-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	const endpoint = "/api/v1/admin/services/postgresql/pool"
	initial := request(http.MethodGet, endpoint, adminToken, "")
	var first adminPostgresPoolConfigDTO
	if initial.Code != http.StatusOK || json.Unmarshal(initial.Body.Bytes(), &first) != nil ||
		first.ApplyState != "unmanaged" || first.Effective != nil || first.Revision != 0 ||
		first.Desired != defaultPostgresPoolValues() {
		t.Fatalf("unmanaged pool incorrectly advertised as applied: HTTP %d %+v", initial.Code, first)
	}
	if rec := request(http.MethodGet, endpoint, "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous read accepted: %d", rec.Code)
	}
	if rec := request(http.MethodGet, endpoint, memberToken, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin read accepted: %d", rec.Code)
	}
	body := `{"revision":0,"desired":{"max_open_connections":16,"max_idle_connections":4}}`
	if rec := request(http.MethodPut, endpoint, "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous write accepted: %d", rec.Code)
	}
	if rec := request(http.MethodPut, endpoint, memberToken, body); rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin write accepted: %d", rec.Code)
	}
	for _, invalid := range []string{
		`{"revision":0,"desired":{"max_open_connections":1,"max_idle_connections":1}}`,
		`{"revision":0,"desired":{"max_open_connections":16,"max_idle_connections":17}}`,
		`{"revision":0,"desired":{"max_open_connections":257,"max_idle_connections":2}}`,
		`{"revision":0,"desired":{"max_open_connections":16}}`,
		`{"desired":{"max_open_connections":16,"max_idle_connections":4}}`,
	} {
		if rec := request(http.MethodPut, endpoint, adminToken, invalid); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid pool input accepted: HTTP %d %s", rec.Code, invalid)
		}
	}
	// Startup on an unmanaged Server must preserve the driver defaults.
	if err := s.reconcilePostgresPool(context.Background()); err != nil || s.postgresPoolApplied.Load() != nil {
		t.Fatalf("unmanaged reconciliation changed defaults: %v", err)
	}
	applied := request(http.MethodPut, endpoint, adminToken, body)
	var cfg adminPostgresPoolConfigDTO
	if applied.Code != http.StatusOK || json.Unmarshal(applied.Body.Bytes(), &cfg) != nil ||
		cfg.Revision != 1 || cfg.EffectiveRevision != 1 || cfg.ApplyState != "applied" ||
		cfg.CurrentMaxOpen != 16 || cfg.Effective == nil || cfg.Effective.MaxIdleConnections != 4 ||
		sqlDB.Stats().MaxOpenConnections != 16 {
		t.Fatalf("saved config was not truly applied to database/sql: HTTP %d %+v", applied.Code, cfg)
	}
	if rec := request(http.MethodPut, endpoint, adminToken, body); rec.Code != http.StatusConflict {
		t.Fatalf("stale settings accepted: HTTP %d", rec.Code)
	}
	// Another process with a different *sql.DB pool observes the desired
	// revision but does not acknowledge it until its own reconciliation.
	replicaDB, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	replicaSQL, err := replicaDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer replicaSQL.Close()
	replica := &Server{DB: replicaDB}
	if replica.postgresPoolApplied.Load() != nil {
		t.Fatal("replica pretended another process's runtime applied")
	}
	if err := replica.reconcilePostgresPool(context.Background()); err != nil ||
		replicaSQL.Stats().MaxOpenConnections != 16 ||
		replica.postgresPoolApplied.Load() == nil || replica.postgresPoolApplied.Load().Revision != 1 {
		t.Fatalf("replica did not independently hot-apply desired state: %v", err)
	}
	changed := request(http.MethodPut, endpoint, adminToken,
		`{"revision":1,"desired":{"max_open_connections":32,"max_idle_connections":8}}`)
	if changed.Code != http.StatusOK || sqlDB.Stats().MaxOpenConnections != 32 {
		t.Fatalf("second version failed hot apply: %d", changed.Code)
	}
	if err := replica.reconcilePostgresPool(context.Background()); err != nil ||
		replicaSQL.Stats().MaxOpenConnections != 32 || replica.postgresPoolApplied.Load().Revision != 2 {
		t.Fatalf("replica ignored newer desired revision: %v", err)
	}
	history := request(http.MethodGet, endpoint+"/revisions", adminToken, "")
	var items struct {
		Items []postgresPoolRevisionDTO `json:"items"`
	}
	if history.Code != http.StatusOK || json.Unmarshal(history.Body.Bytes(), &items) != nil ||
		len(items.Items) != 3 || items.Items[2].Revision != 0 ||
		items.Items[2].Desired != defaultPostgresPoolValues() {
		t.Fatalf("immutable pool history incomplete: %d %+v", history.Code, items)
	}
	if rec := request(http.MethodPost, endpoint+"/rollback", adminToken,
		`{"revision":1,"target_revision":0}`); rec.Code != http.StatusConflict {
		t.Fatalf("stale rollback accepted: %d", rec.Code)
	}
	pinnedPool := s.postgresPoolApplied.Load()
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, endpoint+"/rollback", adminToken,
		`{"revision":2,"target_revision":0}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable audit accepted rollback: %d", rec.Code)
	}
	var unchanged meta.AdminPostgresPoolSetting
	if err := db.Where("name = ?", postgresPoolSettingName).Take(&unchanged).Error; err != nil ||
		unchanged.Revision != 2 || unchanged.MaxOpenConnections != 32 ||
		s.postgresPoolApplied.Load() != pinnedPool || sqlDB.Stats().MaxOpenConnections != 32 {
		t.Fatalf("failed audit changed desired or effective pool: %+v %v", unchanged, err)
	}
	if err := db.Migrator().CreateTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	rollback := request(http.MethodPost, endpoint+"/rollback", adminToken,
		`{"revision":2,"target_revision":0}`)
	if rollback.Code != http.StatusOK || json.Unmarshal(rollback.Body.Bytes(), &cfg) != nil ||
		cfg.Revision != 3 || cfg.EffectiveRevision != 3 || cfg.ApplyState != "applied" ||
		cfg.Desired != defaultPostgresPoolValues() || sqlDB.Stats().MaxOpenConnections != 0 {
		t.Fatalf("rollback did not restore Go default as an audited revision: %d %+v", rollback.Code, cfg)
	}
	if err := replica.reconcilePostgresPool(context.Background()); err != nil ||
		replicaSQL.Stats().MaxOpenConnections != 0 || replica.postgresPoolApplied.Load().Revision != 3 {
		t.Fatalf("replica failed to follow committed rollback: %v", err)
	}
	var stored meta.AdminPostgresPoolSetting
	if err := db.Where("name = ?", postgresPoolSettingName).Take(&stored).Error; err != nil ||
		stored.Revision != 3 || stored.MaxOpenConnections != 0 || stored.MaxIdleConnections != 2 {
		t.Fatalf("rollback settings did not persist: %+v %v", stored, err)
	}
}
