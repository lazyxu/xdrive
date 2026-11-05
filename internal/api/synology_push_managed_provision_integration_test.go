package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestCreateSynologyPushRequiresRegisteredDeviceAndProvisionsCanonicalTarget(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("synology-push-device-test", time.Hour)
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	deviceID := uuid.NewString()
	deviceToken := strings.Repeat("synology-device-token-", 3)
	device := meta.ClientDevice{
		ID: deviceID, OwnerID: owner.ID, Name: "DSM Test", Platform: "synology",
		CredentialHash: deviceCredentialDigest(deviceToken),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	body := strings.NewReader(`{"name":"NAS Photos","kind":"synology_photos","direction":"push","sync_mode":"backup","run_mode":"scan","target_node_id":0}`)
	headers := map[string]string{
		"X-XDrive-Device-ID":    deviceID,
		"X-XDrive-Device-Token": deviceToken,
	}
	response := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken, body,
		http.StatusCreated, headers)
	var created sourceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.DeviceID != deviceID || !created.TargetManaged || created.TargetNodeID == nil || created.Status != meta.SourceStatusPaused {
		t.Fatalf("Synology Push Source was not device-bound and paused: %+v", created)
	}

	var target meta.Node
	if err := db.First(&target, *created.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if target.ParentID == nil {
		t.Fatalf("managed target has no device group: %+v", target)
	}
	var group meta.Node
	if err := db.First(&group, *target.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if group.ParentID == nil {
		t.Fatalf("device group has no Push parent: %+v", group)
	}
	var pushRoot meta.Node
	if err := db.First(&pushRoot, *group.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if pushRoot.Name != "Push" || pushRoot.ParentID == nil {
		t.Fatalf("target is not under Push/: %+v", pushRoot)
	}
	var syncRoot meta.Node
	if err := db.First(&syncRoot, *pushRoot.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if syncRoot.Name != yikeTargetRootName || syncRoot.ParentID == nil || *syncRoot.ParentID != root.ID {
		t.Fatalf("target is outside the canonical sync root: %+v", syncRoot)
	}

	var stored meta.Source
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DeviceID == nil || *stored.DeviceID != deviceID || !stored.TargetManaged ||
		stored.TargetNodeID == nil || *stored.TargetNodeID != target.ID {
		t.Fatalf("persisted Source binding mismatch: %+v", stored)
	}

	// An owner JWT without the registered DSM device proof cannot create a
	// second Synology Push Source or choose an arbitrary cloud target.
	request(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(`{"name":"NAS Photos 2","kind":"synology_photos","direction":"push","target_node_id":0}`),
		http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(fmt.Sprintf(`{"name":"NAS Photos 3","kind":"synology_photos","direction":"push","target_node_id":%d}`, target.ID)),
		http.StatusBadRequest, headers)

	sourceURL := fmt.Sprintf("/api/v1/sources/%d", created.ID)
	rootID := uuid.NewString()
	rootFingerprint := strings.Repeat("a", 64)
	rootHeaders := map[string]string{
		"X-XDrive-Device-ID":          deviceID,
		"X-XDrive-Device-Token":       deviceToken,
		"If-Match":                    `"1"`,
	}
	requestWithHeaders(t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/sources/%d/synology-root", created.ID), ownerToken,
		strings.NewReader(fmt.Sprintf(`{"root_id":%q,"root_fingerprint":%q}`, rootID, rootFingerprint)),
		http.StatusCreated, rootHeaders)
	activationHeaders := map[string]string{
		"X-XDrive-Device-ID":                deviceID,
		"X-XDrive-Device-Token":             deviceToken,
		"X-XDrive-Synology-Source-ID":       fmt.Sprint(created.ID),
		"X-XDrive-Synology-Source-Revision": "2",
		"X-XDrive-Local-Root-ID":            rootID,
		"X-XDrive-Local-Root-Fingerprint":   rootFingerprint,
		"If-Match":                          `"2"`,
	}
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusOK, activationHeaders)
	requestWithHeaders(t, router, http.MethodPost, fmt.Sprintf("/api/v1/devices/%s/revoke", deviceID),
		ownerToken, nil, http.StatusNoContent, nil)
	var revokedSource meta.Source
	if err := db.First(&revokedSource, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revokedSource.Status != meta.SourceStatusPaused || revokedSource.Revision != 4 {
		t.Fatalf("revoking the DSM device did not pause its Source: %+v", revokedSource)
	}
	revokedHeaders := map[string]string{
		"X-XDrive-Device-ID":                deviceID,
		"X-XDrive-Device-Token":             deviceToken,
		"X-XDrive-Synology-Source-ID":       fmt.Sprint(created.ID),
		"X-XDrive-Synology-Source-Revision": "4",
		"X-XDrive-Local-Root-ID":            rootID,
		"X-XDrive-Local-Root-Fingerprint":   rootFingerprint,
		"If-Match":                          `"4"`,
	}
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerToken,
		strings.NewReader(`{"status":"active"}`), http.StatusForbidden, revokedHeaders)
}

func TestSynologyPushManagedTargetRejectsUnclaimedDeviceGroup(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "DSM Conflict", Platform: "synology",
		CredentialHash: deviceCredentialDigest(strings.Repeat("device-secret-", 4)),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	groupName, err := managedPushDeviceFolderName(device)
	if err != nil {
		t.Fatal(err)
	}
	syncRoot := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	pushRoot := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "Push")
	_ = createFilePropertiesDir(t, db, owner.ID, pushRoot.ID, groupName)
	source := meta.Source{
		OwnerID: owner.ID, Name: "Photos", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
		DeviceID: &device.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		_, err := createSynologyPushManagedTargetTx(context.Background(), tx, source, device)
		return err
	})
	if err == nil || !errors.Is(err, errSourceManagedDirectoryOccupied) {
		t.Fatalf("unclaimed same-name device group should be rejected, got %v", err)
	}
}
