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

func TestLocalDraftListIsOwningDeviceOnlyAndCursorPaged(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SyncRun{}, &meta.SourceRunFailure{}, &meta.SourceCollection{},
		&meta.SourceCredential{}, &meta.SourceConnectorConfig{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-draft-list-test", time.Hour)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	tokenA := "local-draft-list-A-credential-must-be-long-00001"
	tokenB := "local-draft-list-B-credential-must-be-long-00002"
	deviceA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "A", Platform: "windows",
		CredentialHash: deviceCredentialDigest(tokenA), CreatedAt: now, UpdatedAt: now,
	}
	deviceB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "B", Platform: "linux",
		CredentialHash: deviceCredentialDigest(tokenB), CreatedAt: now, UpdatedAt: now,
	}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Backup")
	created := func(name string, creator *string) meta.Source {
		t.Helper()
		row := meta.Source{
			OwnerID: owner.ID, Name: name, Kind: meta.SourceKindLocalFolder,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
			ScheduleType: "manual", Revision: 1,
			TargetNodeID: &target.ID, LocalCreatorDeviceID: creator,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	aID, bID := deviceA.ID, deviceB.ID
	a1 := created("a1", &aID)
	a2 := created("a2", &aID)
	a3 := created("a3", &aID)
	b := created("b-private", &bID)
	legacy := created("legacy-unclaimed", nil)
	bound := created("A-bound", &aID)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: bound.ID, OwnerID: owner.ID, DeviceID: deviceA.ID,
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	history := created("A-history", &aID)
	if err := db.Create(&meta.SyncRun{ID: uuid.NewString(), SourceID: history.ID,
		Status: meta.SyncRunStatusCompleted, Trigger: meta.SyncRunTriggerManual,
		StartedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	revised := created("A-revision", &aID)
	if err := db.Model(&meta.Source{}).Where("id = ?", revised.ID).Update("revision", 3).Error; err != nil {
		t.Fatal(err)
	}

	uri := "/api/v1/device-backups/local-drafts"
	hdrA := map[string]string{"X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": tokenA}
	hdrB := map[string]string{"X-XDrive-Device-ID": deviceB.ID, "X-XDrive-Device-Token": tokenB}
	request(t, router, http.MethodGet, uri, ownerJWT, nil, http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodGet, uri, ownerJWT, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": tokenB})
	requestWithHeaders(t, router, http.MethodGet, uri, otherJWT, nil, http.StatusForbidden, hdrA)
	requestWithHeaders(t, router, http.MethodGet, uri+"?limit=0", ownerJWT, nil, http.StatusBadRequest, hdrA)
	requestWithHeaders(t, router, http.MethodGet, uri+"?after_id=invalid", ownerJWT, nil, http.StatusBadRequest, hdrA)

	type page struct {
		Items       []localSourceDraftReadDTO `json:"items"`
		HasMore     bool                      `json:"has_more"`
		NextAfterID uint64                    `json:"next_after_id"`
	}
	fetchPage := func(url string, headers map[string]string) page {
		t.Helper()
		response := requestWithHeaders(t, router, http.MethodGet, url, ownerJWT, nil, http.StatusOK, headers)
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("local draft response must forbid browser cache")
		}
		for _, restricted := range []string{"root_id", "root_fingerprint", "local_creator_device_id",
			"ignore_rules", "checkpoint", "last_error", "credential_hash"} {
			if strings.Contains(response.Body.String(), restricted) {
				t.Fatalf("local draft listing disclosed %q", restricted)
			}
		}
		if headers["X-XDrive-Device-ID"] == deviceA.ID && strings.Contains(response.Body.String(), "b-private") {
			t.Fatal("device A saw device B's draft")
		}
		if headers["X-XDrive-Device-ID"] == deviceB.ID && strings.Contains(response.Body.String(), "\"name\":\"a1\"") {
			t.Fatal("device B saw device A's draft")
		}
		var result page
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	p1 := fetchPage(uri+"?limit=2", hdrA)
	if len(p1.Items) != 2 || p1.Items[0].SourceID != a1.ID || p1.Items[1].SourceID != a2.ID ||
		!p1.HasMore || p1.NextAfterID != a2.ID {
		t.Fatalf("unexpected first local draft page: %+v", p1)
	}
	p2 := fetchPage(fmt.Sprintf("%s?limit=2&after_id=%d", uri, p1.NextAfterID), hdrA)
	if len(p2.Items) != 1 || p2.Items[0].SourceID != a3.ID ||
		p2.HasMore || p2.NextAfterID != 0 {
		t.Fatalf("unexpected next draft page: %+v", p2)
	}
	bOnly := fetchPage(uri+"?limit=5", hdrB)
	if len(bOnly.Items) != 1 || bOnly.Items[0].SourceID != b.ID {
		t.Fatalf("same owner device B must see only its own draft: %+v", bOnly)
	}
	_ = legacy
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, uri, ownerJWT, nil, http.StatusForbidden, hdrA)
}
