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

// Same-account foreign Desktops may read the B-scope projection, not steal
// the local Source A was created to own. Root presence is not a device grant.
func TestLocalSourceCreateAndFirstBindRequireCreatingDevice(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-creator-claim-test", time.Hour)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secretA := "creating-device-A-secret-credential-000000000"
	secretB := "creating-device-B-secret-credential-000000000"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "A", Platform: "windows", CredentialHash: deviceCredentialDigest(secretA), CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "B", Platform: "linux", CredentialHash: deviceCredentialDigest(secretB), CreatedAt: now, UpdatedAt: now}
	for _, dev := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&dev).Error; err != nil {
			t.Fatal(err)
		}
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Backups")
	createBody := fmt.Sprintf(`{"name":"A photos","kind":"local_folder","direction":"push","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":%d}`, target.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", ownerJWT, strings.NewReader(createBody), http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerJWT, strings.NewReader(createBody), http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": secretB})
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerJWT, strings.NewReader(createBody), http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": deviceB.ID, "X-XDrive-Device-Token": secretA})
	valid := map[string]string{"X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": secretA}
	response := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerJWT, strings.NewReader(createBody), http.StatusCreated, valid)
	var created sourceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Revision != 1 || created.Status != meta.SourceStatusPaused {
		t.Fatalf("local Source must be paused and revision one: %+v", created)
	}
	if strings.Contains(response.Body.String(), "creator_device") || strings.Contains(response.Body.String(), secretA) {
		t.Fatalf("device claim or secret leaked: %s", response.Body.String())
	}
	var saved meta.Source
	if err := db.Where("id = ?", created.ID).First(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved.LocalCreatorDeviceID == nil || *saved.LocalCreatorDeviceID != deviceA.ID {
		t.Fatalf("creating device claim not stored: %+v", saved.LocalCreatorDeviceID)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	bindURL := fmt.Sprintf("/api/v1/sources/%d/local-binding", created.ID)
	foreignBody := fmt.Sprintf(`{"device_id":%q,"root_id":%q,"root_fingerprint":%q}`, deviceB.ID, rootID, fingerprint)
	requestWithHeaders(t, router, http.MethodPost, bindURL, ownerJWT, strings.NewReader(foreignBody), http.StatusForbidden,
		map[string]string{"If-Match": `"1"`, "X-XDrive-Device-Token": secretB})
	ownBody := fmt.Sprintf(`{"device_id":%q,"root_id":%q,"root_fingerprint":%q}`, deviceA.ID, rootID, fingerprint)
	requestWithHeaders(t, router, http.MethodPost, bindURL, ownerJWT, strings.NewReader(ownBody), http.StatusCreated,
		map[string]string{"If-Match": `"1"`, "X-XDrive-Device-Token": secretA})
	// Already-bound legacy rows must still accept idempotent recovery.
	if err := db.Model(&meta.Source{}).Where("id = ?", created.ID).
		Update("local_creator_device_id", nil).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, bindURL, ownerJWT, strings.NewReader(ownBody), http.StatusOK,
		map[string]string{"If-Match": `"2"`, "X-XDrive-Device-Token": secretA})
	legacy := meta.Source{OwnerID: owner.ID, Name: "Legacy unbound", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, Status: meta.SourceStatusPaused,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Revision: 1, TargetNodeID: &target.ID}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/local-binding", legacy.ID),
		ownerJWT, strings.NewReader(ownBody), http.StatusForbidden,
		map[string]string{"If-Match": `"1"`, "X-XDrive-Device-Token": secretA})
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerJWT,
		strings.NewReader(strings.Replace(createBody, "A photos", "A photos revoked", 1)),
		http.StatusForbidden, valid)
	// Existing Pull Sources retain owner-JWT creation without device claims.
	request(t, router, http.MethodPost, "/api/v1/sources", ownerJWT,
		strings.NewReader(`{"name":"Yike photos","kind":"yike_photos","direction":"pull","schedule_type":"manual"}`), http.StatusCreated)
}
