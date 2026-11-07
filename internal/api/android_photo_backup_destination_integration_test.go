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

func TestAndroidPhotoDestinationIsOwnerDeviceBoundAndGrouped(t *testing.T) {
	db, server, owner, foreign, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.SyncRun{}, &meta.UploadSession{}, &meta.LocalSourceBinding{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("android-photo-device-source-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := strings.Repeat("android-source-device-token-", 2)
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Pixel 原件",
		Platform: "android", CredentialHash: deviceCredentialDigest(secret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	const endpoint = "/api/v1/android/photos/backup-destination"
	type response struct {
		Configured     bool   `json:"configured"`
		SourceID       uint64 `json:"source_id"`
		SourceRevision uint64 `json:"source_revision"`
		DeviceID       string `json:"device_id"`
		Name           string `json:"name"`
		SuggestedName  string `json:"suggested_name"`
		TargetNodeID   uint64 `json:"target_node_id"`
		TargetPath     string `json:"target_path"`
	}
	call := func(method, jwt, body string, code int, proof map[string]string) response {
		t.Helper()
		got := requestWithHeaders(t, router, method, endpoint, jwt,
			strings.NewReader(body), code, proof)
		var out response
		if code == http.StatusCreated || code == http.StatusOK {
			if err := json.Unmarshal(got.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if got.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("Android device Source identity response may not be cached")
			}
		}
		return out
	}

	call(http.MethodGet, token, "", http.StatusForbidden, nil)
	call(http.MethodPut, foreignToken, `{"name":"Foreign"}`, http.StatusForbidden, headers)
	call(http.MethodGet, token, "", http.StatusForbidden, map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": "wrong",
	})
	// Same Owner is not sufficient to adopt another handset's Source.
	otherSecret := strings.Repeat("second-native-android-token-", 2)
	otherDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Other Pixel",
		Platform: "android", CredentialHash: deviceCredentialDigest(otherSecret),
	}
	if err := db.Create(&otherDevice).Error; err != nil {
		t.Fatal(err)
	}
	otherHeaders := map[string]string{
		"X-XDrive-Device-ID": otherDevice.ID, "X-XDrive-Device-Token": otherSecret,
	}
	unconfigured := call(http.MethodGet, token, "", http.StatusOK, headers)
	if unconfigured.Configured || unconfigured.DeviceID != device.ID ||
		unconfigured.SuggestedName != device.Name {
		t.Fatalf("unexpected Device-bound suggestion: %+v", unconfigured)
	}
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"Forged Photos","kind":"android_photos","direction":"push"}`),
		http.StatusForbidden, headers)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"Forged Local","kind":"local_folder","direction":"push"}`),
		http.StatusForbidden, headers)
	for _, invalid := range []string{
		`{}`, `{"name":""}`, `{"name":"a/b"}`,
		`{"name":"CON"}`, `{"name":"x","target_node_id":123}`,
		`{"name":"x"} {"name":"y"}`,
	} {
		call(http.MethodPut, token, invalid, http.StatusBadRequest, headers)
	}
	created := call(http.MethodPut, token, `{"name":"Pixel 原件"}`, http.StatusCreated, headers)
	if !created.Configured || created.SourceID == 0 || created.SourceRevision != 1 ||
		created.DeviceID != device.ID || created.TargetNodeID == 0 ||
		created.TargetNodeID == root.ID || created.TargetPath != "同步文件夹/Push/"+managedPushDeviceFolderName(device)+"/Pixel 原件" {
		t.Fatalf("unverified Android Source/Target: %+v", created)
	}
	// Owner JWT is only a readable identity. Generic Source PATCH/DELETE/
	// Trigger must not mutate or execute a native Source without native proof.
	sourceURL := fmt.Sprintf("/api/v1/sources/%d", created.SourceID)
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, token,
		strings.NewReader(`{"name":"Owner spoof"}`), http.StatusForbidden,
		map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete, sourceURL, token,
		nil, http.StatusForbidden, map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/trigger", token,
		nil, http.StatusForbidden, nil)
	var source meta.Source
	if err := db.First(&source, created.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if source.Name != "Pixel 原件" || source.Revision != 1 {
		t.Fatalf("Owner-only generic mutation changed native Source: %+v", source)
	}
	boundDeviceID, bound := meta.SourceDeviceID(source)
	if !bound || boundDeviceID != device.ID || source.Kind != meta.SourceKindAndroidPhotos ||
		!source.TargetManaged || source.TargetNodeID == nil ||
		*source.TargetNodeID != created.TargetNodeID || source.Status != meta.SourceStatusPaused {
		t.Fatalf("Android Source.DeviceID / Target binding invalid: %+v", source)
	}
	if second := call(http.MethodGet, token, "", http.StatusOK, otherHeaders); second.Configured || second.DeviceID != otherDevice.ID {
		t.Fatalf("another Android Device adopted the first Source: %+v", second)
	}
	call(http.MethodPut, token, `{"name":"Pixel 原件"}`, http.StatusConflict, otherHeaders)
	for _, again := range []response{
		call(http.MethodGet, token, "", http.StatusOK, headers),
		call(http.MethodPut, token, `{"name":"Pixel 原件"}`, http.StatusOK, headers),
	} {
		if again.SourceID != created.SourceID || again.TargetNodeID != created.TargetNodeID ||
			again.SourceRevision != 1 {
			t.Fatalf("idempotent Android Source read changed identity: %+v", again)
		}
	}
	// The same Device proof cannot impersonate a Desktop executor.
	requestWithHeaders(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/local-rules", source.ID), token,
		strings.NewReader(""), http.StatusForbidden, headers)
	// An active upload fences Node/Source rename even if the Device is valid.
	targetID := created.TargetNodeID
	pending := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, ParentID: &targetID,
		Name: "original.jpg", RequestedName: "original.jpg",
		Status:   meta.UploadStatusActive,
		SourceID: source.ID, SourceRevision: source.Revision,
		SourceDeviceID: device.ID, SourceTargetID: targetID,
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}
	call(http.MethodPut, token, `{"name":"Android 改名"}`, http.StatusConflict, headers)
	if err := db.Delete(&pending).Error; err != nil {
		t.Fatal(err)
	}
	renamed := call(http.MethodPut, token, `{"name":"Android 改名"}`, http.StatusOK, headers)
	if renamed.SourceID != created.SourceID || renamed.TargetNodeID != created.TargetNodeID ||
		renamed.SourceRevision != 2 || renamed.TargetPath != "同步文件夹/Push/"+managedPushDeviceFolderName(device)+"/Android 改名" {
		t.Fatalf("rename broke identity or wrong target path: %+v", renamed)
	}
	// Revocation can never silently select another Source or continue writes.
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/devices/"+device.ID+"/revoke", token, strings.NewReader(""),
		http.StatusNoContent, nil)
	call(http.MethodGet, token, "", http.StatusForbidden, headers)
	call(http.MethodPut, token, `{"name":"Replace"}`, http.StatusForbidden, headers)
	var count int64
	if err := db.Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ?", owner.ID, meta.SourceKindAndroidPhotos).
		Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("Android device created %d managed Sources: %v", count, err)
	}
}
