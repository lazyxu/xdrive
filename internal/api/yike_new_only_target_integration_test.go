package api

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Credential updates must never create or adopt a historical uid_* directory.
// Only POST /sources provisions the current managed Pull target namespace.
func TestYikeCredentialRequiresCurrentCanonicalManagedTarget(t *testing.T) {
	for _, scenario := range []string{"unbound", "ordinary", "unmanaged", "legacy-uid-looking"} {
		t.Run(scenario, func(t *testing.T) {
			db, _, owner, _, root := setupFilePropertiesTestDB(t)
			var targetID *uint64
			managed := scenario == "legacy-uid-looking"
			if scenario != "unbound" {
				name := "ordinary"
				if scenario == "legacy-uid-looking" {
					name = "uid_12345_not-a-managed-target"
				}
				target := createFilePropertiesDir(t, db, owner.ID, root.ID, name)
				targetID = &target.ID
			}
			source := meta.Source{
				OwnerID: owner.ID, Name: "Yike", Kind: yikeSourceKind,
				Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
				Revision: 1, TargetNodeID: targetID, TargetManaged: managed,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			identity := sourceCredentialTestDTO{AccountExternalID: "12345", AccountName: "nickname"}
			err := db.Transaction(func(tx *gorm.DB) error {
				return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
			})
			if !errors.Is(err, errYikeTargetContainsData) {
				t.Fatalf("missing or legacy target accepted: %v", err)
			}
			var stored meta.Source
			if err := db.First(&stored, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Revision != 1 || stored.Status != meta.SourceStatusPaused ||
				stored.ProviderAccountID != "" || stored.TargetManaged != managed ||
				(stored.TargetNodeID == nil) != (targetID == nil) ||
				(targetID != nil && *stored.TargetNodeID != *targetID) {
				t.Fatalf("rejected legacy binding mutated Source: %+v", stored)
			}
			var createdNamespace int64
			if err := db.Model(&meta.Node{}).
				Where("owner_id = ? AND name = ? AND deleted_at IS NULL",
					owner.ID, yikeTargetRootName).Count(&createdNamespace).Error; err != nil {
				t.Fatal(err)
			}
			if createdNamespace != 0 {
				t.Fatal("credential binding synthesized a target namespace")
			}
		})
	}
}
