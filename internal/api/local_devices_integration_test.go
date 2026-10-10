package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestLocalFolderSourceRunDeviceProofIsRequiredOnEveryWriteStage(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}, &meta.SourceRunFailure{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-source-executor-proof-test", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	deviceToken := "safe-raw-local-device-secret-contains-at-least-32-bytes"
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Source executor", Platform: "windows",
		CredentialHash: deviceCredentialDigest(deviceToken),
		CreatedAt:      now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("b", 64)
	rootNodeID := root.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "Local push run authorization", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &rootNodeID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	binding := meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf("/api/v1/sources/%d/runs", source.ID)
	runID := uuid.NewString()
	paths := []string{
		prefix,
		prefix + "/" + runID + "/observe",
		prefix + "/" + runID + "/commit",
		prefix + "/" + runID + "/failures",
		prefix + "/" + runID + "/progress",
		prefix + "/" + runID + "/heartbeat",
		prefix + "/" + runID + "/finish",
	}
	valid := map[string]string{
		"X-XDrive-Device-ID":              device.ID,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
		"X-XDrive-Device-Token":           deviceToken,
	}
	for _, path := range paths {
		request(t, router, http.MethodPost, path, ownerToken, nil, http.StatusForbidden)
		requestWithHeaders(t, router, http.MethodPost, path, otherToken, nil, http.StatusNotFound, valid)
		incorrectToken := map[string]string{
			"X-XDrive-Device-ID":              device.ID,
			"X-XDrive-Local-Root-ID":          rootID,
			"X-XDrive-Local-Root-Fingerprint": fingerprint,
			"X-XDrive-Device-Token":           "wrong",
		}
		requestWithHeaders(t, router, http.MethodPost, path, ownerToken, nil, http.StatusForbidden, incorrectToken)
	}
	wrongRoot := map[string]string{
		"X-XDrive-Device-ID":              device.ID,
		"X-XDrive-Local-Root-ID":          uuid.NewString(),
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
		"X-XDrive-Device-Token":           deviceToken,
	}
	requestWithHeaders(t, router, http.MethodPost, prefix, ownerToken, nil, http.StatusForbidden, wrongRoot)
	// Valid proof cannot bypass the L01-A fail-closed executor readiness gate.
	requestWithHeaders(t, router, http.MethodPost, prefix, ownerToken,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q}`, uuid.NewString())),
		http.StatusConflict, valid)
	var count int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("local folder started %d runs without native executor", count)
	}
	// Authoritative transaction proof is rechecked under device + Source locks.
	txContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	txContext.Request = httptest.NewRequest(http.MethodPost, prefix, nil)
	txContext.Request.Header.Set("X-XDrive-Device-Token", deviceToken)
	txContext.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", fingerprint)
	txContext.Set("userID", owner.ID)
	txContext.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: device.ID, RootID: rootID, SourceRevision: 1,
	})
	checkTransaction := func(shouldPass bool) {
		t.Helper()
		err := db.Transaction(func(tx *gorm.DB) error {
			return server.requireLocalSourceExecutorTx(tx, txContext, source.ID, "")
		})
		if shouldPass && err != nil {
			t.Fatalf("current device proof rejected inside transaction: %v", err)
		}
		if !shouldPass && !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
			t.Fatalf("obsolete device proof accepted inside transaction: %v", err)
		}
	}
	checkTransaction(true)
	// A run accepted under a different Source revision cannot be mutated even
	// if the current binding/device credential is otherwise valid.
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, RunNumber: 1,
		SourceRevision: 1, SyncMode: meta.SourceSyncModeBackup,
		Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return server.requireLocalSourceExecutorTx(tx, txContext, source.ID, run.ID)
	}); err != nil {
		t.Fatalf("matching run source revision rejected: %v", err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("source_revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return server.requireLocalSourceExecutorTx(tx, txContext, source.ID, run.ID)
	}); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("mismatched run source revision was accepted: %v", err)
	}
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	checkTransaction(false)
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("revision", 1).Error; err != nil {
		t.Fatal(err)
	}
	revokedAt := now.Add(time.Second)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", revokedAt).Error; err != nil {
		t.Fatal(err)
	}
	checkTransaction(false)
	requestWithHeaders(t, router, http.MethodPost, prefix, ownerToken,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q}`, uuid.NewString())),
		http.StatusForbidden, valid)
}

