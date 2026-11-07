package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// New-source provisioning must not implicitly relocate existing Source trees
// during Server startup, even if the old Yike tree was eligible for a legacy
// automatic migration. Exercise two startups for idempotent non-mutation.
func TestServerStartupMigratePreservesLegacyYikeTarget(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	owner, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)

	for startup := 1; startup <= 2; startup++ {
		if err := migrate(db); err != nil {
			t.Fatalf("startup %d migration: %v", startup, err)
		}

		var storedTarget meta.Node
		if err := db.First(&storedTarget, target.ID).Error; err != nil {
			t.Fatal(err)
		}
		if storedTarget.ParentID == nil || *storedTarget.ParentID != connector.ID ||
			storedTarget.Name != target.Name || storedTarget.Revision != target.Revision {
			t.Fatalf("startup %d changed existing Yike target: before=%+v after=%+v",
				startup, target, storedTarget)
		}

		var storedSource meta.Source
		if err := db.First(&storedSource, source.ID).Error; err != nil {
			t.Fatal(err)
		}
		if storedSource.TargetNodeID == nil || *storedSource.TargetNodeID != target.ID ||
			storedSource.Status != source.Status || storedSource.Revision != source.Revision ||
			storedSource.TargetManaged != source.TargetManaged {
			t.Fatalf("startup %d mutated legacy Source: before=%+v after=%+v",
				startup, source, storedSource)
		}

		var movedRootCount int64
		if err := db.Model(&meta.Node{}).Where(
			"owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			owner.ID, root.ID, yikeTargetRootName,
		).Count(&movedRootCount).Error; err != nil {
			t.Fatal(err)
		}
		if movedRootCount != 0 {
			t.Fatalf("startup %d manufactured new namespace for legacy Source", startup)
		}
	}
}
