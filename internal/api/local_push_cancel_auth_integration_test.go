package api

import (
	"context"
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

func TestLocalFolderCancelRequiresOwningDeviceAndCurrentRootProof(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-cancel-own-device-security-test", time.Hour)
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
	secret := "device-A-enrollment-secret-safely-stored-on-owning-host-123"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owner Desktop A",
		Platform: "windows", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	targetID := root.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "Local Push Cancel Fence", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
	}
	// Synthetic active rows isolate the cancellation authorization boundary;
	// public local_folder activation/BeginSourceRun remain hard-denied.
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
	makeRun := func(number int64, revision uint64) meta.SyncRun {
		t.Helper()
		run := meta.SyncRun{
			ID: uuid.NewString(), SourceID: source.ID, RunNumber: number,
			SourceRevision: revision, SyncMode: meta.SourceSyncModeBackup,
			Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
			Status: meta.SyncRunStatusRunning, StartedAt: now,
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		return run
	}
	first := makeRun(1, 1)
	url := fmt.Sprintf("/api/v1/sources/%d/runs/%s/cancel", source.ID, first.ID)
	valid := map[string]string{
		"X-XDrive-Device-ID":              device.ID,
		"X-XDrive-Device-Token":           secret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	request(t, router, http.MethodPost, url, ownerToken, nil, http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, url, otherToken, nil, http.StatusNotFound, valid)
	for _, mutate := range []struct {
		name, header, value string
	}{
		{"fake-device", "X-XDrive-Device-ID", uuid.NewString()},
		{"wrong-token", "X-XDrive-Device-Token", "attacker-token"},
		{"wrong-root", "X-XDrive-Local-Root-ID", uuid.NewString()},
		{"wrong-fingerprint", "X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)},
		{"missing-token", "X-XDrive-Device-Token", ""},
	} {
		headers := make(map[string]string, len(valid))
		for k, v := range valid {
			headers[k] = v
		}
		headers[mutate.header] = mutate.value
		requestWithHeaders(t, router, http.MethodPost, url, ownerToken, nil, http.StatusForbidden, headers)
		var persisted meta.SyncRun
		if err := db.First(&persisted, "id = ?", first.ID).Error; err != nil {
			t.Fatal(err)
		}
		if persisted.CancelRequestedAt != nil {
			t.Fatalf("%s changed cancel_requested_at", mutate.name)
		}
	}
	requestWithHeaders(t, router, http.MethodPost, url, ownerToken, nil, http.StatusAccepted, valid)
	requestWithHeaders(t, router, http.MethodPost, url, ownerToken, nil, http.StatusOK, valid)
	var persisted meta.SyncRun
	if err := db.First(&persisted, "id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.CancelRequestedAt == nil {
		t.Fatal("valid owning device proof did not commit cancellation")
	}
	if _, _, err := server.requestSourceRunCancel(context.Background(), owner.ID, source.ID, first.ID); err != errLocalSourceExecutorTransactionUnauthorized {
		t.Fatalf("internal unguarded local cancel must fail closed, got %v", err)
	}

	revokedRun := makeRun(2, 1)
	revokedAt := now.Add(time.Second)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", revokedAt).Error; err != nil {
		t.Fatal(err)
	}
	revokedURL := fmt.Sprintf("/api/v1/sources/%d/runs/%s/cancel", source.ID, revokedRun.ID)
	requestWithHeaders(t, router, http.MethodPost, revokedURL, ownerToken, nil, http.StatusForbidden, valid)
	var revokedPersisted meta.SyncRun
	if err := db.First(&revokedPersisted, "id = ?", revokedRun.ID).Error; err != nil {
		t.Fatal(err)
	}
	if revokedPersisted.CancelRequestedAt != nil {
		t.Fatal("revoked device managed to cancel local run")
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	staleRun := makeRun(3, 1)
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
		Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	staleURL := fmt.Sprintf("/api/v1/sources/%d/runs/%s/cancel", source.ID, staleRun.ID)
	requestWithHeaders(t, router, http.MethodPost, staleURL, ownerToken, nil, http.StatusForbidden, valid)
	var stale meta.SyncRun
	if err := db.First(&stale, "id = ?", staleRun.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stale.CancelRequestedAt != nil {
		t.Fatal("old Source revision managed to cancel local run")
	}
}

func TestNonLocalSourceRunCancellationKeepsOwnerJWTBehavior(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("pull-and-legacy-nas-cancel-regression-test", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for i, row := range []struct{ kind, direction string }{
		{"yike_photos", meta.SourceDirectionPull},
		{"synology_photos", meta.SourceDirectionPush}, // legacy NAS compatibility
	} {
		targetID := root.ID
		src := meta.Source{
			OwnerID: owner.ID, Name: fmt.Sprintf("Nonlocal cancellation %d", i),
			Kind: row.kind, Direction: row.direction,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
			Status: meta.SourceStatusActive, Revision: 1, TargetNodeID: &targetID,
		}
		if err := db.Create(&src).Error; err != nil {
			t.Fatal(err)
		}
		run := meta.SyncRun{
			ID: uuid.NewString(), SourceID: src.ID, RunNumber: 1,
			SourceRevision: 1, SyncMode: meta.SourceSyncModeBackup,
			Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
			Status: meta.SyncRunStatusRunning, StartedAt: now,
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		url := fmt.Sprintf("/api/v1/sources/%d/runs/%s/cancel", src.ID, run.ID)
		request(t, router, http.MethodPost, url, token, nil, http.StatusAccepted)
		var saved meta.SyncRun
		if err := db.Where("id = ?", run.ID).First(&saved).Error; err != nil {
			t.Fatal(err)
		}
		if saved.CancelRequestedAt == nil {
			t.Fatalf("nonlocal kind=%s direction=%s cancellation regressed", row.kind, row.direction)
		}
	}
}
