package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaCleanupDuplicateAndBurstProjections(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()

	schema := "media_cleanup_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.ContentBlob{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "cleanup-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	addLogicalMedia := func(
		name, sha string,
		size int64,
		width, height int,
		favorite bool,
		created time.Time,
	) (meta.Node, meta.PhotoAsset) {
		t.Helper()
		node := meta.Node{
			ParentID:  &root.ID,
			Name:      name,
			Type:      meta.NodeTypeFile,
			OwnerID:   user.ID,
			Revision:  1,
			CreatedAt: created,
			UpdatedAt: created,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, Size: size,
			StorageKey: "cas/" + sha, SHA256: sha,
			CreatedAt: created, UpdatedAt: created,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: user.ID, NodeRevision: 1,
			SHA256: sha, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: width, Height: height,
			IndexState: meta.MediaIndexStateReady,
			CreatedAt:  created, UpdatedAt: created,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: user.ID, PrimaryNodeID: node.ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: "node:" + fmt.Sprint(node.ID),
			CreatedAt:   created, UpdatedAt: created,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: width, Height: height,
			Favorite: favorite, CreatedAt: created, UpdatedAt: created,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: name, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: size, SHA256: sha,
			CreatedAt: created, UpdatedAt: created,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node, asset
	}

	now := time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)
	duplicateHash := strings.Repeat("a", 64)
	dupA, assetA := addLogicalMedia(
		"copy-a.jpg", duplicateHash, 1000, 3000, 2000, false, now.Add(-2*time.Hour),
	)
	dupB, assetB := addLogicalMedia(
		"copy-b.jpg", duplicateHash, 1000, 3000, 2000, true, now.Add(-time.Hour),
	)
	if err := db.Create(&meta.ContentBlob{
		SHA256: duplicateHash, Size: 1000, StorageKey: "cas/" + duplicateHash,
		RefCount: 2, State: meta.ContentBlobStateReady,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	duplicates, err := (&Server{DB: db}).queryDuplicateGroups(
		context.Background(), user.ID, 24,
	)
	if err != nil {
		t.Fatal(err)
	}
	if duplicates.TotalGroups != 1 ||
		duplicates.TotalItems != 2 ||
		duplicates.LogicalDuplicateBytes != 1000 ||
		duplicates.PhysicalReclaimableBytes != 0 ||
		len(duplicates.Groups) != 1 {
		t.Fatalf("duplicates=%+v", duplicates)
	}
	group := duplicates.Groups[0]
	if group.RecommendedKeepNodeID != dupB.ID ||
		group.PhysicalReclaimableBytes != 0 ||
		group.LogicalDuplicateBytes != 1000 ||
		group.AssetComparison != duplicateAssetIdentical ||
		group.AssetComparisonReason == "" || group.RecommendedKeepNodeID == 0 {
		t.Fatalf("duplicate group=%+v dupA=%d dupB=%d", group, dupA.ID, dupB.ID)
	}
	sha, ok := parseMediaDuplicateID(group.ID)
	if !ok {
		t.Fatalf("invalid duplicate id=%q", group.ID)
	}
	duplicatePage, err := (&Server{DB: db}).queryDuplicateItemRange(
		context.Background(), user.ID, sha, 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if duplicatePage.TotalCount != 2 || len(duplicatePage.Items) != 2 {
		t.Fatalf("duplicate page=%+v", duplicatePage)
	}
	// Server-owned verified folding must apply before range pagination, counts,
	// timeline groups and Viewer scopes; nothing is deleted or metadata-merged.
	server := &Server{DB: db}
	folds, err := server.buildVerifiedMediaFoldIndex(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := folds.members(dupA.ID); len(got) != 2 || got[0] != dupA.ID || got[1] != dupB.ID {
		t.Fatalf("verified fold members=%v", got)
	}
	foldedPage, err := server.queryMediaItemRange(
		context.Background(), user.ID, mediaQueryOptions{FoldDuplicates: true}, "", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if foldedPage.TotalCount != 1 || len(foldedPage.Items) != 1 ||
		len(foldedPage.Items[0].FoldMemberIDs) != 2 ||
		foldedPage.TimelineGroupSets == nil ||
		len(foldedPage.TimelineGroupSets.Day) != 1 ||
		foldedPage.TimelineGroupSets.Day[0].ItemCount != 1 {
		t.Fatalf("folded range/count/timeline inconsistent: %+v", foldedPage)
	}
	foldedNext, err := server.queryMediaItemRange(
		context.Background(), user.ID, mediaQueryOptions{FoldDuplicates: true}, "", 1, 1,
	)
	if err != nil || foldedNext.TotalCount != 1 || len(foldedNext.Items) != 0 {
		t.Fatalf("folded offset should not leak a hidden copy: %+v err=%v", foldedNext, err)
	}
	ranked := []uint64{dupB.ID, dupA.ID}
	if got := folds.foldRankedIDs(ranked); len(got) != 1 || got[0] != dupB.ID {
		t.Fatalf("semantic relevance must retain its highest-ranked in-group copy: %v", got)
	}
	// Semantic rank can choose a different representative from the chronological
	// ROW_NUMBER keeper. Explicit ranked IDs must still materialize faithfully,
	// while retaining the group's badge and member list.
	semanticItems, err := server.materializeMediaItemsByNodeIDs(
		context.Background(), user.ID,
		mediaQueryOptions{FoldDuplicates: true, foldIndex: folds},
		"", []uint64{dupA.ID},
	)
	if err != nil || len(semanticItems) != 1 ||
		semanticItems[0].Node.ID != dupA.ID ||
		len(semanticItems[0].FoldMemberIDs) != 2 {
		t.Fatalf("semantic rank member must survive SQL materialization: %+v err=%v", semanticItems, err)
	}
	unfoldedPage, err := server.queryMediaItemRange(
		context.Background(), user.ID, mediaQueryOptions{}, "", 100, 0,
	)
	if err != nil || unfoldedPage.TotalCount != 2 || len(unfoldedPage.Items) != 2 {
		t.Fatalf("default Gallery must preserve separate assets: page=%+v err=%v", unfoldedPage, err)
	}
	trueValue := true
	favoriteFold, err := server.queryMediaItemRange(
		context.Background(), user.ID,
		mediaQueryOptions{FoldDuplicates: true, Favorite: &trueValue}, "", 100, 0,
	)
	if err != nil || favoriteFold.TotalCount != 1 ||
		len(favoriteFold.Items) != 1 || favoriteFold.Items[0].Node.ID != dupB.ID {
		t.Fatalf("favorite filtering must select an in-scope keeper: %+v err=%v", favoriteFold, err)
	}
	// Album membership must be scoped before selecting the representative.
	// Files outside an album may share CAS bytes but must never replace an
	// in-album item as the visible/Viewer-backed representative.
	album := meta.PhotoCollection{
		OwnerID: user.ID, ExternalKey: "manual:verified-fold-test",
		Kind: meta.PhotoCollectionKindManual, Name: "独立副本",
		State: meta.PhotoCollectionStateActive, Revision: 1,
	}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoCollectionAsset{
		CollectionID: album.ID, AssetID: assetA.ID, Position: 0,
	}).Error; err != nil {
		t.Fatal(err)
	}
	albumSingle, err := server.queryMediaItemRange(
		context.Background(), user.ID,
		mediaQueryOptions{FoldDuplicates: true}, album.ExternalKey, 100, 0,
	)
	if err != nil || albumSingle.TotalCount != 1 ||
		len(albumSingle.Items) != 1 || albumSingle.Items[0].Node.ID != dupA.ID {
		t.Fatalf("album-only member must remain the visible representative: %+v err=%v", albumSingle, err)
	}
	if err := db.Create(&meta.PhotoCollectionAsset{
		CollectionID: album.ID, AssetID: assetB.ID, Position: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	albumFolded, err := server.queryMediaItemRange(
		context.Background(), user.ID,
		mediaQueryOptions{FoldDuplicates: true}, album.ExternalKey, 100, 0,
	)
	if err != nil || albumFolded.TotalCount != 1 || len(albumFolded.Items) != 1 {
		t.Fatalf("two album members must fold to one visible card: %+v err=%v", albumFolded, err)
	}
	var independentMemberships int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).Where(
		"collection_id = ?", album.ID,
	).Count(&independentMemberships).Error; err != nil {
		t.Fatal(err)
	}
	if independentMemberships != 2 {
		t.Fatalf("folding must not modify original album memberships: %d", independentMemberships)
	}
	membersPage, err := server.queryMediaItemRange(
		context.Background(), user.ID,
		mediaQueryOptions{FoldMemberIDs: []uint64{dupA.ID, dupB.ID}}, "", 100, 0,
	)
	if err != nil || membersPage.TotalCount != 2 || len(membersPage.Items) != 2 {
		t.Fatalf("expanded fold member range must expose both Nodes: %+v err=%v", membersPage, err)
	}
	if err := db.Create(&meta.PhotoEditRecipe{
		AssetID: assetB.ID, OwnerID: user.ID, SourceNodeID: dupB.ID,
		SourceNodeRevision: 1, SourceSHA256: duplicateHash,
		CropWidth: 0.75, CropHeight: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	withEdit, err := (&Server{DB: db}).queryDuplicateGroups(context.Background(), user.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	if len(withEdit.Groups) != 1 || withEdit.Groups[0].AssetComparison != duplicateAssetDifferent ||
		withEdit.Groups[0].RecommendedKeepNodeID != 0 {
		t.Fatalf("edited content incorrectly classified as identical: %+v", withEdit)
	}
	withDifferentRecipe, err := server.queryMediaItemRange(
		context.Background(), user.ID, mediaQueryOptions{FoldDuplicates: true}, "", 100, 0,
	)
	if err != nil || withDifferentRecipe.TotalCount != 2 {
		t.Fatalf("different edits must not fold: %+v err=%v", withDifferentRecipe, err)
	}

	burst := meta.MediaGroup{
		OwnerID:     user.ID,
		Kind:        meta.MediaGroupKindBurst,
		EvidenceKey: "apple-burst:test",
		CreatedAt:   now, UpdatedAt: now,
	}
	if err := db.Create(&burst).Error; err != nil {
		t.Fatal(err)
	}

	addBurstFrame := func(
		name, sha string,
		size int64,
		width, height, ordinal int,
		refCount int64,
	) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &root.ID, Name: name, Type: meta.NodeTypeFile,
			OwnerID: user.ID, Revision: 1,
			CreatedAt: now.Add(time.Duration(ordinal) * time.Second),
			UpdatedAt: now.Add(time.Duration(ordinal) * time.Second),
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, Size: size, StorageKey: "cas/" + sha, SHA256: sha,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: user.ID, NodeRevision: 1,
			SHA256: sha, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Width: width, Height: height, IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaGroupItem{
			GroupID: burst.ID, NodeID: node.ID,
			Role: meta.MediaGroupRoleAuxiliary, Ordinal: ordinal,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.ContentBlob{
			SHA256: sha, Size: size, StorageKey: "cas/" + sha,
			RefCount: refCount, State: meta.ContentBlobStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}

	frameA := addBurstFrame("burst-a.jpg", strings.Repeat("b", 64), 1200, 3000, 2000, 0, 1)
	frameB := addBurstFrame("burst-b.jpg", strings.Repeat("c", 64), 1500, 4000, 3000, 1, 1)
	frameC := addBurstFrame("burst-c.jpg", strings.Repeat("d", 64), 1300, 3000, 2000, 2, 2)

	reviews, err := (&Server{DB: db}).queryBurstReviews(
		context.Background(), user.ID, 24,
	)
	if err != nil {
		t.Fatal(err)
	}
	if reviews.TotalGroups != 1 || len(reviews.Groups) != 1 {
		t.Fatalf("burst reviews=%+v", reviews)
	}
	review := reviews.Groups[0]
	if review.RecommendedNodeID != frameB ||
		review.TotalBytes != 4000 ||
		review.PotentialCleanupBytes != 2500 ||
		review.PhysicalReclaimableBytes != 1200 {
		t.Fatalf(
			"burst review=%+v frames=%d,%d,%d",
			review, frameA, frameB, frameC,
		)
	}
	groupID, ok := parseMediaBurstReviewID(review.ID)
	if !ok || groupID != burst.ID {
		t.Fatalf("burst id=%q parsed=%d ok=%v", review.ID, groupID, ok)
	}
	burstPage, err := (&Server{DB: db}).queryBurstReviewItemRange(
		context.Background(), user.ID, groupID, 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if burstPage.TotalCount != 3 || len(burstPage.Items) != 3 ||
		burstPage.Items[0].Node.ID != frameA ||
		burstPage.Items[1].Node.ID != frameB ||
		burstPage.Items[2].Node.ID != frameC {
		t.Fatalf("burst page=%+v", burstPage)
	}
	// The landing page loads only 48 groups; all additional groups must remain
	// reachable through stable Server-side pagination (no client-side full scan).
	var deletedNodes []uint64
	for i := 0; i < 55; i++ {
		hash := fmt.Sprintf("%064x", i+4096)
		for copyIndex := 0; copyIndex < 2; copyIndex++ {
			node, _ := addLogicalMedia(
				fmt.Sprintf("extra-%d-%d.jpg", i, copyIndex),
				hash, int64(i+1000), 3000, 2000, false,
				now.Add(time.Duration(i)*time.Minute),
			)
			if i == 0 {
				deletedNodes = append(deletedNodes, node.ID)
			}
		}
	}
	const groupPageSize = 24
	seenGroupIDs := make(map[string]struct{})
	for offset := 0; offset < 56; offset += groupPageSize {
		page, err := (&Server{DB: db}).queryDuplicateGroups(
			context.Background(), user.ID, groupPageSize, offset,
		)
		if err != nil {
			t.Fatal(err)
		}
		if page.Offset != offset || page.TotalGroups != 56 ||
			page.HasMore != (offset+len(page.Groups) < 56) {
			t.Fatalf("duplicate group page offset=%d result=%+v", offset, page)
		}
		for _, row := range page.Groups {
			if _, exists := seenGroupIDs[row.ID]; exists {
				t.Fatalf("duplicate group repeated across pages: %s", row.ID)
			}
			seenGroupIDs[row.ID] = struct{}{}
		}
	}
	if len(seenGroupIDs) != 56 {
		t.Fatalf("only %d of 56 duplicate groups reachable", len(seenGroupIDs))
	}
	if err := db.Model(&meta.Node{}).
		Where("id IN ? AND owner_id = ?", deletedNodes, user.ID).
		Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	afterDelete, err := (&Server{DB: db}).queryDuplicateGroups(
		context.Background(), user.ID, groupPageSize, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if afterDelete.TotalGroups != 55 || afterDelete.Offset != 0 {
		t.Fatalf("deleted group still counted after refresh: %+v", afterDelete)
	}
	burstPastEnd, err := (&Server{DB: db}).queryBurstReviews(
		context.Background(), user.ID, groupPageSize, 1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if burstPastEnd.TotalGroups != 1 || burstPastEnd.HasMore || len(burstPastEnd.Groups) != 0 {
		t.Fatalf("burst page past end: %+v", burstPastEnd)
	}

}
