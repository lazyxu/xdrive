package api

import (
	"context"
	"testing"

	"gorm.io/gorm"
)

const (
	galleryRealWebFoldGroups  = 2_000
	galleryRealWebFoldMembers = 10_000
	galleryRealWebFoldVisible = 92_000
)

// galleryRealWebFoldSeed100K adds SQL-verifiable duplicate groups to the
// already-seeded 100k Gallery fixture. Excluding the first 100 items preserves
// actual CAS-backed cold thumbnails in the visible browser viewport.
// Digest equality here is seeded metadata, not a claim of byte-verified
// physical copies for off-screen records.
func galleryRealWebFoldSeed100K(
	t *testing.T,
	db *gorm.DB,
	ownerID uint64,
	visible []mediaItemDTO,
) {
	t.Helper()
	exclude := make([]uint64, 0, len(visible))
	for _, item := range visible {
		exclude = append(exclude, item.Node.ID)
	}
	if len(exclude) != 100 {
		t.Fatalf("fold fixture first page contains %d nodes, require 100", len(exclude))
	}
	var selectedIDs []uint64
	if err := db.Raw(`SELECT n.id FROM xd_nodes AS n
WHERE n.owner_id = ? AND n.name LIKE 'photo-%'
AND n.id NOT IN ?
ORDER BY n.name ASC LIMIT ?`, ownerID, exclude, galleryRealWebFoldMembers).
		Scan(&selectedIDs).Error; err != nil {
		t.Fatal(err)
	}
	if len(selectedIDs) != galleryRealWebFoldMembers {
		t.Fatalf("fold duplicate seed selected=%d want=%d", len(selectedIDs), galleryRealWebFoldMembers)
	}
	if err := db.Exec(`WITH numbered AS (
SELECT f.node_id, row_number() OVER (ORDER BY n.name) AS ordinal
FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
WHERE f.node_id IN ?
)
UPDATE xd_files AS f SET sha256 =
lpad(to_hex(900000000 + ((numbered.ordinal - 1) % ?)), 64, '0')
FROM numbered WHERE numbered.node_id = f.node_id`,
		selectedIDs, galleryRealWebFoldGroups).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE xd_media_metadata AS mm SET sha256 = f.sha256
FROM xd_files AS f WHERE mm.node_id = f.node_id AND f.node_id IN ?`,
		selectedIDs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE xd_photo_resources AS r SET sha256 = f.sha256
FROM xd_files AS f WHERE r.node_id = f.node_id AND f.node_id IN ?`,
		selectedIDs).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"xd_files", "xd_nodes", "xd_media_metadata",
		"xd_photo_assets", "xd_photo_resources", "xd_photo_metadata",
	} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	testServer := &Server{DB: db}
	off, err := testServer.queryMediaItemRange(
		context.Background(), ownerID, mediaQueryOptions{}, "", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	on, err := testServer.queryMediaItemRange(
		context.Background(), ownerID, mediaQueryOptions{FoldDuplicates: true}, "", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if off.TotalCount != mediaGalleryFirstOpenLogicalCount ||
		on.TotalCount != galleryRealWebFoldVisible ||
		len(off.Items) != 100 || len(on.Items) != 100 ||
		on.TimelineGroupSets == nil {
		t.Fatalf("fold 100k semantic mismatch off=%d/%d on=%d/%d timeline=%t",
			off.TotalCount, len(off.Items), on.TotalCount, len(on.Items),
			on.TimelineGroupSets != nil)
	}
	// Guard real first-visible media. The seeded dedup group is entirely
	// off-screen and must not invalidate already-present CAS JPEG originals.
	for i := range visible {
		if off.Items[i].Node.ID != visible[i].Node.ID ||
			on.Items[i].Node.ID != visible[i].Node.ID {
			t.Fatalf("fold fixture changed visible item at index %d", i)
		}
	}
	if galleryRealWebFoldGroups*5 != len(selectedIDs) {
		t.Fatal("fold group/member fixture size invalid")
	}
	// Native evidence already measures verified fold SQL in PR #1140;
	// this fixture tests browser Toggle ON/OFF with actual HTTP, decode and paint.
}
