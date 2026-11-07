package api

import (
	"context"
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
	"gorm.io/gorm"
)

func TestLocalPushAutoManagedTargetAndDraftCancellation(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.SourceRunFailure{}, &meta.SourceCollection{}, &meta.SourceCredential{},
		&meta.SourceConnectorConfig{}, &meta.Share{}, &meta.UploadSession{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("auto-local-push-target", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secretA := "auto-push-device-A-secret-credential-00001"
	secretB := "auto-push-device-B-secret-credential-00002"
	deviceA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "一号电脑", Platform: "windows",
		CredentialHash: deviceCredentialDigest(secretA), CreatedAt: now, UpdatedAt: now,
	}
	// Same display name cannot imply the same device identity.
	deviceB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "一号电脑", Platform: "linux",
		CredentialHash: deviceCredentialDigest(secretB), CreatedAt: now, UpdatedAt: now,
	}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	oldFolder := createFilePropertiesDir(t, db, owner.ID, root.ID, "旧用户目录")
	makeBody := func(name string, selected uint64) string {
		return fmt.Sprintf(`{"name":%q,"kind":"local_folder","direction":"push","schedule_type":"manual","target_node_id":%d}`,
			name, selected)
	}
	headers := func(device meta.ClientDevice, secret string) map[string]string {
		return map[string]string{"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret}
	}
	create := func(name string, selected uint64, device meta.ClientDevice, secret string, expected int) sourceDTO {
		t.Helper()
		result := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", token,
			strings.NewReader(makeBody(name, selected)), expected, headers(device, secret))
		var dto sourceDTO
		if expected == http.StatusCreated {
			if err := json.Unmarshal(result.Body.Bytes(), &dto); err != nil {
				t.Fatal(err)
			}
		}
		return dto
	}

	create("无效密钥", 0, deviceA, secretB, http.StatusForbidden)
	create("不能接管其他用户", root.ID+999999999, deviceA, secretA, http.StatusBadRequest)
	create("不可认领普通目录", oldFolder.ID, deviceA, secretA, http.StatusBadRequest)
	sourceA := create("本机照片", 0, deviceA, secretA, http.StatusCreated)
	expected := "同步文件夹/Push/" + managedPushDeviceFolderName(deviceA) + "/本机照片"
	if sourceA.TargetNodeID == nil || *sourceA.TargetNodeID == oldFolder.ID ||
		sourceA.TargetPath != expected || sourceA.Status != meta.SourceStatusPaused ||
		sourceA.Revision != 1 {
		t.Fatalf("new Push did not get a device-scoped managed cloud path: %+v", sourceA)
	}
	var sourceStored meta.Source
	if err := db.First(&sourceStored, sourceA.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !sourceStored.TargetManaged || sourceStored.LocalCreatorDeviceID == nil ||
		*sourceStored.LocalCreatorDeviceID != deviceA.ID {
		t.Fatalf("unverified ownership of auto-created target: %+v", sourceStored)
	}
	var oldNode meta.Node
	if err := db.First(&oldNode, oldFolder.ID).Error; err != nil {
		t.Fatal(err)
	}
	if oldNode.ParentID == nil || *oldNode.ParentID != root.ID ||
		oldNode.Name != "旧用户目录" || oldNode.Revision != oldFolder.Revision {
		t.Fatalf("ignored legacy target was modified: %+v", oldNode)
	}

	second := create("第二个本机来源", 0, deviceA, secretA, http.StatusCreated)
	var firstTarget, secondTarget meta.Node
	if err := db.First(&firstTarget, *sourceA.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&secondTarget, *second.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if firstTarget.ID == secondTarget.ID || firstTarget.ParentID == nil ||
		secondTarget.ParentID == nil || *firstTarget.ParentID != *secondTarget.ParentID {
		t.Fatalf("same-device Push targets must be siblings: %v / %v", firstTarget, secondTarget)
	}

	// A direct read-only Share must not be severed by silent draft cleanup.
	shared := create("仍有分享的草稿", 0, deviceA, secretA, http.StatusCreated)
	share := meta.Share{
		OwnerID: owner.ID, NodeID: *shared.TargetNodeID,
		TokenHash: strings.Repeat("c", 64), Access: "read_only",
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	discardPath := fmt.Sprintf("/api/v1/sources/%d/local-draft", shared.ID)
	h := headers(deviceA, secretA)
	h["If-Match"] = `"1"`
	requestWithHeaders(t, router, http.MethodDelete, discardPath, token, nil, http.StatusConflict, h)
	if err := db.Delete(&share).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, discardPath, token, nil, http.StatusNoContent, h)
	var removed meta.Node
	if err := db.First(&removed, *shared.TargetNodeID).Error; err != gorm.ErrRecordNotFound {
		t.Fatalf("cancelled pristine Source retained its empty leaf: node=%+v err=%v", removed, err)
	}
	// The same name is usable after clean cancellation, but only as a new
	// server-owned Source with a new stable ID.
	retry := create("仍有分享的草稿", 0, deviceA, secretA, http.StatusCreated)
	if retry.TargetNodeID == nil || *retry.TargetNodeID == *shared.TargetNodeID {
		t.Fatalf("recreated Source claimed cancelled Node ID: %+v", retry)
	}

	// Two enrolled devices with the same display name keep independent
	// Server-pinned groups even when their visible labels collide.
	sourceB := create("第二台机器照片", 0, deviceB, secretB, http.StatusCreated)
	var secondDeviceTarget meta.Node
	if err := db.First(&secondDeviceTarget, *sourceB.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if secondDeviceTarget.ID == firstTarget.ID || secondDeviceTarget.ParentID == nil ||
		firstTarget.ParentID == nil || *secondDeviceTarget.ParentID == *firstTarget.ParentID {
		t.Fatal("different devices must use distinct pinned device-group Nodes")
	}
	hb := headers(deviceB, secretB)
	hb["If-Match"] = `"1"`
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/sources/%d/local-draft", sourceB.ID), token, nil,
		http.StatusNoContent, hb)
	// Cancelling a pristine Source removes only its leaf. Its pinned device
	// ancestor survives to serve new Sources from the same device.
	var pinnedGroup meta.Node
	if err := db.First(&pinnedGroup, *secondDeviceTarget.ParentID).Error; err != nil ||
		pinnedGroup.Name != managedPushDeviceFolderName(deviceB) ||
		pinnedGroup.ParentID == nil {
		t.Fatalf("pinned device group removed after draft cancellation: %+v err=%v", pinnedGroup, err)
	}
	var storedDeviceB meta.ClientDevice
	if err := db.First(&storedDeviceB, deviceB.ID).Error; err != nil ||
		storedDeviceB.ManagedPushNodeID == nil ||
		*storedDeviceB.ManagedPushNodeID != pinnedGroup.ID {
		t.Fatalf("Device lost server-pinned group after cancellation: %+v err=%v", storedDeviceB, err)
	}
	// The group must be protected even when its only Source draft is gone.
	inside, err := managedSourceNodeInTargetDB(context.Background(), db, owner.ID, pinnedGroup.ID)
	if err != nil || !inside {
		t.Fatalf("Owner could write into pinned empty device group: inside=%v err=%v", inside, err)
	}
	structural, err := managedSourceTargetInSubtreeDB(context.Background(), db, owner.ID, pinnedGroup.ID)
	if err != nil || !structural {
		t.Fatalf("Owner could move pinned empty device group: protected=%v err=%v", structural, err)
	}
	bulk, err := managedSourceTargetInIDsDB(context.Background(), db, owner.ID, []uint64{pinnedGroup.ID})
	if err != nil || !bulk {
		t.Fatalf("bulk deletion overlooked pinned empty device group: protected=%v err=%v", bulk, err)
	}
	var pushParent meta.Node
	if err := db.First(&pushParent, *pinnedGroup.ParentID).Error; err != nil ||
		pushParent.Name != "Push" {
		t.Fatalf("fixed Push parent was removed after draft cancellation: %+v err=%v", pushParent, err)
	}
	create("第二台机器照片", 0, deviceB, secretB, http.StatusCreated)

	// Changing the display name of a Source from a different device cannot
	// bypass the creating-device and Root permissions.
	ownerOnly := request(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/sources/%d", sourceA.ID), token,
		strings.NewReader(`{"name":"错误的改名"}`), http.StatusForbidden)
	if strings.Contains(ownerOnly.Body.String(), deviceA.ID) {
		t.Fatal("device identity leaked into unauthorized response")
	}
	otherRoot := meta.Node{OwnerID: other.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	create("错误跨用户目标", otherRoot.ID, deviceA, secretA, http.StatusBadRequest)
}

func TestLocalPushAutoTargetRejectsExistingOrdinaryLeaf(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("occupied-push-group", time.Hour)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := "occupied-group-verified-device-credential-123"
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "User's computer",
		Platform: "windows", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	push := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "Push")
	occupied := createFilePropertiesDir(t, db, owner.ID, push.ID, managedPushDeviceFolderName(device))
	body := `{"name":"Not claimed","kind":"local_folder","direction":"push","schedule_type":"manual"}`
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	result := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources",
		ownerJWT, strings.NewReader(body), http.StatusConflict, headers)
	if !strings.Contains(result.Body.String(), "managed source target") {
		t.Fatalf("missing explicit occupied leaf conflict: %s", result.Body.String())
	}
	var after meta.Node
	if err := db.First(&after, occupied.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.ParentID == nil || *after.ParentID != push.ID || after.Revision != occupied.Revision {
		t.Fatalf("user-owned ordinary leaf was modified: %+v", after)
	}
	var sources int64
	if err := db.Model(&meta.Source{}).Where("owner_id = ?", owner.ID).Count(&sources).Error; err != nil {
		t.Fatal(err)
	}
	if sources != 0 {
		t.Fatalf("conflicted automatic provision left %d Source rows", sources)
	}
}
