package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSynologyPushRootBindingAndUploadAuthorization(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.FileVersion{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("synology-root-upload-auth-test", time.Hour)
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	deviceID := uuid.NewString()
	deviceToken := strings.Repeat("synology-root-device-token-", 2)
	device := meta.ClientDevice{
		ID: deviceID, OwnerID: owner.ID, Name: "DSM Root Test", Platform: "synology",
		CredentialHash: deviceCredentialDigest(deviceToken),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	deviceHeaders := map[string]string{
		"X-XDrive-Device-ID":    deviceID,
		"X-XDrive-Device-Token": deviceToken,
	}
	createdResponse := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(`{"name":"DSM Root Photos","kind":"synology_photos","direction":"push","sync_mode":"backup","run_mode":"sync","target_node_id":0}`),
		http.StatusCreated, deviceHeaders)
	var source sourceDTO
	if err := json.Unmarshal(createdResponse.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.ID == 0 || source.TargetNodeID == nil || !source.TargetManaged ||
		source.DeviceID != deviceID || source.Status != meta.SourceStatusPaused {
		t.Fatalf("new DSM Source was not device-bound and paused: %+v", source)
	}

	rootID := uuid.NewString()
	rootFingerprint := strings.Repeat("a", 64)
	bindingPath := fmt.Sprintf("/api/v1/sources/%d/synology-root", source.ID)
	body := fmt.Sprintf(`{"root_id":%q,"root_fingerprint":%q}`, rootID, rootFingerprint)
	// A missing revision fails before credential evaluation; supplying a
	// revision without device proof must still be denied.
	request(t, router, http.MethodPut, bindingPath, ownerToken, strings.NewReader(body), http.StatusPreconditionRequired)
	requestWithHeaders(t, router, http.MethodPut, bindingPath, ownerToken,
		strings.NewReader(body), http.StatusForbidden,
		map[string]string{"If-Match": `"1"`})
	bindHeaders := map[string]string{
		"X-XDrive-Device-ID":    deviceID,
		"X-XDrive-Device-Token": deviceToken,
		"If-Match":              `"1"`,
	}
	boundResponse := requestWithHeaders(t, router, http.MethodPut, bindingPath, ownerToken,
		strings.NewReader(body), http.StatusCreated, bindHeaders)
	var binding synologySourceRootBindingDTO
	if err := json.Unmarshal(boundResponse.Body.Bytes(), &binding); err != nil {
		t.Fatal(err)
	}
	if binding.SourceID != source.ID || binding.Revision != 2 || binding.Status != meta.SourceStatusPaused {
		t.Fatalf("unexpected root binding response: %+v", binding)
	}
	var persisted meta.LocalSourceBinding
	if err := db.Where("source_id = ?", source.ID).Take(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.DeviceID != deviceID || persisted.RootID != rootID ||
		persisted.RootFingerprint != rootFingerprint {
		t.Fatalf("persisted root binding mismatch: %+v", persisted)
	}
	var storedSource meta.Source
	if err := db.First(&storedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedSource.Status != meta.SourceStatusPaused || storedSource.Revision != 2 {
		t.Fatalf("root binding did not pause/fence the Source: %+v", storedSource)
	}

	// Same binding is idempotent; a different Root cannot silently take over.
	requestWithHeaders(t, router, http.MethodPut, bindingPath, ownerToken,
		strings.NewReader(body), http.StatusOK, map[string]string{
			"X-XDrive-Device-ID":    deviceID,
			"X-XDrive-Device-Token": deviceToken,
			"If-Match":              `"2"`,
		})
	changedBody := fmt.Sprintf(`{"root_id":%q,"root_fingerprint":%q}`, rootID, strings.Repeat("b", 64))
	requestWithHeaders(t, router, http.MethodPut, bindingPath, ownerToken,
		strings.NewReader(changedBody), http.StatusConflict, map[string]string{
			"X-XDrive-Device-ID":    deviceID,
			"X-XDrive-Device-Token": deviceToken,
			"If-Match":              `"2"`,
		})

	// An Owner JWT or Device-only credential cannot execute the Source.
	sourcePath := fmt.Sprintf("/api/v1/sources/%d/local-rules", source.ID)
	request(t, router, http.MethodGet, sourcePath, ownerToken, nil, http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodGet, sourcePath, ownerToken, nil, http.StatusForbidden, deviceHeaders)

	proofHeaders := map[string]string{
		"X-XDrive-Device-ID":                deviceID,
		"X-XDrive-Device-Token":             deviceToken,
		"X-XDrive-Synology-Source-ID":       fmt.Sprint(source.ID),
		"X-XDrive-Synology-Source-Revision": "2",
		"X-XDrive-Local-Root-ID":            rootID,
		"X-XDrive-Local-Root-Fingerprint":   rootFingerprint,
	}
	// This endpoint is deliberately local_folder-only. Even complete DSM
	// Device/Source/Root proof must not grant generic Desktop Agent rights.
	// Positive DSM authorization is exercised by the activation and managed
	// CAS upload below, which use the Synology-specific proof path.
	requestWithHeaders(t, router, http.MethodGet, sourcePath, ownerToken, nil, http.StatusBadRequest, proofHeaders)

	// Activation is allowed only with the same persisted Device/Source/Root proof.
	activationHeaders := map[string]string{}
	for k, v := range proofHeaders {
		activationHeaders[k] = v
	}
	activationHeaders["If-Match"] = `"2"`
	activatedResponse := requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/sources/%d", source.ID), ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusOK, activationHeaders)
	var activated sourceDTO
	if err := json.Unmarshal(activatedResponse.Body.Bytes(), &activated); err != nil {
		t.Fatal(err)
	}
	if activated.Status != meta.SourceStatusActive || activated.Revision != 3 {
		t.Fatalf("Source activation did not preserve root-bound revision: %+v", activated)
	}
	proofHeaders["X-XDrive-Synology-Source-Revision"] = "3"

	// The generic Owner upload path cannot write into the managed DSM target.
	ordinaryUpload := fmt.Sprintf(`{"parent_id":%d,"name":"owner.jpg","size":3,"chunk_size":3}`, *source.TargetNodeID)
	request(t, router, http.MethodPost, "/api/v1/uploads", ownerToken,
		strings.NewReader(ordinaryUpload), http.StatusConflict)

	// The same CAS UploadSession engine accepts an exact current DSM proof.
	managedUpload := fmt.Sprintf(`{"parent_id":%d,"name":"dsm.jpg","size":3,"chunk_size":3,"source_id":%d,"source_revision":3,"source_root_id":%q,"source_root_fingerprint":%q}`,
		*source.TargetNodeID, source.ID, rootID, rootFingerprint)
	uploadResponse := requestWithHeaders(t, router, http.MethodPost, "/api/v1/uploads", ownerToken,
		strings.NewReader(managedUpload), http.StatusCreated, proofHeaders)
	var upload uploadSessionDTO
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &upload); err != nil {
		t.Fatal(err)
	}
	if upload.ID == "" || upload.Status != meta.UploadStatusActive {
		t.Fatalf("expected active DSM-bound UploadSession, got %+v", upload)
	}

	// Revocation pauses the Source and immediately fences chunk and Finalize.
	requestWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/devices/%s/revoke", deviceID),
		ownerToken, nil, http.StatusNoContent, nil)
	chunkHash := sha256.Sum256([]byte("abc"))
	chunkHeaders := map[string]string{}
	for k, v := range proofHeaders {
		chunkHeaders[k] = v
	}
	chunkHeaders["X-Chunk-SHA256"] = hex.EncodeToString(chunkHash[:])
	requestWithHeaders(t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/uploads/%s/chunks/0", upload.ID), ownerToken,
		bytes.NewReader([]byte("abc")), http.StatusForbidden, chunkHeaders)
	requestWithHeaders(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/uploads/%s/finalize", upload.ID), ownerToken,
		strings.NewReader(`{}`), http.StatusForbidden, proofHeaders)
}
