package api

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/synology"
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
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}, &meta.SourceCredential{},
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

	// Synology credential diagnostics are dormant at the public API, including
	// both legacy connector kinds. The mock must never see these requests.
	for _, kind := range []string{synologySourceKind, synologyFilesSourceKind} {
		beforeKind, beforePayload := testedKind, string(testedPayload)
		body := fmt.Sprintf(`{"kind":%q,"payload":{"base_url":"https://nas.example:5001","username":"alice","password":"secret"}}`, kind)
		response := requestWithHeaders(t, router, http.MethodPost, "/api/v1/source-credentials/test", tokenA,
			strings.NewReader(body), http.StatusGone, map[string]string{"Content-Type": "application/json"})
		if testedKind != beforeKind || string(testedPayload) != beforePayload || strings.Contains(response.Body.String(), "secret") {
			t.Fatalf("dormant Synology credential probe invoked remote tester or leaked secret: %s", response.Body.String())
		}
	}

	// Keep Synology-specific TLS, refused-connection and timeout error mapping
	// covered directly, so enabling the adapter later does not lose diagnostics.
	for _, tc := range []struct {
		err    error
		status int
		code   string
		detail string
	}{
		{context.DeadlineExceeded, http.StatusGatewayTimeout, "synology_timeout", ""},
		{fmt.Errorf("%w: %w", synology.ErrUnavailable, syscall.ECONNREFUSED),
			http.StatusBadGateway, "synology_connection_refused", "端口拒绝连接"},
		{fmt.Errorf("%w: %w", synology.ErrUnavailable, x509.UnknownAuthorityError{Cert: &x509.Certificate{}}),
			http.StatusBadGateway, "synology_tls_unknown_authority", "证书"},
	} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		writeSourceCredentialTestError(c, synologySourceKind, tc.err)
		if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.code) ||
			(tc.detail != "" && !strings.Contains(response.Body.String(), tc.detail)) {
			t.Fatalf("Synology diagnostic error %v: HTTP %d %s", tc.err, response.Code, response.Body.String())
		}
	}

	var userA meta.User
	if err := db.Where("username = ?", "credential-alice").First(&userA).Error; err != nil {
		t.Fatal(err)
	}
	var rootA meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", userA.ID).First(&rootA).Error; err != nil {
		t.Fatal(err)
	}
	// Historical unbound Yike Source: credential verification must provision a
	// dedicated uid_* managed target. The Owner root is ordinary data and must
	// never be adopted or used as a Source target.
	source := meta.Source{
		OwnerID:      userA.ID,
		Name:         "Yike Photos",
		Kind:         "yike_photos",
		Direction:    meta.SourceDirectionPull,
		SyncMode:     meta.SourceSyncModeBackup,
		RunMode:      meta.SourceRunModeSync,
		Status:       meta.SourceStatusActive,
		Revision:     1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	// Keep independent credential fixtures outside the Yike target ancestry.
	// Binding other Sources to the Owner root is not a valid migration
	// fixture: it would authorize a Source to own every directory below it.
	pushTarget := meta.Node{OwnerID: userA.ID, ParentID: &rootA.ID,
		Name: "synology-push-credential-fixture", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&pushTarget).Error; err != nil {
		t.Fatal(err)
	}
	pullTarget := meta.Node{OwnerID: userA.ID, ParentID: &rootA.ID,
		Name: "synology-pull-credential-fixture", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&pullTarget).Error; err != nil {
		t.Fatal(err)
	}

	// Synology Push credentials live on the NAS source-agent. The server must
	// reject credential persistence/read endpoints for Push sources so DSM
	// passwords cannot be accidentally stored against the wrong execution model.
	synologyPush := meta.Source{
		OwnerID: userA.ID, Name: "Synology Push Credential Guard", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &pushTarget.ID,
	}
	if err := db.Create(&synologyPush).Error; err != nil {
		t.Fatal(err)
	}
	pushCredentialPath := fmt.Sprintf("/api/v1/sources/%d/credential", synologyPush.ID)
	pushStoredTestPath := fmt.Sprintf("/api/v1/sources/%d/credential/test", synologyPush.ID)
	pushRevealPath := fmt.Sprintf("/api/v1/sources/%d/credential/reveal", synologyPush.ID)
	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, pushCredentialPath, ""},
		{http.MethodPost, pushStoredTestPath, ""},
		{http.MethodPost, pushRevealPath, ""},
		{http.MethodPut, pushCredentialPath, `{"payload":{"base_url":"https://nas.example","username":"alice","password":"secret"}}`},
		{http.MethodDelete, pushCredentialPath, ""},
	} {
		res := requestWithHeaders(t, router, tc.method, tc.path, tokenA, strings.NewReader(tc.body), http.StatusBadRequest,
			map[string]string{"Content-Type": "application/json"})
		if !strings.Contains(res.Body.String(), "unsupported_source_credential_kind") {
			t.Fatalf("Synology Push credential endpoint %s %s response=%s", tc.method, tc.path, res.Body.String())
		}
	}
	var pushCredentialCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", synologyPush.ID).Count(&pushCredentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if pushCredentialCount != 0 {
		t.Fatalf("Synology Push persisted server credentials=%d", pushCredentialCount)
	}

	// Previously configured remote Synology Pull credentials stay encrypted
	// and Owner-readable, but cannot be rotated, activated or removed while
	// the connector is disabled for the DSM folder-Push MVP.
	synologyPull := meta.Source{
		OwnerID: userA.ID, Name: "Synology Pull Credential", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &pullTarget.ID,
	}
	if err := db.Create(&synologyPull).Error; err != nil {
		t.Fatal(err)
	}
	legacyCiphertext := []byte("opaque-historical-ciphertext")
	if err := db.Create(&meta.SourceCredential{
		SourceID: synologyPull.ID, Ciphertext: legacyCiphertext, KeyVersion: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	synologyPullCredentialPath := fmt.Sprintf("/api/v1/sources/%d/credential", synologyPull.ID)
	request(t, router, http.MethodPost, synologyPullCredentialPath+"/test", tokenA, nil, http.StatusGone)
	synologyStatus := request(t, router, http.MethodGet, synologyPullCredentialPath, tokenA, nil, http.StatusOK)
	if !strings.Contains(synologyStatus.Body.String(), `"configured":true`) ||
		strings.Contains(synologyStatus.Body.String(), "opaque-historical") {
		t.Fatalf("historical Synology credential status leaked or disappeared: %s", synologyStatus.Body.String())
	}
	synologyCredentialBody := `{"payload":{"base_url":"https://nas.example:5001","username":"alice","password":"secret"}}`
	requestWithHeaders(t, router, http.MethodPut, synologyPullCredentialPath, tokenA,
		strings.NewReader(synologyCredentialBody), http.StatusGone,
		map[string]string{"Content-Type": "application/json"})
	request(t, router, http.MethodGet, synologyPullCredentialPath, tokenB, nil, http.StatusNotFound)
	var encrypted meta.SourceCredential
	if err := db.Where("source_id = ?", synologyPull.ID).Take(&encrypted).Error; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encrypted.Ciphertext, legacyCiphertext) {
		t.Fatal("disabled Synology Pull replaced its historical ciphertext")
	}
	// Credential revocation is still Owner-controlled even for dormant Sources.
	request(t, router, http.MethodDelete, synologyPullCredentialPath, tokenA, nil, http.StatusNoContent)
	var stillPaused meta.Source
	if err := db.First(&stillPaused, synologyPull.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stillPaused.Revision != 2 || stillPaused.Status != meta.SourceStatusPaused {
		t.Fatalf("Owner credential revocation changed Source lifecycle incorrectly: %+v", stillPaused)
	}
	var credentialCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", synologyPull.ID).Count(&credentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if credentialCount != 0 {
		t.Fatalf("revoked historical credential still persisted: %d", credentialCount)
	}

	statusPath := fmt.Sprintf("/api/v1/sources/%d/credential", source.ID)
	statusRes := request(t, router, http.MethodGet, statusPath, tokenA, nil, http.StatusOK)
	if strings.Contains(statusRes.Body.String(), "cookie") {
		t.Fatalf("credential status leaked plaintext: %s", statusRes.Body.String())
	}
	storedTestPath := fmt.Sprintf("/api/v1/sources/%d/credential/test", source.ID)
	revealPath := fmt.Sprintf("/api/v1/sources/%d/credential/reveal", source.ID)
	missingStored := request(t, router, http.MethodPost, storedTestPath, tokenA, nil, http.StatusConflict)
	if !strings.Contains(missingStored.Body.String(), "source_credential_not_configured") {
		t.Fatalf("missing stored credential response=%s", missingStored.Body.String())
	}
	missingReveal := request(t, router, http.MethodPost, revealPath, tokenA, nil, http.StatusConflict)
	if !strings.Contains(missingReveal.Body.String(), "source_credential_not_configured") {
		t.Fatalf("missing reveal credential response=%s", missingReveal.Body.String())
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
	if boundSource.TargetNodeID == nil || *boundSource.TargetNodeID == rootA.ID ||
		boundSource.Revision != 2 || boundSource.RunMode != meta.SourceRunModeSync {
		t.Fatalf("Yike managed target changed target/revision/run mode unexpectedly: %+v", boundSource)
	}
	var target meta.Node
	if err := db.First(&target, *boundSource.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	logicalTarget, err := server.logicalPath(target)
	if err != nil {
		t.Fatal(err)
	}
	if logicalTarget != "同步文件夹/Pull/Yike Photos/uid_12345_张三" {
		t.Fatalf("managed Yike target=%q", logicalTarget)
	}
	sourceGet := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d", source.ID), tokenA, nil, http.StatusOK)
	if !strings.Contains(sourceGet.Body.String(), `"target_path":"同步文件夹/Pull/Yike Photos/uid_12345_张三"`) {
		t.Fatalf("Yike source API did not expose the persisted target path: %s", sourceGet.Body.String())
	}
	revealRes := request(t, router, http.MethodPost, revealPath, tokenA, nil, http.StatusOK)
	if revealRes.Header().Get("Cache-Control") != "no-store" ||
		!strings.Contains(revealRes.Body.String(), `"field":"cookie"`) ||
		!strings.Contains(revealRes.Body.String(), `"value":"BDUSS=top-secret-cookie"`) ||
		!strings.Contains(revealRes.Body.String(), `"expires_in_seconds":30`) {
		t.Fatalf("Yike reveal payload=%s headers=%v", revealRes.Body.String(), revealRes.Header())
	}
	request(t, router, http.MethodPost, revealPath, tokenB, nil, http.StatusNotFound)

	// The managed target hierarchy is fixed. Ordinary node mutations must not
	// rename/move the target leaf or delete an ancestor that contains it.
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", target.ID), tokenA,
		strings.NewReader(`{"name":"手工改名"}`), http.StatusConflict,
		map[string]string{"Content-Type": "application/json", "If-Match": fmt.Sprintf("\"%d\"", target.Revision)})
	if target.ParentID == nil {
		t.Fatal("managed Yike target has no connector parent")
	}
	var protectedConnector meta.Node
	if err := db.First(&protectedConnector, *target.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", protectedConnector.ID), tokenA,
		nil, http.StatusConflict,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", protectedConnector.Revision)})

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

	// A detached fixed target with existing data must fail before sync instead
	// of letting a recreated Source discover per-file destination conflicts.
	accountExternalID = "77777"
	accountName = "王五"
	orphanTarget, err := ensureYikeManagedTargetTx(context.Background(), db, userA.ID, sourceCredentialTestDTO{
		AccountExternalID: accountExternalID,
		AccountName:       accountName,
	})
	if err != nil {
		t.Fatal(err)
	}
	orphanParentID := orphanTarget.ID
	if err := db.Create(&meta.Node{
		OwnerID: userA.ID, ParentID: &orphanParentID, Name: "已有数据", Type: meta.NodeTypeDir, Revision: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	orphanSource := meta.Source{
		OwnerID: userA.ID, Name: "Yike Recreated", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&orphanSource).Error; err != nil {
		t.Fatal(err)
	}
	orphanCredentialPath := fmt.Sprintf("/api/v1/sources/%d/credential", orphanSource.ID)
	orphanPut := requestWithHeaders(t, router, http.MethodPut, orphanCredentialPath, tokenA, strings.NewReader(body), http.StatusConflict,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(orphanPut.Body.String(), "yike_target_contains_unmanaged_data") {
		t.Fatalf("occupied Yike target response=%s", orphanPut.Body.String())
	}
	var orphanCredentialCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", orphanSource.ID).Count(&orphanCredentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if orphanCredentialCount != 0 {
		t.Fatalf("occupied Yike target persisted credential rows=%d", orphanCredentialCount)
	}

	// A filesystem object occupying the deterministic uid_* path is a user
	// conflict, not an internal server failure. Return an actionable 409 and
	// do not persist the credential.
	accountExternalID = "88888"
	accountName = "赵六"
	conflictParent, err := ensureYikeManagedParentTx(context.Background(), db, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	conflictParentID := conflictParent.ID
	conflictLeaf, err := yikeManagedTargetLeaf(88888, accountName)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.Node{
		OwnerID: userA.ID, ParentID: &conflictParentID, Name: conflictLeaf, Type: meta.NodeTypeFile, Revision: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	conflictSource := meta.Source{
		OwnerID: userA.ID, Name: "Yike Path Conflict", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&conflictSource).Error; err != nil {
		t.Fatal(err)
	}
	conflictCredentialPath := fmt.Sprintf("/api/v1/sources/%d/credential", conflictSource.ID)
	conflictPut := requestWithHeaders(t, router, http.MethodPut, conflictCredentialPath, tokenA, strings.NewReader(body), http.StatusConflict,
		map[string]string{"Content-Type": "application/json"})
	if !strings.Contains(conflictPut.Body.String(), "yike_target_path_conflict") {
		t.Fatalf("Yike target path conflict response=%s", conflictPut.Body.String())
	}
	var conflictCredentialCount int64
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", conflictSource.ID).Count(&conflictCredentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if conflictCredentialCount != 0 {
		t.Fatalf("path-conflicted Yike target persisted credential rows=%d", conflictCredentialCount)
	}

	// The orphan/conflict fixtures above intentionally occupy the fixed Yike
	// hierarchy. Remove only those test fixtures before simulating an otherwise
	// empty legacy 来源/一刻相册 tree; production pruning must never delete
	// non-empty legacy directories.
	cleanupIDs, err := activeSubtreeIDsDB(db, userA.ID, orphanTarget.ID)
	if err != nil {
		t.Fatal(err)
	}
	cleanupNow := time.Now().UTC()
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND id IN ? AND deleted_at IS NULL", userA.ID, cleanupIDs).
		Update("deleted_at", &cleanupNow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL", userA.ID, conflictParent.ID, conflictLeaf).
		Update("deleted_at", &cleanupNow).Error; err != nil {
		t.Fatal(err)
	}

	accountExternalID = "12345"
	accountName = "张三"

	// The legacy relocation contract requires per-Node ownership evidence.
	// A SourceItem with no NodeID is *not* proof and must not authorize moving
	// arbitrary ordinary content into the managed target.
	targetID := target.ID
	tracked := meta.Node{OwnerID: userA.ID, ParentID: &targetID,
		Name: "test.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&tracked).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItem{
		SourceID: source.ID, ExternalID: "yike:12345:999", Kind: meta.SourceItemKindFile,
		NodeID: &tracked.ID, NodeRevision: 1,
		Path: "test.jpg", State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
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

	// Simulate a Source whose existing managed target now sits below a renamed
	// ancestor. Credential refresh is not a migration operation: preserve the
	// exact TargetNodeID and its current path rather than moving any old data.
	var legacyConnector meta.Node
	if err := db.First(&legacyConnector, *target.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if legacyConnector.ParentID == nil {
		t.Fatal("managed Yike connector has no parent")
	}
	var pullRoot meta.Node
	if err := db.First(&pullRoot, *legacyConnector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if pullRoot.Name != "Pull" || pullRoot.ParentID == nil {
		t.Fatalf("managed Yike Pull root before ancestor rename=%+v", pullRoot)
	}
	var legacyRoot meta.Node
	if err := db.First(&legacyRoot, *pullRoot.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if legacyRoot.Name != "同步文件夹" {
		t.Fatalf("managed Yike umbrella before ancestor rename=%q", legacyRoot.Name)
	}
	if err := db.Model(&legacyRoot).Updates(map[string]any{"name": "来源", "revision": gorm.Expr("revision + 1")}).Error; err != nil {
		t.Fatal(err)
	}

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
	var migratedTarget meta.Node
	if err := db.First(&migratedTarget, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	migratedPath, err := server.logicalPath(migratedTarget)
	if err != nil {
		t.Fatal(err)
	}
	if migratedPath != "来源/Pull/Yike Photos/uid_12345_张三" {
		t.Fatalf("credential refresh changed the existing Yike target path: %q", migratedPath)
	}
	var legacyRootCount int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL", userA.ID, rootA.ID, "来源").
		Count(&legacyRootCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyRootCount != 1 {
		t.Fatalf("credential refresh must preserve the existing ancestor; active root count=%d", legacyRootCount)
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
			[]string{"source.credential.update", "source.credential.delete", "source.credential.reveal"}).
		Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 5 {
		t.Fatalf("credential audit events=%d want=5", auditCount)
	}
	var revealAudit meta.AuditEvent
	if err := db.Where("target_type = ? AND target_id = ? AND action = ?",
		"source", fmt.Sprintf("%d", source.ID), "source.credential.reveal").
		First(&revealAudit).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(revealAudit.Metadata, "BDUSS") || strings.Contains(revealAudit.Metadata, "top-secret-cookie") ||
		!strings.Contains(revealAudit.Metadata, `"field":"cookie"`) {
		t.Fatalf("credential reveal audit metadata is unsafe: %s", revealAudit.Metadata)
	}

	// A privileged request must NOT receive plaintext when its audit INSERT
	// cannot commit; the settings eye must fail closed instead of silently
	// logging a warning and returning the saved login cookie.
	const protectedCookie = "BDUSS=audit-required-cookie"
	if err := sourcecredential.Put(context.Background(), db, server.ConnectorSecrets, source,
		[]byte(`{"cookie":"`+protectedCookie+`"}`)); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	failedReveal := request(t, router, http.MethodPost, revealPath, tokenA, nil, http.StatusServiceUnavailable)
	if strings.Contains(failedReveal.Body.String(), protectedCookie) ||
		strings.Contains(failedReveal.Body.String(), `"field":"cookie"`) {
		t.Fatalf("credential disclosed even though audit storage failed: %s", failedReveal.Body.String())
	}
}
