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

func TestBoundLocalSourceArchiveRestoreRequiresOwningDeviceAndRetainsRootBinding(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-source-archive-restore-test", time.Hour)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	deviceSecret := "local-archive-device-secret-long-enough-0001"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owning Desktop",
		Platform: "windows", CredentialHash: deviceCredentialDigest(deviceSecret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	targetID := root.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "Local Photos", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
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
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	proof := map[string]string{
		"X-XDrive-Device-ID":              device.ID,
		"X-XDrive-Device-Token":           deviceSecret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
		"If-Match":                        `"1"`,
	}
	// An Owner JWT cannot archive a local Push Source without the exact
	// enrolled Device credential and Root identity.
	requestWithHeaders(t, router, http.MethodPost, url+"/archive", ownerJWT, nil,
		http.StatusForbidden, map[string]string{"If-Match": `"1"`})
	wrong := map[string]string{}
	for key, value := range proof {
		wrong[key] = value
	}
	wrong["X-XDrive-Device-Token"] = "wrong-device-secret"
	requestWithHeaders(t, router, http.MethodPost, url+"/archive", ownerJWT, nil,
		http.StatusForbidden, wrong)

	archivedResponse := requestWithHeaders(t, router, http.MethodPost, url+"/archive", ownerJWT, nil,
		http.StatusOK, proof)
	var archived sourceDTO
	if err := json.Unmarshal(archivedResponse.Body.Bytes(), &archived); err != nil {
		t.Fatal(err)
	}
	if archived.ID != source.ID || archived.Status != meta.SourceStatusArchived || archived.Revision != 2 {
		t.Fatalf("local Source archive mismatch: %+v", archived)
	}
	// Root proof is required for restore too. The archive operation must not
	// revoke or delete the original local Root binding.
	requestWithHeaders(t, router, http.MethodPost, url+"/restore", ownerJWT, nil,
		http.StatusForbidden, map[string]string{"If-Match": `"2"`})
	var retained meta.LocalSourceBinding
	if err := db.Where("source_id = ? AND owner_id = ?", source.ID, owner.ID).Take(&retained).Error; err != nil {
		t.Fatalf("archive removed the local Root binding: %v", err)
	}
	if retained.DeviceID != device.ID || retained.RootID != rootID || retained.RootFingerprint != fingerprint {
		t.Fatalf("archive changed local Root identity: %+v", retained)
	}

	proof["If-Match"] = `"2"`
	restoredResponse := requestWithHeaders(t, router, http.MethodPost, url+"/restore", ownerJWT, nil,
		http.StatusOK, proof)
	var restored sourceDTO
	if err := json.Unmarshal(restoredResponse.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.ID != source.ID || restored.Status != meta.SourceStatusPaused || restored.Revision != 3 {
		t.Fatalf("local Source restore mismatch: %+v", restored)
	}
	if err := db.Where("source_id = ? AND owner_id = ?", source.ID, owner.ID).Take(&retained).Error; err != nil {
		t.Fatalf("restore removed the local Root binding: %v", err)
	}
}
