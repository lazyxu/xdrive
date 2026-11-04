package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This is the actual authenticated HTTP + PostgreSQL Source/Node path, not a
// filename-only policy test. The native iOS credential remains identity-only
// on Desktop local_folder Source/Root APIs.
func TestIOSPhotoManagedDestinationHTTPAndFiveBRename(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.Share{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-photo-managed-destination", time.Hour)
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
	secret := "ios-photo-destination-verification-cred-001"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "我的 iPhone",
		Platform: "ios", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	const endpoint = "/api/v1/ios/photos/backup-destination"
	type response struct {
		Configured    bool   `json:"configured"`
		SourceID      uint64 `json:"source_id"`
		DeviceID      string `json:"device_id"`
		Name          string `json:"name"`
		SuggestedName string `json:"suggested_name"`
		TargetNodeID  uint64 `json:"target_node_id"`
		TargetPath    string `json:"target_path"`
	}
	read := func(method, token, body string, expected int, h map[string]string) response {
		t.Helper()
		var r *strings.Reader
		if body != "" {
			r = strings.NewReader(body)
		} else {
			r = strings.NewReader("")
		}
		got := requestWithHeaders(t, router, method, endpoint, token, r, expected, h)
		var decoded response
		if expected == http.StatusOK || expected == http.StatusCreated {
			if err := json.Unmarshal(got.Body.Bytes(), &decoded); err != nil {
				t.Fatalf("invalid native managed destination response: %v", err)
			}
		}
		return decoded
	}
	// A bearer alone is not a physical iPhone. A valid device credential
	// paired with the wrong Owner remains forbidden.
	read(http.MethodGet, ownerToken, "", http.StatusForbidden, nil)
	read(http.MethodPut, otherToken, `{"name":"跨用户"}`, http.StatusForbidden, headers)
	current := read(http.MethodGet, ownerToken, "", http.StatusOK, headers)
	if current.Configured || current.DeviceID != device.ID || current.SuggestedName != device.Name {
		t.Fatalf("unconfigured destination must only suggest the registered device name: %+v", current)
	}
	// Generic Source POST cannot turn identity-only iOS proof into a
	// Desktop local_folder root or spoof the specialized ios_photos kind.
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(`{"name":"禁止仿造","kind":"ios_photos","direction":"push"}`),
		http.StatusForbidden, headers)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(`{"name":"不能执行桌面 Push","kind":"local_folder","direction":"push"}`),
		http.StatusForbidden, headers)
	for _, bad := range []string{`{"name":""}`, `{"name":"a/b"}`, `{"name":"CON"}`,
		`{"name":"无效路径/照片"}`, `{"name":"."}`, `{"name":"x","target_node_id":42}`,
	} {
		read(http.MethodPut, ownerToken, bad, http.StatusBadRequest, headers)
	}
	result := read(http.MethodPut, ownerToken, `{"name":"我的照片"}`, http.StatusCreated, headers)
	if !result.Configured || result.SourceID == 0 ||
		result.TargetNodeID == 0 || result.TargetNodeID == root.ID ||
		result.DeviceID != device.ID || result.Name != "我的照片" {
		t.Fatalf("server did not create an exact managed destination: %+v", result)
	}
	expectedGroup, err := managedPushDeviceFolderName(device)
	if err != nil {
		t.Fatal(err)
	}
	expectedPath := "同步文件夹/设备备份/" + expectedGroup + "/我的照片"
	if result.TargetPath != expectedPath {
		t.Fatalf("server-managed target path mismatch: got %q want %q", result.TargetPath, expectedPath)
	}
	var stored meta.Source
	if err := db.First(&stored, result.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if !stored.TargetManaged || !iosPhotoDestinationSource(stored) ||
		stored.LocalCreatorDeviceID == nil || *stored.LocalCreatorDeviceID != device.ID ||
		stored.TargetNodeID == nil || *stored.TargetNodeID != result.TargetNodeID {
		t.Fatalf("Source must own exact managed Node: %+v", stored)
	}
	// Current read and idempotent repeated PUT never allocate a second
	// Source or Node when the exact one already exists.
	readBack := read(http.MethodGet, ownerToken, "", http.StatusOK, headers)
	same := read(http.MethodPut, ownerToken, `{"name":"我的照片"}`, http.StatusOK, headers)
	if readBack.TargetNodeID != result.TargetNodeID ||
		same.SourceID != result.SourceID || same.TargetNodeID != result.TargetNodeID {
		t.Fatal("repeat GET/PUT did not preserve Source/Node identity")
	}
	// Preserve direct read-only Shares across 5B rename. The Node ID must
	// remain the same and no other Owner or unverified folder can be claimed.
	share := meta.Share{OwnerID: owner.ID, NodeID: result.TargetNodeID,
		TokenHash: strings.Repeat("d", 64), Access: "read_only"}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	renamed := read(http.MethodPut, ownerToken, `{"name":"新版照片"}`, http.StatusOK, headers)
	if renamed.TargetNodeID != result.TargetNodeID || renamed.SourceID != result.SourceID ||
		renamed.TargetPath != "同步文件夹/设备备份/"+expectedGroup+"/新版照片" {
		t.Fatalf("5B rename replaced Source/Node IDs or used a fake path: %+v", renamed)
	}
	var node meta.Node
	if err := db.First(&node, renamed.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if node.Name != "新版照片" || node.Type != meta.NodeTypeDir {
		t.Fatalf("real managed folder was not atomically renamed: %+v", node)
	}
	if err := db.First(&stored, stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Name != "新版照片" {
		t.Fatalf("Source 5B name diverged: %+v", stored)
	}
	var intact meta.Share
	if err := db.First(&intact, share.ID).Error; err != nil || intact.NodeID != node.ID {
		t.Fatalf("5B rename modified direct Share: share=%+v err=%v", intact, err)
	}
	// Revocation fences subsequent GET/PUT. It cannot create a second
	// Source, replace another device group, or remove historical bytes.
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	read(http.MethodGet, ownerToken, "", http.StatusForbidden, headers)
	read(http.MethodPut, ownerToken, `{"name":"恶意重绑"}`, http.StatusForbidden, headers)
	var count int64
	if err := db.Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ?", owner.ID, meta.SourceKindIOSPhotos).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("repeated/denied requests produced %d Sources", count)
	}
}
