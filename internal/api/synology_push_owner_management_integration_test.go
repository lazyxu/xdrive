package api

import (
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

// Owner controls schedule, pause and cancel; only the enrolled NAS can
// create, read or mutate SourceRun content with its persisted Root proof.
func TestSynologyPushOwnerControlPlaneDoesNotGrantExecution(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("synology-owner-management-fixture", time.Hour)
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	deviceID, deviceToken := uuid.NewString(), strings.Repeat("synology-owner-control-secret-", 2)
	if err := db.Create(&meta.ClientDevice{
		ID: deviceID, OwnerID: owner.ID, Name: "Home NAS", Platform: "synology",
		CredentialHash: deviceCredentialDigest(deviceToken),
	}).Error; err != nil {
		t.Fatal(err)
	}
	deviceHeaders := map[string]string{
		"X-XDrive-Device-ID": deviceID, "X-XDrive-Device-Token": deviceToken,
	}
	createPath := "/api/v1/sources"
	createBackup := `{"name":"DSM Control Photos","kind":"synology_photos","direction":"push","sync_mode":"backup","run_mode":"scan","target_node_id":0}`
	request(t, router, http.MethodPost, createPath, ownerToken,
		strings.NewReader(createBackup), http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, createPath, ownerToken,
		strings.NewReader(`{"name":"DSM Mirror Forbidden","kind":"synology_photos","direction":"push","sync_mode":"mirror","run_mode":"sync","target_node_id":0}`),
		http.StatusBadRequest, deviceHeaders)
	created := requestWithHeaders(t, router, http.MethodPost, createPath, ownerToken,
		strings.NewReader(createBackup), http.StatusCreated, deviceHeaders)
	var source sourceDTO
	if err := json.Unmarshal(created.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.Status != meta.SourceStatusPaused || source.TargetNodeID == nil || source.DeviceID != deviceID {
		t.Fatalf("DSM Push is not paused, Device-bound and managed: %+v", source)
	}
	path := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	requestWithHeaders(t, router, http.MethodPatch, path, ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})

	// Owner management is not a substitute for NAS enrollment.
	updated := requestWithHeaders(t, router, http.MethodPatch, path, ownerToken,
		strings.NewReader(`{"schedule_type":"interval","schedule_expression":"12h"}`),
		http.StatusOK, map[string]string{"If-Match": `"1"`})
	var scheduled sourceDTO
	if err := json.Unmarshal(updated.Body.Bytes(), &scheduled); err != nil {
		t.Fatal(err)
	}
	if scheduled.Revision != 2 || scheduled.ScheduleExpression != "12h" ||
		scheduled.Status != meta.SourceStatusPaused {
		t.Fatalf("Owner schedule edit changed enrollment state: %+v", scheduled)
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("a", 64)
	bound := requestWithHeaders(t, router, http.MethodPut, path+"/synology-root",
		ownerToken, strings.NewReader(fmt.Sprintf(`{"root_id":%q,"root_fingerprint":%q}`, rootID, fingerprint)),
		http.StatusCreated, map[string]string{
			"X-XDrive-Device-ID": deviceID, "X-XDrive-Device-Token": deviceToken,
			"If-Match": `"2"`,
		})
	var binding synologySourceRootBindingDTO
	if err := json.Unmarshal(bound.Body.Bytes(), &binding); err != nil {
		t.Fatal(err)
	}
	if binding.Revision != 3 || binding.Status != meta.SourceStatusPaused {
		t.Fatalf("unexpected DSM Root binding: %+v", binding)
	}
	activated := requestWithHeaders(t, router, http.MethodPatch, path, ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusOK,
		map[string]string{"If-Match": `"3"`})
	var active sourceDTO
	if err := json.Unmarshal(activated.Body.Bytes(), &active); err != nil {
		t.Fatal(err)
	}
	if active.Revision != 4 || active.Status != meta.SourceStatusActive {
		t.Fatalf("Owner activation lost server-side Device/Root fence: %+v", active)
	}

	requestWithHeaders(t, router, http.MethodPatch, path, ownerToken,
		strings.NewReader(`{"sync_mode":"mirror"}`), http.StatusBadRequest,
		map[string]string{"If-Match": `"4"`})
	request(t, router, http.MethodPost, path+"/trigger", ownerToken, nil, http.StatusAccepted)
	runID := uuid.NewString()
	runPath := path + "/runs"
	startBody := fmt.Sprintf(`{"run_id":%q,"trigger":"manual"}`, runID)
	request(t, router, http.MethodPost, runPath, ownerToken,
		strings.NewReader(startBody), http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, runPath, ownerToken,
		strings.NewReader(startBody), http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": deviceID, "X-XDrive-Device-Token": "incorrect"})
	proof := map[string]string{
		"X-XDrive-Device-ID": deviceID, "X-XDrive-Device-Token": deviceToken,
		"X-XDrive-Synology-Source-ID": fmt.Sprint(source.ID),
		"X-XDrive-Synology-Source-Revision": "4",
		"X-XDrive-Local-Root-ID": rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	requestWithHeaders(t, router, http.MethodPost, runPath, ownerToken,
		strings.NewReader(startBody), http.StatusCreated, proof)
	request(t, router, http.MethodPost, runPath+"/"+runID+"/cancel",
		ownerToken, strings.NewReader(`{}`), http.StatusAccepted)
	// Missing NAS proof is still rejected at the content-write boundary.
	request(t, router, http.MethodPost, "/api/v1/uploads", ownerToken,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"owner.jpg","size":3,"chunk_size":3}`, *source.TargetNodeID)),
		http.StatusConflict)
}
