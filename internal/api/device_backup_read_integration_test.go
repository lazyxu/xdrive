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

func TestDeviceBackupReadOnlyOverviewAndHistoryRedactPrivatePaths(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("backup-read-projection-test-secret", time.Hour)
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
	now := time.Now().UTC()
	secretPath := `D:\very-private\family\IMG_9999.JPG`
	deviceToken := "super-secret-local-device-credential-test-xxxx"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "My own Windows Desktop",
		Platform: "windows", ClientVersion: "0.5",
		CredentialHash: deviceCredentialDigest(deviceToken),
		LastSeenAt:     &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Cloud Backup")
	targetID := target.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "My Photos", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &targetID,
		IgnoreRules: secretPath, Checkpoint: "private-checkpoint-secret",
		LastError: "Cannot read " + secretPath,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	fingerprint := strings.Repeat("e", 64)
	binding := meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: uuid.NewString(), RootFingerprint: fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	runs := []meta.SyncRun{
		{ID: uuid.NewString(), SourceID: source.ID, RunNumber: 1,
			Status: meta.SyncRunStatusFailed, Mode: meta.SourceRunModeSync,
			Trigger: meta.SyncRunTriggerManual, StartedAt: now.Add(-time.Hour),
			ScannedItems: 3, FailedItems: 1,
			ActiveTransferPath: secretPath, IgnoreRules: secretPath,
			Error:            "Failure in " + secretPath,
			CheckpointBefore: "private-checkpoint-secret"},
		{ID: uuid.NewString(), SourceID: source.ID, RunNumber: 2,
			Status: meta.SyncRunStatusRunning, Mode: meta.SourceRunModeSync,
			Trigger: meta.SyncRunTriggerManual, StartedAt: now,
			ScannedItems: 5, TransferredBytes: 1234,
			ActiveTransferBytes: 250, ActiveTransferTotal: 1000,
			ActiveTransferPath: secretPath, Error: secretPath},
	}
	for _, run := range runs {
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	// A NAS Source is preserved by existing systems, not projected as a new
	// enrolled local device by the read-only device backup endpoint.
	nas := meta.Source{
		OwnerID: owner.ID, Name: "Old NAS Photos", Kind: "synology_photos",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
	}
	if err := db.Create(&nas).Error; err != nil {
		t.Fatal(err)
	}
	overview := request(t, router, http.MethodGet, "/api/v1/device-backups", ownerToken, nil, http.StatusOK)
	payload := overview.Body.String()
	for _, forbidden := range []string{secretPath, deviceToken, fingerprint, "private-checkpoint-secret", "Old NAS Photos", "root_fingerprint", "ignore_rules", "active_transfer_path", "last_error"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("device backup overview leaked private data %q: %s", forbidden, payload)
		}
	}
	if overview.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("backup state must not enter browser caches: %q", overview.Header().Get("Cache-Control"))
	}
	var body struct {
		Devices []deviceBackupReadDTO `json:"devices"`
		HasMore bool                  `json:"has_more"`
	}
	if err := json.Unmarshal(overview.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Devices) != 1 || len(body.Devices[0].Folders) != 1 ||
		body.Devices[0].ConnectionState != "unknown" ||
		body.Devices[0].Folders[0].SourceID != source.ID ||
		body.Devices[0].Folders[0].Name != source.Name ||
		body.Devices[0].Folders[0].LatestRun == nil ||
		body.Devices[0].Folders[0].LatestRun.TransferredBytes != 1234 {
		t.Fatalf("incorrect owner read-only device/folder projection: %+v", body.Devices)
	}
	if !strings.Contains(body.Devices[0].Folders[0].TargetPath, "Cloud Backup") {
		t.Fatalf("authoritative cloud target path missing: %+v", body.Devices[0].Folders[0])
	}
	otherOverview := request(t, router, http.MethodGet, "/api/v1/device-backups", otherToken, nil, http.StatusOK)
	if strings.Contains(otherOverview.Body.String(), device.ID) ||
		strings.Contains(otherOverview.Body.String(), source.Name) {
		t.Fatal("other owner observed device backup")
	}
	historyURL := fmt.Sprintf("/api/v1/device-backups/%d/runs?limit=1&offset=0", source.ID)
	history := request(t, router, http.MethodGet, historyURL, ownerToken, nil, http.StatusOK)
	if !strings.Contains(history.Body.String(), `"has_more":true`) ||
		!strings.Contains(history.Body.String(), `"transferred_bytes":1234`) {
		t.Fatalf("latest run/has_more incorrect: %s", history.Body.String())
	}
	for _, forbidden := range []string{secretPath, "private-checkpoint-secret", "active_transfer_path", "ignore_rules", `"error"`} {
		if strings.Contains(history.Body.String(), forbidden) {
			t.Fatalf("history leaked %q: %s", forbidden, history.Body.String())
		}
	}
	page2 := fmt.Sprintf("/api/v1/device-backups/%d/runs?limit=1&offset=1", source.ID)
	older := request(t, router, http.MethodGet, page2, ownerToken, nil, http.StatusOK)
	if !strings.Contains(older.Body.String(), `"has_more":false`) {
		t.Fatalf("history pagination not bounded: %s", older.Body.String())
	}
	request(t, router, http.MethodGet, historyURL, otherToken, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/device-backups/%d/runs", nas.ID), ownerToken, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/device-backups/%d/runs?limit=10000", source.ID), ownerToken, nil, http.StatusBadRequest)
}
