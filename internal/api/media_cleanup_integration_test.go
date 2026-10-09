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
	dupA, _ := addLogicalMedia(
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
}
