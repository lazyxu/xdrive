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

func TestManagedSourceRename5BAtomicAndLegacyGuard(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("source-rename-5b-test", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "远程拉取")
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, "Synology Photos")
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "原目录")
	file := createFilePropertiesFile(t, db, owner.ID, target.ID, "document.jpg", 32)
	targetID := target.ID
	src := meta.Source{
		OwnerID: owner.ID, Name: "原目录", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &targetID, TargetManaged: true,
	}
	if err := db.Create(&src).Error; err != nil {
		t.Fatal(err)
	}
	fileID := file.ID
	item := meta.SourceItem{
		SourceID: src.ID, ExternalID: "remote:original", NodeID: &fileID,
		Kind: meta.SourceItemKindFile, Path: "document.jpg",
		NodeRevision: file.Revision, State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	patch := func(id, revision uint64, payload string, status int) sourceDTO {
		t.Helper()
		response := requestWithHeaders(t, router, http.MethodPatch,
			fmt.Sprintf("/api/v1/sources/%d", id), token, strings.NewReader(payload),
			status, map[string]string{"If-Match": fmt.Sprintf("%q", fmt.Sprint(revision))})
		var dto sourceDTO
		if status == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &dto); err != nil {
				t.Fatal(err)
			}
		}
		return dto
	}
	check := func(wantSourceName, wantTargetName string, sourceRevision, nodeRevision uint64) {
		t.Helper()
		var actualSource meta.Source
		if err := db.First(&actualSource, src.ID).Error; err != nil {
			t.Fatal(err)
		}
		var actualTarget meta.Node
		if err := db.First(&actualTarget, target.ID).Error; err != nil {
			t.Fatal(err)
		}
		if actualSource.Name != wantSourceName || actualTarget.Name != wantTargetName ||
			actualSource.Revision != sourceRevision || actualTarget.Revision != nodeRevision ||
			actualSource.TargetNodeID == nil || *actualSource.TargetNodeID != target.ID ||
			actualTarget.ParentID == nil || *actualTarget.ParentID != connector.ID {
			t.Fatalf("Source / Node lost their atomic identity: source=%+v node=%+v", actualSource, actualTarget)
		}
	}

	// No ordinary user directory is renamed: only the single server-managed
	// target is updated. File Node IDs, source-relative paths and blob bytes do
	// not move, and direct Node-ID shares keep referring to the same root.
	renamed := patch(src.ID, 1, `{"name":"新目录"}`, http.StatusOK)
	if renamed.Name != "新目录" || renamed.TargetNodeID == nil ||
		*renamed.TargetNodeID != target.ID ||
		renamed.TargetPath != "同步文件夹/远程拉取/Synology Photos/新目录" {
		t.Fatalf("managed rename DTO=%+v", renamed)
	}
	check("新目录", "新目录", 2, 2)
	var preservedFile meta.Node
	if err := db.First(&preservedFile, file.ID).Error; err != nil {
		t.Fatal(err)
	}
	var preservedItem meta.SourceItem
	if err := db.First(&preservedItem, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preservedFile.ID != file.ID || preservedFile.ParentID == nil ||
		*preservedFile.ParentID != target.ID || preservedItem.NodeID == nil ||
		*preservedItem.NodeID != file.ID || preservedItem.Path != "document.jpg" {
		t.Fatalf("rename changed synced file identity: file=%+v item=%+v", preservedFile, preservedItem)
	}

	createFilePropertiesDir(t, db, owner.ID, connector.ID, "已占用")
	patch(src.ID, 2, `{"name":"已占用"}`, http.StatusConflict)
	check("新目录", "新目录", 2, 2)
	patch(src.ID, 2, `{"name":"CON"}`, http.StatusBadRequest)
	check("新目录", "新目录", 2, 2)

	// An in-flight writer cannot race an otherwise-valid folder rename.
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: src.ID, SourceRevision: 2,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: time.Now().UTC(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	patch(src.ID, 2, `{"name":"写入期间"}`, http.StatusConflict)
	check("新目录", "新目录", 2, 2)
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("status", meta.SyncRunStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}

	// Re-targeting and renaming in one request cannot silently detach the
	// Source from the directory just renamed.
	other := createFilePropertiesDir(t, db, owner.ID, connector.ID, "另一目录")
	patch(src.ID, 2, fmt.Sprintf(`{"name":"错误目标","target_node_id":%d}`, other.ID), http.StatusConflict)
	check("新目录", "新目录", 2, 2)

	// A pre-migration Source can still target a mixed ordinary directory;
	// its Source.Name may not rename that directory until ownership is proven.
	legacy := createFilePropertiesDir(t, db, owner.ID, root.ID, "个人文件")
	legacyID := legacy.ID
	old := meta.Source{
		OwnerID: owner.ID, Name: "旧来源", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &legacyID,
	}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	patch(old.ID, 1, `{"name":"不允许改普通目录"}`, http.StatusConflict)
	var unchanged meta.Source
	if err := db.First(&unchanged, old.ID).Error; err != nil {
		t.Fatal(err)
	}
	var ordinary meta.Node
	if err := db.First(&ordinary, legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Name != old.Name || unchanged.Revision != 1 || ordinary.Name != legacy.Name {
		t.Fatalf("unsafe legacy rename mutated data: source=%+v node=%+v", unchanged, ordinary)
	}
	// Ensure the failed operations did not leave an open transaction or stale
	// target claim: one normal rename remains possible afterward.
	patch(src.ID, 2, `{"name":"最终目录"}`, http.StatusOK)
	check("最终目录", "最终目录", 3, 3)
}

func TestYikeSourceRenameKeepsAccountIDAndIgnoresCredentialNickname(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("yike-rename-5b", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	connector := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, yikeTargetConnectorName)
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "uid_12345_旧昵称")
	targetID := target.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "一刻来源", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	file := createFilePropertiesFile(t, db, owner.ID, target.ID, "a.jpg", 10)
	fileID := file.ID
	if err := db.Create(&meta.SourceItem{
		SourceID: source.ID, ExternalID: "yike:12345:photo", NodeID: &fileID,
		Path: "a.jpg", Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
		LastSeenAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", source.ID),
		token, strings.NewReader(`{"name":"我的一刻"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var after meta.Node
	if err := db.First(&after, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Name != "uid_12345_我的一刻" || after.ID != target.ID {
		t.Fatalf("Yike rename changed account or root identity: %+v", after)
	}
	var changedSource meta.Source
	if err := db.First(&changedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &changedSource, sourceCredentialTestDTO{
			Valid: true, Kind: yikeSourceKind, AccountExternalID: "12345",
			AccountName: "远端账号昵称已变化",
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.First(&after, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Name != "uid_12345_我的一刻" {
		t.Fatalf("credential refresh reset Owner folder name: %q", after.Name)
	}
}
