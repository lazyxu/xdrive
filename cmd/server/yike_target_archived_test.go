package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLegacyYikeMigrationSkipsArchivedSourceAndItsSharedRoot(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	owner, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)
	share := meta.Share{OwnerID: owner.ID, NodeID: target.ID,
		TokenHash: strings.Repeat("d", 64), Access: "read_only"}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
		Update("status", meta.SourceStatusArchived).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}
	var unchanged meta.Node
	var preserved meta.Source
	var sameShare meta.Share
	for _, err := range []error{
		db.First(&unchanged, target.ID).Error,
		db.First(&preserved, source.ID).Error,
		db.First(&sameShare, share.ID).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if preserved.Status != meta.SourceStatusArchived ||
		preserved.TargetNodeID == nil || *preserved.TargetNodeID != target.ID ||
		preserved.Revision != source.Revision ||
		unchanged.ParentID == nil || *unchanged.ParentID != connector.ID ||
		sameShare.NodeID != target.ID || sameShare.TokenHash != share.TokenHash {
		t.Fatalf("archive allowed startup migration to mutate identity: source=%+v node=%+v share=%+v",
			preserved, unchanged, sameShare)
	}
	var canonical int64
	if err := db.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
		owner.ID, root.ID, yikeTargetRootName,
	).Count(&canonical).Error; err != nil {
		t.Fatal(err)
	}
	if canonical != 0 {
		t.Fatal("archived Yike Source caused canonical directory creation")
	}
}
