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

func TestBoundLocalSourceWritesRequireOwningDeviceAndRoot(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("bound-local-source-mutation-proof", time.Hour)
	server.RefreshTTL = 24 * time.Hour
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
	deviceASecret := "bound-mutation-device-A-long-private-credential-001"
	deviceBSecret := "bound-mutation-device-B-long-private-credential-002"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Desktop A", Platform: "windows", CredentialHash: deviceCredentialDigest(deviceASecret), CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Desktop B", Platform: "linux", CredentialHash: deviceCredentialDigest(deviceBSecret), CreatedAt: now, UpdatedAt: now}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	targetID := root.ID
	makeBound := func(name string) meta.Source {
		t.Helper()
		source := meta.Source{OwnerID: owner.ID, Name: name, Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &targetID}
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		binding := meta.LocalSourceBinding{SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceA.ID, RootID: rootID, RootFingerprint: fingerprint, CreatedAt: now, UpdatedAt: now}
		if err := db.Create(&binding).Error; err != nil {
			t.Fatal(err)
		}
		return source
	}
	sourceA := makeBound("A root")
	sourceB := makeBound("A spare root")
	sourceC := makeBound("A revoke root")
	sourceURL := fmt.Sprintf("/api/v1/sources/%d", sourceA.ID)
	own := map[string]string{
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           deviceASecret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
		"If-Match":                        "\"1\"",
	}
	copyHeaders := func() map[string]string {
		headers := make(map[string]string, len(own))
		for key, value := range own {
			headers[key] = value
		}
		return headers
	}
	operations := []struct {
		method string
		suffix string
		body   string
	}{
		{http.MethodPatch, "", "{\"name\":\"unauthorized change\"}"},
		{http.MethodDelete, "", ""},
		{http.MethodPost, "/trigger", ""},
		{http.MethodDelete, "/local-binding", ""},
	}
	for _, op := range operations {
		t.Run(op.method+op.suffix, func(t *testing.T) {
			var payload = func() *strings.Reader { return strings.NewReader(op.body) }
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, map[string]string{"If-Match": "\"1\""})
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, otherJWT, payload(), http.StatusNotFound, own)
			foreign := copyHeaders()
			foreign["X-XDrive-Device-ID"] = deviceB.ID
			foreign["X-XDrive-Device-Token"] = deviceBSecret
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, foreign)
			for _, replace := range []struct{ header, value string }{
				{"X-XDrive-Device-Token", "invalid credential"},
				{"X-XDrive-Local-Root-ID", uuid.NewString()},
				{"X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)},
			} {
				headers := copyHeaders()
				headers[replace.header] = replace.value
				requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, headers)
			}
		})
	}
	var unchanged meta.Source
	if err := db.Where("id = ?", sourceA.ID).First(&unchanged).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != 1 || unchanged.Name != "A root" || unchanged.RunRequestedAt != nil {
		t.Fatalf("rejected writes changed local Source: %+v", unchanged)
	}
	validChange := requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerJWT, strings.NewReader("{\"name\":\"A renamed root\"}"), http.StatusOK, own)
	var changed sourceDTO
	if err := json.Unmarshal(validChange.Body.Bytes(), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Name != "A renamed root" || changed.Revision != 2 {
		t.Fatalf("owning Desktop could not update its bound local Source: %+v", changed)
	}
	fresh := copyHeaders()
	fresh["If-Match"] = "\"2\""
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerJWT, strings.NewReader("{\"status\":\"active\"}"), http.StatusConflict, fresh)
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/trigger", ownerJWT, nil, http.StatusConflict, fresh)
	if err := db.Model(&meta.Source{}).Where("id = ?", sourceA.ID).Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/trigger", ownerJWT, nil, http.StatusConflict, fresh)
	if err := db.Model(&meta.Source{}).Where("id = ?", sourceA.ID).Update("status", meta.SourceStatusPaused).Error; err != nil {
		t.Fatal(err)
	}
	// The owning Desktop can remove an already-bound Source directly.
	requestWithHeaders(t, router, http.MethodDelete, sourceURL, ownerJWT, nil, http.StatusNoContent, fresh)

	spareURL := fmt.Sprintf("/api/v1/sources/%d", sourceB.ID)
	requestWithHeaders(t, router, http.MethodDelete, spareURL+"/local-binding", ownerJWT, nil, http.StatusNoContent, own)
	request(t, router, http.MethodGet, spareURL+"/local-binding", ownerJWT, nil, http.StatusNotFound)
	// Without a surviving device-ownership claim, unbound legacy Sources
	// intentionally fail closed rather than becoming remotely deletable.
	requestWithHeaders(t, router, http.MethodDelete, spareURL, ownerJWT, nil, http.StatusForbidden, fresh)

	revokeAt := now.Add(time.Second)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).Update("revoked_at", revokeAt).Error; err != nil {
		t.Fatal(err)
	}
	revokedURL := fmt.Sprintf("/api/v1/sources/%d", sourceC.ID)
	requestWithHeaders(t, router, http.MethodPatch, revokedURL, ownerJWT, strings.NewReader("{\"name\":\"revoked\"}"), http.StatusForbidden, own)
	requestWithHeaders(t, router, http.MethodDelete, revokedURL+"/local-binding", ownerJWT, nil, http.StatusForbidden, own)
	var stillBound meta.LocalSourceBinding
	if err := db.Where("source_id = ?", sourceC.ID).First(&stillBound).Error; err != nil {
		t.Fatal(err)
	}
}

func TestNonLocalSourceWritesPreserveOwnerJWTCompatibility(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("non-local-pull-mutation-regression", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	targetID := root.ID
	source := meta.Source{OwnerID: owner.ID, Name: "Pull owner JWT", Kind: "yike_photos", Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1, TargetNodeID: &targetID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	requestWithHeaders(t, router, http.MethodPatch, url, ownerJWT, strings.NewReader("{\"name\":\"Pull updated\"}"), http.StatusOK, map[string]string{"If-Match": "\"1\""})
	request(t, router, http.MethodPost, url+"/trigger", ownerJWT, nil, http.StatusAccepted)
	requestWithHeaders(t, router, http.MethodDelete, url, ownerJWT, nil, http.StatusNoContent, map[string]string{"If-Match": "\"2\""})
}
