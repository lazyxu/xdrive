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
)

func TestManagedTargetFlatPushPullNamespacesAndProviderIdentity(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		ON xd_nodes(owner_id, parent_id, lower(name))
		WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_direction_name
		ON xd_sources(owner_id, direction, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("flat-managed-names", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	create := func(ownerToken, body string, expected int, headers map[string]string) sourceDTO {
		t.Helper()
		res := requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources",
			ownerToken, strings.NewReader(body), expected, headers)
		var out sourceDTO
		if expected == http.StatusCreated {
			if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if out.ID == 0 || out.TargetNodeID == nil || !out.TargetManaged ||
				out.Status != meta.SourceStatusPaused {
				t.Fatalf("incomplete managed provisioning: %+v", out)
			}
		}
		return out
	}
	// Android must enroll as an identity-only native device before owning a
	// managed Photos Source. A generic Owner bearer cannot choose a target.
	create(token, `{"name":"伪造 Android","kind":"android_photos","direction":"push"}`,
		http.StatusForbidden, nil)
	create(token, `{"name":"伪造 Android","kind":"android_photos","direction":"push","target_node_id":999}`,
		http.StatusForbidden, nil)
	yike := create(token, `{"name":"相同名称","kind":"yike_photos","direction":"pull"}`,
		http.StatusCreated, nil)
	if yike.TargetPath != "同步文件夹/Pull/Yike Photos/相同名称" {
		t.Fatalf("Yike must own the final, user-editable leaf immediately: %+v", yike)
	}
	create(token, `{"name":"相同名称","kind":"synology_photos","direction":"pull"}`,
		http.StatusConflict, nil)
	create(token, `{"name":"相同名称","kind":"synology_files","direction":"pull"}`,
		http.StatusConflict, nil)

	syno := create(token, `{"name":"NAS-文件","kind":"synology_files","direction":"pull"}`,
		http.StatusCreated, nil)
	if syno.TargetPath != "同步文件夹/Pull/Synology Files/NAS-文件" {
		t.Fatalf("Synology Files path=%q", syno.TargetPath)
	}
	create(token, `{"name":"nas-文件","kind":"synology_photos","direction":"pull"}`,
		http.StatusConflict, nil)

	secret := strings.Repeat("verified-dsm-device-token-", 2)
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "相同名称", Platform: "synology",
		CredentialHash: deviceCredentialDigest(secret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	push := create(token, `{"name":"相同名称","kind":"synology_photos","direction":"push"}`,
		http.StatusCreated, headers)
	if push.TargetPath != "同步文件夹/Push/相同名称" || push.DeviceID != device.ID ||
		*push.TargetNodeID == *yike.TargetNodeID {
		t.Fatalf("Push/Pull must be separate namespaces and nodes: push=%+v pull=%+v", push, yike)
	}
	create(token, `{"name":"相同名称","kind":"synology_photos","direction":"push"}`,
		http.StatusConflict, headers)
	create(token, `{"name":"相同名称-测试","kind":"synology_photos","direction":"push","target_node_id":123}`,
		http.StatusBadRequest, headers)

	var pushLeaf meta.Node
	if err := db.First(&pushLeaf, *push.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if pushLeaf.ParentID == nil {
		t.Fatal("flat Push leaf has no parent")
	}
	var pushParent meta.Node
	if err := db.First(&pushParent, *pushLeaf.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if pushParent.Name != "Push" {
		t.Fatalf("Push leaf has an unexpected extra DeviceID ancestor: %+v", pushParent)
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, pushParent.ID, "已有普通目录")
	create(token, `{"name":"已有普通目录","kind":"synology_photos","direction":"push"}`,
		http.StatusConflict, headers)
	var unchanged meta.Node
	if err := db.First(&unchanged, ordinary.ID).Error; err != nil ||
		unchanged.Revision != ordinary.Revision {
		t.Fatalf("ordinary directory was adopted or modified: %+v / %v", unchanged, err)
	}

	// A managed Pull Source never derives its account identity from a folder
	// name. Binding a verified Cookie must preserve the original target Node.
	var yikeSource meta.Source
	if err := db.First(&yikeSource, yike.ID).Error; err != nil {
		t.Fatal(err)
	}
	initialTarget := *yikeSource.TargetNodeID
	if err := db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &yikeSource,
			sourceCredentialTestDTO{AccountExternalID: "881234", AccountName: "不同账号昵称"})
	}); err != nil {
		t.Fatal(err)
	}
	if yikeSource.ProviderAccountID != "881234" || *yikeSource.TargetNodeID != initialTarget ||
		yikeSource.Name != "相同名称" || yikeSource.Status != meta.SourceStatusActive {
		t.Fatalf("Yike credentials changed Source/Node identity: %+v", yikeSource)
	}
	var yikeLeaf meta.Node
	if err := db.First(&yikeLeaf, initialTarget).Error; err != nil || yikeLeaf.Name != "相同名称" {
		t.Fatalf("Yike remote nickname silently renamed the managed leaf: %+v / %v", yikeLeaf, err)
	}
	anotherYike := create(token, `{"name":"另一个拉取来源","kind":"yike_photos","direction":"pull"}`,
		http.StatusCreated, nil)
	var duplicateAccount meta.Source
	if err := db.First(&duplicateAccount, anotherYike.ID).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &duplicateAccount,
			sourceCredentialTestDTO{AccountExternalID: "881234", AccountName: "另一名称"})
	})
	if !errors.Is(err, errYikeAccountAlreadyConfigured) {
		t.Fatalf("remote account was claimed by two Sources: %v", err)
	}

	// Archived Sources still reserve names, while a different Owner may use
	// the same name in its own private namespace.
	if err := db.Model(&meta.Source{}).Where("id = ?", syno.ID).
		Update("status", meta.SourceStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	create(token, `{"name":"NAS-文件","kind":"synology_photos","direction":"pull"}`,
		http.StatusConflict, nil)
	otherRoot := meta.Node{OwnerID: other.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherSource := create(otherToken, `{"name":"NAS-文件","kind":"synology_photos","direction":"pull"}`,
		http.StatusCreated, nil)
	if otherSource.TargetNodeID == nil || *otherSource.TargetNodeID == *syno.TargetNodeID {
		t.Fatal("cross-Owner target isolation failed")
	}

	// A pre-existing Source claiming an ancestor makes new provisioning fail
	// closed, regardless of the requested leaf's name.
	ancestor := meta.Source{OwnerID: owner.ID, Name: "旧 Push 根绑定",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &pushParent.ID}
	if err := db.Create(&ancestor).Error; err != nil {
		t.Fatal(err)
	}
	create(token, `{"name":"另一台NAS","kind":"synology_photos","direction":"push"}`,
		http.StatusConflict, headers)
	_ = root
}

func TestManagedTargetRenameRejectsInFlightUploadAndRun(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}, &meta.LocalPushCommonUploadOperation{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("flat-managed-rename", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	res := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"重命名前","kind":"synology_files","direction":"pull"}`),
		http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(res.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.TargetNodeID == nil {
		t.Fatal("no managed target")
	}
	targetID := *source.TargetNodeID
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	patch := func(revision uint64, name string, status int) {
		t.Helper()
		requestWithHeaders(t, router, http.MethodPatch, url, token,
			strings.NewReader(fmt.Sprintf(`{"name":%q}`, name)),
			status, map[string]string{"If-Match": fmt.Sprintf("%q", fmt.Sprint(revision))})
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, SourceID: source.ID,
		SourceRevision: source.Revision, SourceTargetID: targetID,
		ParentID: &targetID, Name: "photo.jpg", RequestedName: "photo.jpg",
		Status: meta.UploadStatusActive, ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize: 1, ChunkSize: 1, ChunkCount: 1, SHA256: strings.Repeat("a", 64),
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	patch(1, "有待结算上传", http.StatusConflict)
	var current meta.Source
	var target meta.Node
	if err := db.First(&current, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&target, targetID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Name != "重命名前" || current.Revision != 1 ||
		target.Name != "重命名前" || target.Revision != 1 {
		t.Fatalf("conflict performed partial rename: Source=%+v Target=%+v", current, target)
	}
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
		Update("status", meta.UploadStatusFinalized).Error; err != nil {
		t.Fatal(err)
	}
	patch(1, "重命名后", http.StatusOK)
	var after meta.Source
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&target, targetID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Name != "重命名后" || after.Revision != 2 ||
		after.TargetNodeID == nil || *after.TargetNodeID != targetID ||
		target.Name != "重命名后" || target.Revision != 2 {
		t.Fatalf("atomic source/target rename diverged: %+v / %+v", after, target)
	}
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 2,
		SyncMode: meta.SourceSyncModeBackup, TargetNodeID: &targetID,
		Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: time.Now().UTC(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	patch(2, "运行期间", http.StatusConflict)
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("status", meta.SyncRunStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	patch(2, "再次重命名", http.StatusOK)
	if err := db.First(&target, targetID).Error; err != nil ||
		target.Name != "再次重命名" || target.Revision != 3 {
		t.Fatalf("terminal run did not release original TargetNodeID: %+v / %v", target, err)
	}

	// Local Push reserved/Bound operations are independently durable and
	// must block renames even without an active UploadSession row.
	local := meta.Source{OwnerID: owner.ID, Name: "未结算操作",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &targetID}
	if err := db.Create(&local).Error; err != nil {
		t.Fatal(err)
	}
	op := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: owner.ID, OwnerSession: owner.SessionVersion,
		DeviceID: uuid.NewString(), RootID: uuid.NewString(),
		RootFingerprint: strings.Repeat("b", 64), SourceID: local.ID,
		SourceRevision: 1, SourceTargetID: targetID,
		ResumeKey: "lp2_" + strings.Repeat("c", 64),
		ContentSHA256: strings.Repeat("a", 64),
		TotalSize: 1, State: meta.LocalPushCommonUploadReserved,
	}
	if err := db.Create(&op).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceTargetRenameQuiescentTx(db, local, target); !errors.Is(err, errSourceTargetRenameActive) {
		t.Fatalf("unsettled local Push operation did not block rename: %v", err)
	}
}
