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
	"github.com/lazyxu/xdrive/internal/yike"
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
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCredential{},
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
	var credentialTestErr error
	var testedKind string
	var testedPayload json.RawMessage
	accountExternalID := "12345"
	accountName := "张三"
	server := &Server{
		DB:               db,
		Auth:             auth.New("source-credential-test-secret", time.Hour),
		RefreshTTL:       24 * time.Hour,
		AllowedOrigin:    "http://localhost",
		ConnectorSecrets: ringV1,
		credentialTest: func(_ context.Context, kind string, payload json.RawMessage) (sourceCredentialTestDTO, error) {
			testedKind = kind
			testedPayload = append(testedPayload[:0], payload...)
			if credentialTestErr != nil {
				return sourceCredentialTestDTO{}, credentialTestErr
			}
			return sourceCredentialTestDTO{
				Valid: true, Kind: kind, AccountExternalID: accountExternalID, AccountName: accountName,
			}, nil
		},
	}
	router := server.Router()

	tokenA := createTestUser(t, db, router, "credential-alice", "password-a")
	tokenB := createTestUser(t, db, router, "credential-bob", "password-b")

	testBody := `{"kind":"yike_photos","payload":{"cookie":"BDUSS=ephemeral-cookie"}}`
	testRes := requestWithHeaders(t, router, http.MethodPost, "/api/v1/source-credentials/test", tokenA,
		strings.NewReader(testBody), http.StatusOK, map[string]string{"Content-Type": "application/json"})
	if strings.Contains(testRes.Body.String(), "ephemeral-cookie") || strings.Contains(testRes.Body.String(), "BDUSS") {
		t.Fatalf("credential test response leaked plaintext: %s", testRes.Body.String())
	}
	var tested sourceCredentialTestDTO
	if err := json.Unmarshal(testRes.Body.Bytes(), &tested); err != nil {
		t.Fatal(err)
	}
	if !tested.Valid || tested.Kind != "yike_photos" || tested.AccountExternalID != "12345" || tested.AccountName != "张三" {
		t.Fatalf("unexpected credential test result: %+v", tested)
	}
	if testedKind != "yike_photos" || string(testedPayload) != `{"cookie":"BDUSS=ephemeral-cookie"}` {
		t.Fatalf("credential test input kind=%q payload=%s", testedKind, testedPayload)
	}
	var preStoreCount int64
	if err := db.Model(&meta.SourceCredential{}).Count(&preStoreCount).Error; err != nil {
		t.Fatal(err)
	}
	if preStoreCount != 0 {
		t.Fatalf("ephemeral credential test persisted %d credential rows", preStoreCount)
	}

	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{yike.ErrAuthentication, http.StatusUnprocessableEntity, "yike_auth_failed"},
		{yike.ErrRateLimited, http.StatusTooManyRequests, "yike_rate_limited"},
		{yike.ErrUnavailable, http.StatusBadGateway, "yike_unavailable"},
		{context.DeadlineExceeded, http.StatusGatewayTimeout, "yike_timeout"},
	} {
		credentialTestErr = tc.err
		res := requestWithHeaders(t, router, http.MethodPost, "/api/v1/source-credentials/test", tokenA,
			strings.NewReader(testBody), tc.status, map[string]string{"Content-Type": "application/json"})
		if !strings.Contains(res.Body.String(), tc.code) {
			t.Fatalf("credential test error=%v response=%s", tc.err, res.Body.String())
		}
	}
	credentialTestErr = nil

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
	storedTestPath := fmt.Sprintf("/api/v1/sources/%d/credential/test", source.ID)
	missingStored := request(t, router, http.MethodPost, storedTestPath, tokenA, nil, http.StatusConflict)
	if !strings.Contains(missingStored.Body.String(), "source_credential_not_configured") {
		t.Fatalf("missing stored credential response=%s", missingStored.Body.String())
	}

	body := `{"payload":{"cookie":"BDUSS=top-secret-cookie"}}`
	requestWithHeaders(t, router, http.MethodPut, statusPath, tokenB, strings.NewReader(body), http.StatusNotFound,
		map[string]string{"Content-Type": "application/json"})

	credentialTestErr = yike.ErrAuthentication
	rejectedBody := `{"payload":{"cookie":"BDUSS=rejected-cookie"}}`
	rejectedPut := requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(rejectedBody), http.StatusUnprocessableEntity,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(rejectedPut.Body.String(), "yike_auth_failed") {
		t.Fatalf("rejected credential response=%s", rejectedPut.Body.String())
	}
	var rejectedCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", source.ID).Count(&rejectedCount).Error; err != nil {
		t.Fatal(err)
	}
	if rejectedCount != 0 {
		t.Fatalf("invalid credential persisted %d rows", rejectedCount)
	}
	credentialTestErr = nil

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
	var boundSource meta.Source
	if err := db.First(&boundSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if boundSource.TargetNodeID == nil || *boundSource.TargetNodeID == rootA.ID || boundSource.Revision != 2 {
		t.Fatalf("Yike managed target was not bound: %+v", boundSource)
	}
	var target meta.Node
	if err := db.First(&target, *boundSource.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	logicalTarget, err := server.logicalPath(target)
	if err != nil {
		t.Fatal(err)
	}
	if logicalTarget != "来源/一刻相册/uid_12345_张三" {
		t.Fatalf("managed Yike target=%q", logicalTarget)
	}

	duplicateSource := meta.Source{
		OwnerID: userA.ID, Name: "Yike Duplicate", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&duplicateSource).Error; err != nil {
		t.Fatal(err)
	}
	duplicatePath := fmt.Sprintf("/api/v1/sources/%d/credential", duplicateSource.ID)
	duplicatePut := requestWithHeaders(t, router, http.MethodPut, duplicatePath, tokenA, strings.NewReader(body), http.StatusConflict,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(duplicatePut.Body.String(), "yike_account_already_configured") {
		t.Fatalf("duplicate Yike account response=%s", duplicatePut.Body.String())
	}
	var duplicateCredentialCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", duplicateSource.ID).Count(&duplicateCredentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if duplicateCredentialCount != 0 {
		t.Fatalf("duplicate Yike credential rows=%d want=0", duplicateCredentialCount)
	}

	if err := db.Create(&meta.SourceItem{
		SourceID: source.ID, ExternalID: "yike:12345:999", Kind: meta.SourceItemKindFile,
		Path: "Library/test.jpg", State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	accountExternalID = "67890"
	accountName = "李四"
	mismatchPut := requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(body), http.StatusConflict,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(mismatchPut.Body.String(), "yike_account_mismatch") {
		t.Fatalf("mismatched Yike account response=%s", mismatchPut.Body.String())
	}
	accountExternalID = "12345"
	accountName = "张三"
	preservedAfterMismatch, err := sourcecredential.Get(context.Background(), db, ringV1, source)
	if err != nil {
		t.Fatal(err)
	}
	if string(preservedAfterMismatch) != `{"cookie":"BDUSS=top-secret-cookie"}` {
		t.Fatalf("mismatched account changed stored credential: %q", preservedAfterMismatch)
	}
	clear(preservedAfterMismatch)

	testedPayload = nil
	storedTestRes := request(t, router, http.MethodPost, storedTestPath, tokenA, nil, http.StatusOK)
	if strings.Contains(storedTestRes.Body.String(), "top-secret-cookie") || strings.Contains(storedTestRes.Body.String(), "BDUSS") {
		t.Fatalf("stored credential test response leaked plaintext: %s", storedTestRes.Body.String())
	}
	if string(testedPayload) != `{"cookie":"BDUSS=top-secret-cookie"}` {
		t.Fatalf("stored credential test payload=%s", testedPayload)
	}
	request(t, router, http.MethodPost, storedTestPath, tokenB, nil, http.StatusNotFound)

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

	credentialTestErr = yike.ErrAuthentication
	rejectedReplace := requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(rejectedBody), http.StatusUnprocessableEntity,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(rejectedReplace.Body.String(), "yike_auth_failed") {
		t.Fatalf("rejected replacement response=%s", rejectedReplace.Body.String())
	}
	credentialTestErr = nil
	preserved, err := sourcecredential.Get(context.Background(), db, ringV1, source)
	if err != nil {
		t.Fatal(err)
	}
	if string(preserved) != `{"cookie":"BDUSS=top-secret-cookie"}` {
		t.Fatalf("rejected replacement changed stored credential: %q", preserved)
	}
	clear(preserved)

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

	verifyReport, err := sourcecredential.VerifyAll(context.Background(), db, rotated)
	if err != nil {
		t.Fatal(err)
	}
	if verifyReport.Scanned != 1 || verifyReport.Verified != 1 {
		t.Fatalf("unexpected verify report: %+v", verifyReport)
	}
	wrongRing, err := connectorsecret.NewKeyring(2, map[uint32]string{
		1: keyV1,
		2: strings.Repeat("33", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sourcecredential.VerifyAll(context.Background(), db, wrongRing); err == nil ||
		!strings.Contains(err.Error(), "decrypt connector credential") {
		t.Fatalf("wrong connector key unexpectedly verified: %v", err)
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
	var pausedSource meta.Source
	if err := db.First(&pausedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if pausedSource.Status != meta.SourceStatusPaused || pausedSource.Revision != 3 || pausedSource.TargetNodeID == nil ||
		*pausedSource.TargetNodeID != target.ID {
		t.Fatalf("cleared Yike credential did not pause source: %+v", pausedSource)
	}
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", source.ID), tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{"If-Match": `"3"`})

	// Reconfiguring the same account reuses the managed target and reactivates
	// the Source without moving already imported items.
	requestWithHeaders(t, router, http.MethodPut, statusPath, tokenA, strings.NewReader(body), http.StatusOK,
		map[string]string{"Content-Type": "application/json"})
	var reactivated meta.Source
	if err := db.First(&reactivated, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reactivated.Status != meta.SourceStatusActive || reactivated.Revision != 4 || reactivated.TargetNodeID == nil ||
		*reactivated.TargetNodeID != target.ID {
		t.Fatalf("reconfigured Yike source was not reactivated: %+v", reactivated)
	}
	request(t, router, http.MethodDelete, statusPath, tokenA, nil, http.StatusNoContent)
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", source.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("credential rows after second clear=%d want=0", count)
	}
	if err := db.First(&pausedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if pausedSource.Status != meta.SourceStatusPaused || pausedSource.Revision != 5 {
		t.Fatalf("second clear did not pause Yike source: %+v", pausedSource)
	}

	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).
		Where("target_type = ? AND target_id = ? AND action IN ?",
			"source", fmt.Sprintf("%d", source.ID),
			[]string{"source.credential.update", "source.credential.delete"}).
		Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 4 {
		t.Fatalf("credential audit events=%d want=4", auditCount)
	}
}
