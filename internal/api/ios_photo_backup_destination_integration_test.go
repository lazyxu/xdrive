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
	expectedPath := "同步文件夹/Push/" + expectedGroup + "/我的照片"
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
		renamed.TargetPath != "同步文件夹/Push/"+expectedGroup+"/新版照片" {
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

func TestIOSPhotoSourceRunUsesSharedHistoryAndRequiresBoundDevice(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.Share{}, &meta.SyncRun{},
		&meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-photo-source-run-history", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secret := "ios-photo-source-run-device-credential-0001"
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
	destination := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", token,
		strings.NewReader(`{"name":"iPhone 原件备份"}`),
		http.StatusCreated, headers)
	var target struct {
		SourceID uint64 `json:"source_id"`
	}
	if err := json.Unmarshal(destination.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.SourceID == 0 {
		t.Fatal("server did not provision an iOS Photo Source")
	}

	runID := uuid.NewString()
	runPath := fmt.Sprintf("/api/v1/sources/%d/runs", target.SourceID)
	beginBody := fmt.Sprintf(`{"run_id":%q,"trigger":"manual"}`, runID)
	// An Owner JWT alone cannot impersonate the iPhone Source executor.
	requestWithHeaders(t, router, http.MethodPost, runPath, token,
		strings.NewReader(beginBody), http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodPost, runPath, token,
		strings.NewReader(beginBody), http.StatusCreated, headers)

	summary := `{
		"scanned_items":4,"scanned_bytes":0,
		"new_items":2,"new_bytes":0,
		"unchanged_items":2,"unchanged_bytes":0,
		"failed_items":0
	}`
	progressPath := runPath + "/" + runID + "/progress"
	requestWithHeaders(t, router, http.MethodPost, progressPath, token,
		strings.NewReader(`{"summary":`+summary+`}`),
		http.StatusNoContent, headers)

	readRun := func() struct {
		Status           string `json:"status"`
		ScannedItems     int64  `json:"scanned_items"`
		NewItems         int64  `json:"new_items"`
		UnchangedItems   int64  `json:"unchanged_items"`
		SyncedFileItems  int64  `json:"synced_file_items"`
		TransferredItems int64  `json:"transferred_items"`
		FailedItems      int64  `json:"failed_items"`
	} {
		t.Helper()
		got := requestWithHeaders(t, router, http.MethodGet,
			runPath+"/"+runID, token, strings.NewReader(""),
			http.StatusOK, nil)
		var decoded struct {
			Status           string `json:"status"`
			ScannedItems     int64  `json:"scanned_items"`
			NewItems         int64  `json:"new_items"`
			UnchangedItems   int64  `json:"unchanged_items"`
			SyncedFileItems  int64  `json:"synced_file_items"`
			TransferredItems int64  `json:"transferred_items"`
			FailedItems      int64  `json:"failed_items"`
		}
		if err := json.Unmarshal(got.Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded
	}
	inProgress := readRun()
	if inProgress.Status != meta.SyncRunStatusRunning ||
		inProgress.ScannedItems != 4 || inProgress.NewItems != 2 ||
		inProgress.UnchangedItems != 2 || inProgress.SyncedFileItems != 4 ||
		inProgress.TransferredItems != 2 {
		t.Fatalf("shared SourceRun progress was not persisted: %+v", inProgress)
	}

	finishPath := runPath + "/" + runID + "/finish"
	finishBody := fmt.Sprintf(`{"status":"completed","complete_inventory":false,"summary":%s}`, summary)
	requestWithHeaders(t, router, http.MethodPost, finishPath, token,
		strings.NewReader(finishBody), http.StatusOK, headers)
	finished := readRun()
	if finished.Status != meta.SyncRunStatusCompleted ||
		finished.ScannedItems != 4 || finished.NewItems != 2 ||
		finished.UnchangedItems != 2 || finished.SyncedFileItems != 4 ||
		finished.TransferredItems != 2 || finished.FailedItems != 0 {
		t.Fatalf("shared SourceRun terminal history mismatch: %+v", finished)
	}

	var source meta.Source
	if err := db.First(&source, target.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if source.Status != meta.SourceStatusPaused || source.LastRunAt == nil ||
		source.LastSuccessAt == nil || source.LastError != "" {
		t.Fatalf("iOS Source must retain device-owned paused state and publish its run result: %+v", source)
	}
	var items int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", target.SourceID).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if items != 0 {
		t.Fatalf("PhotoKit identifiers must not be materialized as shared SourceItems: %d", items)
	}

	// Revocation fences later progress even when the Owner session is still valid.
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, progressPath, token,
		strings.NewReader(`{"summary":`+summary+`}`),
		http.StatusForbidden, headers)
}