func TestLocalFolderDeviceBindingAndRevocation(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-device-enrollment-test-secret", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Backup")
	create := fmt.Sprintf(`{"name":"Laptop Photos","kind":"local_folder","direction":"push","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":%d}`, target.ID)
	created := request(t, router, http.MethodPost, "/api/v1/sources", ownerToken, strings.NewReader(create), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(created.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.Status != meta.SourceStatusPaused || source.Revision != 1 {
		t.Fatalf("local source must start paused: %+v", source)
	}
	sourceURL := fmt.Sprintf("/api/v1/sources/%d", source.ID)

	// Device registration is owner-scoped and returns its secret exactly once.
	registration := request(t, router, http.MethodPost, "/api/v1/devices", ownerToken,
		strings.NewReader(`{"name":"My Windows PC","platform":"windows","client_version":"0.1"}`),
		http.StatusCreated)
	var enrolled registeredClientDeviceDTO
	if err := json.Unmarshal(registration.Body.Bytes(), &enrolled); err != nil {
		t.Fatal(err)
	}
	if enrolled.Device.ID == "" || enrolled.DeviceToken == "" ||
		enrolled.Device.Platform != "windows" ||
		registration.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("invalid one-time device enrollment: %+v", enrolled.Device)
	}
	var stored meta.ClientDevice
	if err := db.Where("id = ?", enrolled.Device.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.OwnerID != owner.ID || stored.CredentialHash == "" ||
		stored.CredentialHash == enrolled.DeviceToken {
		t.Fatal("raw device credential must never be persisted")
	}
	ownerList := request(t, router, http.MethodGet, "/api/v1/devices", ownerToken, nil, http.StatusOK)
	if strings.Contains(ownerList.Body.String(), enrolled.DeviceToken) ||
		strings.Contains(ownerList.Body.String(), stored.CredentialHash) ||
		!strings.Contains(ownerList.Body.String(), enrolled.Device.ID) {
		t.Fatal("device list leaked secret or omitted owned device")
	}
	otherList := request(t, router, http.MethodGet, "/api/v1/devices", otherToken, nil, http.StatusOK)
	if strings.Contains(otherList.Body.String(), enrolled.Device.ID) {
		t.Fatal("another owner saw registered device")
	}

	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	payload := fmt.Sprintf(`{"device_id":%q,"root_id":%q,"root_fingerprint":%q}`,
		enrolled.Device.ID, rootID, fingerprint)
	headers := map[string]string{"If-Match": `"1"`, "X-XDrive-Device-Token": "wrong-device-token"}
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding", ownerToken,
		strings.NewReader(payload), http.StatusForbidden, headers)
	headers["X-XDrive-Device-Token"] = enrolled.DeviceToken
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding", otherToken,
		strings.NewReader(payload), http.StatusForbidden, headers)
	boundResponse := requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding",
		ownerToken, strings.NewReader(payload), http.StatusCreated, headers)
	var bound localSourceBindingDTO
	if err := json.Unmarshal(boundResponse.Body.Bytes(), &bound); err != nil {
		t.Fatal(err)
	}
	if bound.SourceID != source.ID || bound.DeviceID != enrolled.Device.ID ||
		bound.RootID != rootID || bound.Status != "awaiting_executor" ||
		strings.Contains(boundResponse.Body.String(), fingerprint) {
		t.Fatalf("unexpected Root binding: %+v", bound)
	}
	headers["If-Match"] = `"2"`
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding", ownerToken,
		strings.NewReader(payload), http.StatusOK, headers)
	changedRoot := fmt.Sprintf(`{"device_id":%q,"root_id":%q,"root_fingerprint":%q}`,
		enrolled.Device.ID, uuid.NewString(), fingerprint)
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding", ownerToken,
		strings.NewReader(changedRoot), http.StatusConflict, headers)

	// Device registration and binding alone never enable an unimplemented executor.
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{
			"If-Match": `"2"`, "X-XDrive-Device-ID": enrolled.Device.ID,
			"X-XDrive-Device-Token":           enrolled.DeviceToken,
			"X-XDrive-Local-Root-ID":          rootID,
			"X-XDrive-Local-Root-Fingerprint": fingerprint,
		})
	request(t, router, http.MethodPost, sourceURL+"/runs", ownerToken,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q}`, uuid.NewString())), http.StatusForbidden)

	revokeURL := "/api/v1/devices/" + enrolled.Device.ID + "/revoke"
	request(t, router, http.MethodPost, revokeURL, ownerToken, nil, http.StatusNoContent)
	request(t, router, http.MethodPost, revokeURL, ownerToken, nil, http.StatusNoContent)
	bindingRead := request(t, router, http.MethodGet, sourceURL+"/local-binding", ownerToken, nil, http.StatusOK)
	if !strings.Contains(bindingRead.Body.String(), "device_revoked") {
		t.Fatalf("revoked binding status missing: %s", bindingRead.Body.String())
	}
	headers["If-Match"] = `"3"`
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/local-binding", ownerToken,
		strings.NewReader(payload), http.StatusForbidden, headers)
	// Revocation does not empower a remote JWT-only caller to unbind or delete
	// the linked local Source; that would bypass device-local ownership.
	requestWithHeaders(t, router, http.MethodDelete, sourceURL+"/local-binding", ownerToken,
		nil, http.StatusForbidden, map[string]string{"If-Match": `"3"`})
	request(t, router, http.MethodGet, sourceURL+"/local-binding", ownerToken, nil, http.StatusOK)
	requestWithHeaders(t, router, http.MethodDelete, sourceURL, ownerToken,
		nil, http.StatusForbidden, map[string]string{"If-Match": `"3"`})
}
