package api

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestYikeFirstBindingNeverClaimsExistingEmptyOrdinaryLeaf(t *testing.T) {
	db, _, owner, _, _ := setupFilePropertiesTestDB(t)
	identity := sourceCredentialTestDTO{AccountExternalID: "91234", AccountName: "private"}
	ordinary, err := ensureYikeManagedTargetTx(context.Background(), db, owner.ID, identity)
	if err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike empty conflict", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
	})
	if !errors.Is(err, errYikeTargetPathConflict) {
		t.Fatalf("empty ordinary folder was claimed instead of rejected: %v", err)
	}
	var unchanged meta.Node
	var current meta.Source
	if err := db.First(&unchanged, ordinary.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&current, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.TargetNodeID != nil || current.Revision != 1 ||
		unchanged.ParentID == nil || unchanged.Revision != ordinary.Revision {
		t.Fatalf("conflicting folder or Source changed: node=%+v source=%+v", unchanged, current)
	}
	var leafCount int64
	if err := db.Model(&meta.Node{}).Where("id = ? AND owner_id = ?", ordinary.ID, owner.ID).
		Count(&leafCount).Error; err != nil || leafCount != 1 {
		t.Fatalf("existing ordinary leaf was removed: count=%d err=%v", leafCount, err)
	}
}

func TestYikeFirstBindingRejectsOtherSourceOwnedAncestor(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	other := meta.Source{
		OwnerID: owner.ID, Name: "ordinary-root source", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike subtree", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	identity := sourceCredentialTestDTO{AccountExternalID: "91235", AccountName: "other"}
	err := db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
	})
	if !errors.Is(err, errYikeTargetPathConflict) {
		t.Fatalf("Yike root nested under another Source unexpectedly accepted: %v", err)
	}
	var current meta.Source
	if err := db.First(&current, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.TargetNodeID != nil || current.Revision != 1 {
		t.Fatalf("Source bound despite conflicting ancestor: %+v", current)
	}
	var leaked int64
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND name = ? AND deleted_at IS NULL",
		owner.ID, "同步文件夹").Count(&leaked).Error; err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Fatal("blocked Source created a managed directory outside the bind transaction")
	}
}

func TestYikeLegacyRelocationRefusesUnverifiedEmptyUIDRoot(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	folder := createFilePropertiesDir(t, db, owner.ID, root.ID, "ordinary")
	orphan := createFilePropertiesDir(t, db, owner.ID, folder.ID, "uid_91236_unowned")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike detached", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &orphan.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	identity := sourceCredentialTestDTO{AccountExternalID: "91236", AccountName: "unowned"}
	err := db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
	})
	if !errors.Is(err, errYikeTargetContainsData) {
		t.Fatalf("empty UID-looking ordinary folder was relocated: %v", err)
	}
	var original meta.Node
	var current meta.Source
	if err := db.First(&original, orphan.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&current, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if original.ParentID == nil || *original.ParentID != folder.ID ||
		current.TargetNodeID == nil || *current.TargetNodeID != orphan.ID ||
		current.Revision != 1 {
		t.Fatalf("unverified folder was moved or rebound: node=%+v source=%+v", original, current)
	}
}

func TestYikeFirstBindingUsesCanonicalPullTargetNamespace(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike Photos", Kind: yikeSourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	identity := sourceCredentialTestDTO{AccountExternalID: "98765", AccountName: "new account"}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
	}); err != nil {
		t.Fatal(err)
	}
	if source.TargetNodeID == nil || !source.TargetManaged {
		t.Fatalf("Yike Source did not bind its server-managed target: %+v", source)
	}
	var target meta.Node
	if err := db.First(&target, *source.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if target.ParentID == nil {
		t.Fatalf("Yike target has no managed parent: %+v", target)
	}
	var connector meta.Node
	if err := db.First(&connector, *target.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if connector.Name != yikePullTargetConnectorName || connector.ParentID == nil {
		t.Fatalf("Yike target connector path mismatch: %+v", connector)
	}
	var pullRoot meta.Node
	if err := db.First(&pullRoot, *connector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if pullRoot.Name != yikePullTargetRootName || pullRoot.ParentID == nil {
		t.Fatalf("Yike Pull namespace missing: %+v", pullRoot)
	}
	var syncRoot meta.Node
	if err := db.First(&syncRoot, *pullRoot.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if syncRoot.Name != yikeTargetRootName || syncRoot.ParentID == nil || *syncRoot.ParentID != root.ID {
		t.Fatalf("Yike target is outside the canonical sync root: %+v", syncRoot)
	}
	var stored meta.Source
	if err := db.First(&stored, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !stored.TargetManaged || stored.TargetNodeID == nil || *stored.TargetNodeID != target.ID {
		t.Fatalf("Yike managed provenance was not persisted: %+v", stored)
	}
}
