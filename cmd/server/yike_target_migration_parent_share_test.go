package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLegacyYikeStartupKeepsDirectlySharedOldParents(t *testing.T) {
	for _, kind := range []string{"connector", "legacy-root"} {
		t.Run(kind, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			owner, _, connector, target, source := createLegacyYikeMigrationFixture(t, db)
			if connector.ParentID == nil {
				t.Fatal("legacy connector has no root")
			}
			var legacyRoot meta.Node
			if err := db.First(&legacyRoot, *connector.ParentID).Error; err != nil {
				t.Fatal(err)
			}

			shareNodeID := connector.ID
			if kind == "legacy-root" {
				shareNodeID = legacyRoot.ID
			}
			share := meta.Share{
				OwnerID: owner.ID, NodeID: shareNodeID,
				TokenHash: strings.Repeat("e", 64), Access: "read_only",
			}
			if err := db.Create(&share).Error; err != nil {
				t.Fatal(err)
			}
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}

			var migrated meta.Node
			var oldConnector, oldRoot meta.Node
			var keptShare meta.Share
			var savedSource meta.Source
			for _, err := range []error{
				db.First(&migrated, target.ID).Error,
				db.First(&oldConnector, connector.ID).Error,
				db.First(&oldRoot, legacyRoot.ID).Error,
				db.First(&keptShare, share.ID).Error,
				db.First(&savedSource, source.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if migrated.ParentID == nil || *migrated.ParentID == connector.ID ||
				savedSource.TargetNodeID == nil || *savedSource.TargetNodeID != target.ID {
				t.Fatalf("clean target migration did not complete: node=%+v source=%+v", migrated, savedSource)
			}
			if keptShare.NodeID != shareNodeID ||
				keptShare.TokenHash != share.TokenHash || keptShare.RevokedAt != nil {
				t.Fatalf("migration changed direct old-parent Share: %+v", keptShare)
			}
			if oldRoot.DeletedAt != nil {
				t.Fatalf("directly shared old hierarchy root was pruned: %+v", oldRoot)
			}
			if kind == "connector" {
				if oldConnector.DeletedAt != nil ||
					oldConnector.ParentID == nil || *oldConnector.ParentID != legacyRoot.ID {
					t.Fatalf("directly shared legacy connector was pruned: %+v", oldConnector)
				}
			}
			// A second upgrade pass must not mutate the preserved old Share
			// or the already migrated Source target.
			if err := migrateLegacyYikeTargets(db); err != nil {
				t.Fatal(err)
			}
			var afterRetry meta.Share
			if err := db.First(&afterRetry, share.ID).Error; err != nil {
				t.Fatal(err)
			}
			if afterRetry.NodeID != shareNodeID || afterRetry.TokenHash != share.TokenHash {
				t.Fatalf("restart rebound old direct Share: %+v", afterRetry)
			}
		})
	}
}
