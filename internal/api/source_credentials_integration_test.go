package api

import (
	"bytes"
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
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceCredentialAPIIsolationEncryptionAndRotation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_credentials_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceCredential{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	keyV1 := strings.Repeat("11", 32)
	keyV2 := strings.Repeat("22", 32)
	ringV1, err := connectorsecret.NewKeyring(1, map[uint32]string{1: keyV1})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:               db,
		Auth:             auth.New("source-credential-test-secret", time.Hour),
		RefreshTTL:       24 * time.Hour,
		AllowedOrigin:    "http://localhost",
		ConnectorSecrets: ringV1,
	}
	router := server.Router()

	tokenA := createTestUser(t, db, router, "credential-alice", "password-a")
	tokenB := createTestUser(t, db, router, "credential-bob", "password-b")

	var userA meta.User
	if err := db.Where("username = ?", "credential-alice").First(&userA).Error; err != nil {
		t.Fatal(err)
	}
	var rootA meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", userA.ID).First(&rootA).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID:      userA.ID,
		Name:         "Yike Photos",
		Kind:         "yike_photos",
		Direction:    meta.SourceDirectionPull,
		SyncMode:     meta.SourceSyncModeBackup,
		RunMode:      meta.SourceRunModeScan,
		Status:       meta.SourceStatusActive,
		Revision:     1,
		TargetNodeID: &rootA.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	statusPath := fmt.Sprintf("/api/v1/sources/%d/credential", source.ID)
	statusRes := request(t, router, http.MethodGet, statusPath, tokenA, nil, http.StatusOK)
	if strings.Contains(statusRes.Body.String(), "cookie") {
		t.Fatalf("credential status leaked plaintext: %s", statusRes.Body.String())
	}

	body := `{"payload":{"cookie":"BDUSS=top-secret-cookie"}}`
	requestWithHeaders(t, router, http.MethodPut, statusPath, tokenB, strings.NewReader(body), http.StatusNotFound,
		map[string]string{"Content-Type": "application/json"})

	putRes := requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(body), http.StatusOK,
		map[string]string{"Content-Type": "application/json"})
	if strings.Contains(putRes.Body.String(), "top-secret-cookie") || strings.Contains(putRes.Body.String(), "BDUSS") {
		t.Fatalf("credential response leaked plaintext: %s", putRes.Body.String())
	}
	var status sourceCredentialStatusDTO
	if err := json.Unmarshal(putRes.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if !status.Configured || status.KeyVersion != 1 || status.UpdatedAt == nil {
		t.Fatalf("unexpected credential status: %+v", status)
	}

	var row meta.SourceCredential
	if err := db.First(&row, "source_id = ?", source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.KeyVersion != 1 {
		t.Fatalf("key_version=%d want=1", row.KeyVersion)
	}
	if bytes.Contains(row.Ciphertext, []byte("top-secret-cookie")) || bytes.Contains(row.Ciphertext, []byte("BDUSS")) {
		t.Fatal("database ciphertext contains credential plaintext")
	}

	rotated, err := connectorsecret.NewKeyring(2, map[uint32]string{1: keyV1, 2: keyV2})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := sourcecredential.Get(context.Background(), db, rotated, source)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != `{"cookie":"BDUSS=top-secret-cookie"}` {
		t.Fatalf("decrypted payload=%q", plain)
	}

	report, err := sourcecredential.RewrapAll(context.Background(), db, rotated, false)
	if err != nil {
		t.Fatal(err)
	}
	if report.ActiveVersion != 2 || report.Scanned != 1 || report.Rewrapped != 1 || report.AlreadyActive != 0 {
		t.Fatalf("unexpected rewrap report: %+v", report)
	}
	if err := db.First(&row, "source_id = ?", source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.KeyVersion != 2 {
		t.Fatalf("rewrapped key_version=%d want=2", row.KeyVersion)
	}
	plain, err = sourcecredential.Get(context.Background(), db, rotated, source)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != `{"cookie":"BDUSS=top-secret-cookie"}` {
		t.Fatalf("rewrapped plaintext=%q", plain)
	}

	server.ConnectorSecrets = rotated
	getRes := request(t, router, http.MethodGet, statusPath, tokenA, nil, http.StatusOK)
	if strings.Contains(getRes.Body.String(), "top-secret-cookie") || strings.Contains(getRes.Body.String(), "BDUSS") {
		t.Fatalf("GET credential status leaked plaintext: %s", getRes.Body.String())
	}
	if err := json.Unmarshal(getRes.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if !status.Configured || status.KeyVersion != 2 {
		t.Fatalf("rotated status=%+v", status)
	}

	server.ConnectorSecrets = nil
	requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(body), http.StatusServiceUnavailable,
		map[string]string{"Content-Type": "application/json"})
	server.ConnectorSecrets = rotated

	request(t, router, http.MethodDelete, statusPath, tokenA, nil, http.StatusNoContent)
	var count int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", source.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("credential rows=%d want=0", count)
	}

	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).
		Where("target_type = ? AND target_id = ? AND action IN ?",
			"source", fmt.Sprintf("%d", source.ID),
			[]string{"source.credential.update", "source.credential.delete"}).
		Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 2 {
		t.Fatalf("credential audit events=%d want=2", auditCount)
	}
}
