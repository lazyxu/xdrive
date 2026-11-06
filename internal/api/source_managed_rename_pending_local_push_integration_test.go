package api

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A paused Local Push Source can have a valid private staging lease even when
// it has no running SourceRun or UploadSession. Renaming during that lease
// would invalidate the device's Source revision before its original settles.
func TestManagedSourceRenameBlocksUnsettledLocalPushStageAndQuota(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{},
		&meta.LocalPushStaging{}, &meta.LocalPushQuotaHold{}); err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	push := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "Push")
	target := createFilePropertiesDir(t, db, owner.ID, push.ID, "本机备份")
	deviceID := uuid.NewString()
	targetID := target.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "本机备份", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &targetID, TargetManaged: true, DeviceID: &deviceID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rename := func(next string) error {
		return db.Transaction(func(tx *gorm.DB) error {
			var current meta.Source
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ?", source.ID, owner.ID).
				Take(&current).Error; err != nil {
				return err
			}
			if err := renameManagedSourceTargetTx(tx, current, next); err != nil {
				return err
			}
			return tx.Model(&meta.Source{}).Where("id = ?", current.ID).
				Updates(map[string]any{"name": next, "revision": gorm.Expr("revision + 1")}).Error
		})
	}
	assertNames := func(want string, wantRevision uint64) {
		t.Helper()
		var current meta.Source
		var node meta.Node
		if err := db.First(&current, source.ID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&node, target.ID).Error; err != nil {
			t.Fatal(err)
		}
		if current.Name != want || node.Name != want ||
			current.Revision != wantRevision || current.TargetNodeID == nil ||
			*current.TargetNodeID != target.ID || node.ParentID == nil ||
			*node.ParentID != push.ID {
			t.Fatalf("rename changed persisted Source/Target outside transaction: source=%+v target=%+v", current, node)
		}
	}
	rootID := uuid.NewString()
	expires := time.Now().UTC().Add(time.Hour)
	stage := meta.LocalPushStaging{
		SourceID: source.ID, StageID: uuid.NewString(), OwnerID: owner.ID,
		SourceRevision: source.Revision, DeviceID: deviceID, RootID: rootID,
		RootFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TargetNodeID:    target.ID, Status: localPushStageReserved, ExpiresAt: expires,
	}
	if err := db.Create(&stage).Error; err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{localPushStageReserved, localPushStageWriting, localPushStageReady} {
		if err := db.Model(&meta.LocalPushStaging{}).Where("source_id = ?", source.ID).
			Update("status", status).Error; err != nil {
			t.Fatal(err)
		}
		if err := rename("被暂存阻止"); !errors.Is(err, errSourceTargetRenameActive) {
			t.Fatalf("live local staging status %q did not block rename: %v", status, err)
		}
		assertNames("本机备份", 1)
	}
	// Once the staging lease expires it cannot commit any bytes using its
	// old Source revision; a dead lease must not lock out an Owner forever.
	if err := db.Model(&meta.LocalPushStaging{}).Where("source_id = ?", source.ID).
		Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if err := rename("已过期暂存"); err != nil {
		t.Fatalf("expired, non-authoritative stage blocked rename: %v", err)
	}
	assertNames("已过期暂存", 2)

	// Even if a Stage was cancelled, its still-live, unreleased quota claim
	// represents an unsettled operation and must be fenced before rename.
	if err := db.Model(&meta.LocalPushStaging{}).Where("source_id = ?", source.ID).
		Updates(map[string]any{"status": localPushStageCanceled, "expires_at": expires}).Error; err != nil {
		t.Fatal(err)
	}
	hold := meta.LocalPushQuotaHold{
		StageID: stage.StageID, OwnerID: owner.ID, SourceID: source.ID,
		SourceRevision: stage.SourceRevision, DeviceID: deviceID, RootID: rootID,
		RootFingerprint: stage.RootFingerprint, TargetNodeID: target.ID,
		ExpiresAt: expires,
	}
	if err := db.Create(&hold).Error; err != nil {
		t.Fatal(err)
	}
	if err := rename("容量未结算"); !errors.Is(err, errSourceTargetRenameActive) {
		t.Fatalf("live unreleased local Push quota did not block rename: %v", err)
	}
	assertNames("已过期暂存", 2)
	now := time.Now().UTC()
	if err := db.Model(&meta.LocalPushQuotaHold{}).Where("stage_id = ?", stage.StageID).
		Update("released_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	if err := rename("最终目录"); err != nil {
		t.Fatalf("settled local Push operation still blocked rename: %v", err)
	}
	assertNames("最终目录", 3)
}
