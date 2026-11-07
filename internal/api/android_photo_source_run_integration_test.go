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

// Actual authenticated HTTP + PostgreSQL SourceRun writers, not a fabricated
// status. The Android credential is identity-only, and may execute ONLY its
// own paused native Photos Source under an exclusive managed TargetNodeID.
func TestAndroidPhotoSourceRunDeviceAuthorizationHistoryAndRenameFence(t *testing.T) {
	db, server, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.SyncRun{}, &meta.UploadSession{},
		&meta.SourceItem{}, &meta.SourceRunFailure{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("android-photo-source-run", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	secret := strings.Repeat("android-photos-run-device-credential-", 2)
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Platform: "android",
		Name: "Pixel Run", CredentialHash: deviceCredentialDigest(secret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	proof := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	destinationPath := "/api/v1/android/photos/backup-destination"
	created := requestWithHeaders(t, router, http.MethodPut, destinationPath,
		token, strings.NewReader(`{"name":"Android 本机备份"}`), http.StatusCreated, proof)
	var dest struct {
		SourceID       uint64 `json:"source_id"`
		SourceRevision uint64 `json:"source_revision"`
		TargetNodeID   uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &dest); err != nil {
		t.Fatal(err)
	}
	if dest.SourceID == 0 || dest.SourceRevision != 1 || dest.TargetNodeID == 0 {
		t.Fatalf("missing registered Android Source/Target: %+v", dest)
	}
	base := fmt.Sprintf("/api/v1/sources/%d/runs", dest.SourceID)
	runID := uuid.NewString()
	beginBody := fmt.Sprintf(`{"run_id":%q,"trigger":"manual"}`, runID)
	requestWithHeaders(t, router, http.MethodPost, base, token,
		strings.NewReader(beginBody), http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodPost, base, foreignToken,
		strings.NewReader(beginBody), http.StatusNotFound, proof)
	wrongDevice := map[string]string{
		"X-XDrive-Device-ID": uuid.NewString(), "X-XDrive-Device-Token": secret,
	}
	requestWithHeaders(t, router, http.MethodPost, base, token,
		strings.NewReader(beginBody), http.StatusForbidden, wrongDevice)
	// Neither a real Android Device nor a valid Owner JWT alone is an
	// authorized local_folder executor or cross-Source runner.
	requestWithHeaders(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/local-rules", dest.SourceID),
		token, nil, http.StatusForbidden, proof)

	started := requestWithHeaders(t, router, http.MethodPost, base, token,
		strings.NewReader(beginBody), http.StatusCreated, proof)
	var run struct {
		ID             string  `json:"id"`
		SourceID       uint64  `json:"source_id"`
		SourceRevision uint64  `json:"source_revision"`
		TargetNodeID   *uint64 `json:"target_node_id"`
		Status         string  `json:"status"`
	}
	if err := json.Unmarshal(started.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	if run.ID != runID || run.SourceID != dest.SourceID ||
		run.SourceRevision != 1 || run.TargetNodeID == nil ||
		*run.TargetNodeID != dest.TargetNodeID ||
		run.Status != meta.SyncRunStatusRunning {
		t.Fatalf("SourceRun did not retain Source/Node identity: %+v", run)
	}
	// Q4: even while the batch is scanning/staging before a CAS UploadSession,
	// the destination cannot be renamed.
	requestWithHeaders(t, router, http.MethodPut, destinationPath, token,
		strings.NewReader(`{"name":"禁止运行中改名"}`), http.StatusConflict, proof)
	requestWithHeaders(t, router, http.MethodPost, base, token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"manual"}`, uuid.NewString())),
		http.StatusConflict, proof)

	progress := `{"scanned_items":4,"new_items":2,"unchanged_items":2,"failed_items":0}`
	progressPath := base + "/" + runID + "/progress"
	requestWithHeaders(t, router, http.MethodPost, progressPath, token,
		strings.NewReader(`{"summary":`+progress+`}`), http.StatusNoContent, proof)
	heartbeatPath := base + "/" + runID + "/heartbeat"
	requestWithHeaders(t, router, http.MethodPost, heartbeatPath, token,
		strings.NewReader(`{}`), http.StatusNoContent, proof)
	requestWithHeaders(t, router, http.MethodPost, progressPath, token,
		strings.NewReader(`{"summary":`+progress+`}`), http.StatusForbidden, nil)

	finishPath := base + "/" + runID + "/finish"
	finished := requestWithHeaders(t, router, http.MethodPost, finishPath, token,
		strings.NewReader(`{"status":"completed","complete_inventory":false,"summary":`+progress+`}`),
		http.StatusOK, proof)
	var terminal struct {
		Status           string `json:"status"`
		ScannedItems     int64  `json:"scanned_items"`
		NewItems         int64  `json:"new_items"`
		UnchangedItems   int64  `json:"unchanged_items"`
		SyncedFileItems  int64  `json:"synced_file_items"`
		TransferredItems int64  `json:"transferred_items"`
	}
	if err := json.Unmarshal(finished.Body.Bytes(), &terminal); err != nil {
		t.Fatal(err)
	}
	if terminal.Status != meta.SyncRunStatusCompleted ||
		terminal.ScannedItems != 4 || terminal.NewItems != 2 ||
		terminal.UnchangedItems != 2 || terminal.SyncedFileItems != 4 ||
		terminal.TransferredItems != 2 {
		t.Fatalf("incorrect durable Android SourceRun history: %+v", terminal)
	}
	var persisted meta.Source
	if err := db.First(&persisted, dest.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Status != meta.SourceStatusPaused || persisted.LastRunAt == nil ||
		persisted.LastSuccessAt == nil || persisted.TargetNodeID == nil ||
		*persisted.TargetNodeID != dest.TargetNodeID {
		t.Fatalf("Android device-owned paused Source did not retain receipt/history: %+v", persisted)
	}
	var sourceItems int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", dest.SourceID).
		Count(&sourceItems).Error; err != nil {
		t.Fatal(err)
	}
	if sourceItems != 0 {
		t.Fatalf("private MediaStore IDs must not become shared SourceItems: %d", sourceItems)
	}
	// A completed batch can be followed by a revision-checked atomic rename,
	// preserving the same Source and Target Node IDs.
	renamed := requestWithHeaders(t, router, http.MethodPut, destinationPath, token,
		strings.NewReader(`{"name":"Android 已完成"}`), http.StatusOK, proof)
	var rename struct {
		SourceID       uint64 `json:"source_id"`
		SourceRevision uint64 `json:"source_revision"`
		TargetNodeID   uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(renamed.Body.Bytes(), &rename); err != nil {
		t.Fatal(err)
	}
	if rename.SourceID != dest.SourceID || rename.TargetNodeID != dest.TargetNodeID ||
		rename.SourceRevision != 2 {
		t.Fatalf("rename changed Source/Node identity: %+v", rename)
	}
	nextID := uuid.NewString()
	requestWithHeaders(t, router, http.MethodPost, base, token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, nextID)),
		http.StatusCreated, proof)
	nextProgress := base + "/" + nextID + "/progress"
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, nextProgress, token,
		strings.NewReader(`{"summary":`+progress+`}`), http.StatusForbidden, proof)
	requestWithHeaders(t, router, http.MethodPost, base+"/"+nextID+"/heartbeat",
		token, strings.NewReader(`{}`), http.StatusForbidden, proof)
	requestWithHeaders(t, router, http.MethodPost, base+"/"+nextID+"/finish",
		token, strings.NewReader(`{"status":"completed","complete_inventory":false,"summary":`+progress+`}`),
		http.StatusForbidden, proof)
}
