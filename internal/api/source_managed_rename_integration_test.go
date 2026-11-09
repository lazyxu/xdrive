package api

import (
	"context"
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
	"gorm.io/gorm"
)

// The disabled HTTP entry point no longer authorizes Synology Pull edits.
// Keep testing the dormant provider's existing atomic target-renamer directly,
// while keeping the canonical target and atomic rename contract.
func TestManagedSourceRename5BAtomicAndLegacyGuard(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
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
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "Pull")
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, "Synology Photos")
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "原目录")
	file := createFilePropertiesFile(t, db, owner.ID, target.ID, "document.jpg", 32)
	src := meta.Source{
		OwnerID: owner.ID, Name: "原目录", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&src).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: src.ID, ExternalID: "remote:original", NodeID: &file.ID,
		Kind: meta.SourceItemKindFile, Path: "document.jpg",
		NodeRevision: file.Revision, State: meta.SourceItemStateSynced,
		LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/sources/%d", src.ID)
	requestWithHeaders(t, router, http.MethodPatch, path, token,
		strings.NewReader(`{"name":"HTTP 不再可改"}`), http.StatusGone,
		map[string]string{"If-Match": `"1"`})
	rename := func(name string) error {
		return db.Transaction(func(tx *gorm.DB) error {
			var current meta.Source
			if err := tx.Where("id = ? AND owner_id = ?", src.ID, owner.ID).
				Take(&current).Error; err != nil {
				return err
			}
			if err := renameManagedSourceTargetTx(tx, current, name); err != nil {
				return err
			}
			return tx.Model(&meta.Source{}).Where("id = ? AND revision = ?",
				current.ID, current.Revision).Updates(map[string]any{
				"name": name, "revision": gorm.Expr("revision + 1"),
			}).Error
		})
	}
	check := func(name string, revision uint64) {
		t.Helper()
		var actualSource meta.Source
		if err := db.First(&actualSource, src.ID).Error; err != nil {
			t.Fatal(err)
		}
		var actualTarget meta.Node
		if err := db.First(&actualTarget, target.ID).Error; err != nil {
			t.Fatal(err)
		}
		if actualSource.Name != name || actualTarget.Name != name ||
			actualSource.Revision != revision || actualTarget.Revision != revision ||
			actualSource.TargetNodeID == nil || *actualSource.TargetNodeID != target.ID {
			t.Fatalf("atomic rename lost source/target: source=%+v target=%+v",
				actualSource, actualTarget)
		}
		var stillFile meta.Node
		var stillItem meta.SourceItem
		if err := db.First(&stillFile, file.ID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&stillItem, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stillFile.ParentID == nil || *stillFile.ParentID != target.ID ||
			stillItem.NodeID == nil || *stillItem.NodeID != file.ID ||
			stillItem.Path != "document.jpg" {
			t.Fatal("rename changed historical original or SourceItem identity")
		}
	}
	if err := rename("新目录"); err != nil {
		t.Fatal(err)
	}
	check("新目录", 2)
	createFilePropertiesDir(t, db, owner.ID, connector.ID, "已占用")
	if err := rename("已占用"); !errors.Is(err, errSourceTargetNameConflict) {
		t.Fatalf("occupied managed name was accepted: %v", err)
	}
	check("新目录", 2)
	if err := rename("CON"); !errors.Is(err, errInvalidSourceConfig) {
		t.Fatalf("invalid managed name was accepted: %v", err)
	}
	check("新目录", 2)
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: src.ID, SourceRevision: 2,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: time.Now().UTC(),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := rename("写入期间"); !errors.Is(err, errSourceTargetRenameActive) {
		t.Fatalf("running Source rename was accepted: %v", err)
	}
	check("新目录", 2)
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("status", meta.SyncRunStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "个人文件")
	old := meta.Source{
		OwnerID: owner.ID, Name: "旧来源", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &ordinary.ID,
	}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return renameManagedSourceTargetTx(tx, old, "不能重命名普通目录")
	})
	if !errors.Is(err, errSourceTargetMigrationRequired) {
		t.Fatalf("legacy mixed directory rename bypassed provenance: %v", err)
	}
	var stillOrdinary meta.Node
	if err := db.First(&stillOrdinary, ordinary.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stillOrdinary.Name != ordinary.Name || stillOrdinary.Revision != ordinary.Revision {
		t.Fatal("legacy Source mutated ordinary folder")
	}
	if err := rename("最终目录"); err != nil {
		t.Fatal(err)
	}
	check("最终目录", 3)
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
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, yikePullTargetRootName)
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, yikePullTargetConnectorName)
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "一刻来源")
	targetID := target.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "一刻来源", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID, TargetManaged: true,
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
	if after.Name != "我的一刻" || after.ID != target.ID {
		t.Fatalf("Yike rename changed canonical target identity: %+v", after)
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
	if after.Name != "我的一刻" {
		t.Fatalf("credential refresh reset Owner folder name: %q", after.Name)
	}
}
