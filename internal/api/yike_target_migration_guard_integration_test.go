package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestYikeCredentialRebindLegacyTargetRequiresProvenDescendants(t *testing.T) {
	for _, scenario := range []string{"clean", "mixed", "foreign-source", "running-run"} {
		t.Run(scenario, func(t *testing.T) {
			db, _, owner, _, root := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(&meta.SyncRun{}, &meta.Share{}); err != nil {
				t.Fatal(err)
			}
			legacy := createFilePropertiesDir(t, db, owner.ID, root.ID, "来源")
			connector := createFilePropertiesDir(t, db, owner.ID, legacy.ID, yikeTargetConnectorName)
			target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "uid_12345_张三")
			photo := createFilePropertiesFile(t, db, owner.ID, target.ID, "photo.jpg", 7)
			source := meta.Source{
				OwnerID: owner.ID, Name: "Yike Owner", Kind: yikeSourceKind,
				Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
				Revision: 1, TargetNodeID: &target.ID,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&meta.SourceItem{
				SourceID: source.ID, ExternalID: "yike:12345:photo", NodeID: &photo.ID,
				Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
				Path: "photo.jpg", NodeRevision: photo.Revision,
				LastSeenAt: time.Now().UTC(),
			}).Error; err != nil {
				t.Fatal(err)
			}
			share := meta.Share{OwnerID: owner.ID, NodeID: photo.ID,
				TokenHash: "yike-credential-rebind-12345-" + scenario, Access: "read_only"}
			if err := db.Create(&share).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "mixed":
				createFilePropertiesFile(t, db, owner.ID, target.ID, "ordinary.pdf", 16)
			case "foreign-source":
				other := meta.Source{
					OwnerID: owner.ID, Name: "other", Kind: "test",
					Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
					RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
					Revision: 1, TargetNodeID: &connector.ID,
				}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
			case "running-run":
				run := meta.SyncRun{
					ID:       "b43c6d35-0dcf-490b-8467-df3dba6c4c0f",
					SourceID: source.ID, Mode: meta.SourceRunModeSync,
					Trigger: meta.SyncRunTriggerManual,
					Status:  meta.SyncRunStatusRunning, StartedAt: time.Now().UTC(),
				}
				if err := db.Create(&run).Error; err != nil {
					t.Fatal(err)
				}
			}

			identity := sourceCredentialTestDTO{
				Valid: true, Kind: yikeSourceKind,
				AccountExternalID: "12345", AccountName: "变化后的远端昵称",
			}
			err := db.Transaction(func(tx *gorm.DB) error {
				return bindYikeManagedTargetTx(context.Background(), tx, &source, identity)
			})
			if scenario == "clean" {
				if err != nil {
					t.Fatalf("proven Yike subtree was blocked: %v", err)
				}
			} else if !errors.Is(err, errYikeTargetContainsData) {
				t.Fatalf("unproven legacy subtree was moved: %v", err)
			}

			var reloaded meta.Node
			if err := db.First(&reloaded, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			var oldShare meta.Share
			if err := db.First(&oldShare, share.ID).Error; err != nil {
				t.Fatal(err)
			}
			if oldShare.NodeID != photo.ID || oldShare.TokenHash != share.TokenHash ||
				oldShare.RevokedAt != nil {
				t.Fatalf("credential rebind modified existing direct file share: %+v", oldShare)
			}
			if scenario != "clean" {
				var stored meta.Source
				if err := db.First(&stored, source.ID).Error; err != nil {
					t.Fatal(err)
				}
				if reloaded.ParentID == nil || *reloaded.ParentID != connector.ID ||
					stored.Revision != 1 || stored.Status != meta.SourceStatusPaused ||
					stored.TargetNodeID == nil || *stored.TargetNodeID != target.ID {
					t.Fatalf("blocked credential rebind mutated Source/Node: node=%+v source=%+v", reloaded, stored)
				}
				return
			}
			if reloaded.ParentID == nil || *reloaded.ParentID == connector.ID ||
				reloaded.Name != target.Name || reloaded.Revision != target.Revision+1 {
				t.Fatalf("verified Yike target did not move in place: %+v", reloaded)
			}
			var savedPhoto meta.Node
			if err := db.First(&savedPhoto, photo.ID).Error; err != nil {
				t.Fatal(err)
			}
			if savedPhoto.ParentID == nil || *savedPhoto.ParentID != target.ID ||
				savedPhoto.Revision != photo.Revision {
				t.Fatalf("Yike migration changed tracked file identity: %+v", savedPhoto)
			}
		})
	}
}
