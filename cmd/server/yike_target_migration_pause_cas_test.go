package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestBlockedLegacyYikePauseCASRequiresExactSourceSnapshot(t *testing.T) {
	for _, scenario := range []string{"matching", "newer-revision", "changed-target", "changed-status"} {
		t.Run(scenario, func(t *testing.T) {
			db := openYikeMigrationTestDB(t)
			owner, root, _, target, source := createLegacyYikeMigrationFixture(t, db)
			expected := source
			changedTargetID := target.ID

			switch scenario {
			case "newer-revision":
				if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
					Updates(map[string]any{
						"revision": gorm.Expr("revision + 1"),
						"name": "newer source config",
					}).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-target":
				alternate := meta.Node{
					OwnerID: owner.ID, ParentID: &root.ID,
					Name: "new-target", Type: meta.NodeTypeDir, Revision: 1,
				}
				if err := db.Create(&alternate).Error; err != nil {
					t.Fatal(err)
				}
				changedTargetID = alternate.ID
				// Even if a buggy legacy client changed the binding without
				// incrementing Revision, the old migration must not win.
				if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
					Update("target_node_id", alternate.ID).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-status":
				if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
					Update("status", meta.SourceStatusPaused).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := pauseBlockedLegacyYikeSourceCAS(db, expected); err != nil {
				t.Fatal(err)
			}

			var actual meta.Source
			var originalNode meta.Node
			if err := db.First(&actual, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&originalNode, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			if actual.TargetNodeID == nil || *actual.TargetNodeID != changedTargetID ||
				originalNode.ParentID == nil || *originalNode.ParentID != *target.ParentID {
				t.Fatalf("failed migration pause touched Source target or Node: source=%+v node=%+v",
					actual, originalNode)
			}
			switch scenario {
			case "matching":
				if actual.Status != meta.SourceStatusPaused ||
					actual.Revision != expected.Revision+1 || actual.LastError == "" {
					t.Fatalf("blocked current migration was not paused: %+v", actual)
				}
				// Retrying with the stale snapshot must be a no-op.
				if err := pauseBlockedLegacyYikeSourceCAS(db, expected); err != nil {
					t.Fatal(err)
				}
				var afterRetry meta.Source
				if err := db.First(&afterRetry, source.ID).Error; err != nil {
					t.Fatal(err)
				}
				if afterRetry.Revision != actual.Revision ||
					afterRetry.LastError != actual.LastError {
					t.Fatalf("stale retry consumed another revision: %+v", afterRetry)
				}
				// A second full startup reads the CURRENT paused snapshot.
				// Keeping the same actionable migration blocker must be an
				// idempotent no-op rather than another revision bump.
				if err := pauseBlockedLegacyYikeSourceCAS(db, afterRetry); err != nil {
					t.Fatal(err)
				}
				var nextStartup meta.Source
				if err := db.First(&nextStartup, source.ID).Error; err != nil {
					t.Fatal(err)
				}
				if nextStartup.Revision != afterRetry.Revision ||
					nextStartup.LastError != afterRetry.LastError {
					t.Fatalf("second startup churned already paused Source: %+v", nextStartup)
				}
			case "newer-revision":
				if actual.Revision != 2 || actual.Status != meta.SourceStatusActive ||
					actual.Name != "newer source config" || actual.LastError != "" {
					t.Fatalf("newer Source config was overwritten by stale pause: %+v", actual)
				}
			case "changed-target":
				if actual.Revision != source.Revision || actual.Status != meta.SourceStatusActive ||
					actual.LastError != "" {
					t.Fatalf("rebinding was overwritten by stale pause: %+v", actual)
				}
			case "changed-status":
				if actual.Revision != source.Revision || actual.Status != meta.SourceStatusPaused ||
					actual.LastError != "" {
					t.Fatalf("separate Source status change consumed an obsolete revision: %+v", actual)
				}
			}
		})
	}
}
