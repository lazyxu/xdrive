package api

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func mobileGalleryTailDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires XD_TEST_DATABASE_URL for owner-scoped Postgres media queries")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.MediaDerivedResource{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestMobileGalleryTailSparsePageAndUnknownDatePostgres(t *testing.T) {
	db := mobileGalleryTailDatabase(t)
	user := meta.User{Username: "mobile-tail-collection", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "Mobile Gallery", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	// Deliberately interleave unknown, early, late and equal-date assets.
	captured := []*time.Time{
		nil, nil,
		mobileTestDate(2025, 1, 2), mobileTestDate(2025, 3, 2),
		mobileTestDate(2026, 4, 1), mobileTestDate(2026, 4, 2),
		mobileTestDate(2026, 4, 3),
	}
	nodeIDs := make([]uint64, 0, len(captured))
	for i, date := range captured {
		node := meta.Node{
			Name: fmt.Sprintf("photo-%02d.jpg", i), OwnerID: user.ID, ParentID: &root.ID,
			Type: meta.NodeTypeFile, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		nodeIDs = append(nodeIDs, node.ID)
		if err := db.Create(&meta.File{NodeID: node.ID, Size: 1, SHA256: fmt.Sprintf("%064d", i+1),
			StorageKey: fmt.Sprintf("test/mobile/%d", i)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{NodeID: node.ID, OwnerID: user.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", IndexState: meta.MediaIndexStateReady, CapturedAt: date}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: user.ID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("mobile-tail:%d", i)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			CapturedAt: date}).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{DB: db}
	options := mediaQueryOptions{SortBy: "captured", SortDir: "asc", UnknownFirst: true,
		InitialPosition: "latest", TimeZone: "UTC"}
	page, err := s.queryMediaItemRange(context.Background(), user.ID, options, "", 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 7 || page.Offset != 4 || len(page.Items) != 3 ||
		page.AnchorIndex == nil || *page.AnchorIndex != 6 {
		t.Fatalf("tail offset/anchor inconsistent: count=%d offset=%d size=%d anchor=%v",
			page.TotalCount, page.Offset, len(page.Items), page.AnchorIndex)
	}
	for i, want := range []string{"photo-04.jpg", "photo-05.jpg", "photo-06.jpg"} {
		if page.Items[i].Node.Name != want {
			t.Fatalf("tail item[%d]=%q want=%q", i, page.Items[i].Node.Name, want)
		}
	}
	groups := page.TimelineGroupSets
	if groups == nil || len(groups.Day) < 2 ||
		groups.Day[0].Key != "unknown" || groups.Day[0].StartIndex != 0 ||
		groups.Day[len(groups.Day)-1].Key != "2026-04-03" {
		t.Fatalf("mobile unknown-date and newest-day ordering=%+v", groups)
	}
	options.InitialPosition = ""
	first, err := s.queryMediaItemRange(context.Background(), user.ID, options, "", 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	if first.Offset != 0 || len(first.Items) != 4 || first.Items[0].Metadata.CapturedAt != nil {
		t.Fatalf("normal offset=0 must still load the first page: offset=%d items=%+v", first.Offset, first.Items)
	}
	// Simulate a new photo arriving while the user is reading an older date.
	// An explicitly restored visible Node must keep its logical index rather
	// than being replaced with the new tail end on refresh/app re-entry.
	newCapture := mobileTestDate(2026, 5, 10)
	incoming := meta.Node{OwnerID: user.ID, ParentID: &root.ID,
		Name: "later-arrival.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&incoming).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: incoming.ID, Size: 1,
		SHA256:     fmt.Sprintf("%064d", 99),
		StorageKey: "test/mobile/later"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{NodeID: incoming.ID, OwnerID: user.ID,
		NodeRevision: 1, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		IndexState: meta.MediaIndexStateReady, CapturedAt: newCapture}).Error; err != nil {
		t.Fatal(err)
	}
	newAsset := meta.PhotoAsset{OwnerID: user.ID, PrimaryNodeID: incoming.ID,
		Kind: meta.PhotoAssetKindImage, EvidenceKey: "mobile-tail:later"}
	if err := db.Create(&newAsset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoMetadata{AssetID: newAsset.ID,
		MediaKind: meta.MediaKindImage, CapturedAt: newCapture}).Error; err != nil {
		t.Fatal(err)
	}
	options.AnchorNodeID = nodeIDs[3]
	options.InitialPosition = ""
	restored, err := s.queryMediaItemRange(context.Background(), user.ID, options, "", 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	if restored.TotalCount != 8 || restored.AnchorIndex == nil ||
		*restored.AnchorIndex != 3 || restored.Offset != 0 {
		t.Fatalf("new arrival changed older browsing anchor: total=%d anchor=%v offset=%d",
			restored.TotalCount, restored.AnchorIndex, restored.Offset)
	}
	options.AnchorNodeID = 0

	wide := mediaQueryOptions{SortBy: "captured", SortDir: "desc", TimeZone: "UTC"}
	widePage, err := s.queryMediaItemRange(context.Background(), user.ID, wide, "", 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	if widePage.Offset != 0 || widePage.Items[0].Node.Name != "later-arrival.jpg" {
		t.Fatalf("wide old newest-first ordering changed: offset=%d item=%+v", widePage.Offset, widePage.Items[0])
	}
}

func mobileTestDate(year int, month time.Month, day int) *time.Time {
	value := time.Date(year, month, day, 12, 0, 0, 0, time.UTC)
	return &value
}

// The fixture is the repository's 100k logical-photo / 115k physical-node
// Gallery seed. This test is opt-in and records actual PostgreSQL timings;
// it must never be replaced by a fake JS array or list-all loop.
func TestMobileGalleryTailReal100K(t *testing.T) {
	if os.Getenv("XD_MOBILE_GALLERY_TAIL_100K") != "1" {
		t.Skip("opt in to the real 100k sparse-tail PostgreSQL test")
	}
	db := mobileGalleryTailDatabase(t)
	user := meta.User{Username: "mobile-tail-100k", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "100k Mobile Gallery", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, user.ID, root.ID)
	seedDuration := time.Since(seedStart)
	s := &Server{DB: db}
	options := mediaQueryOptions{SortBy: "captured", SortDir: "asc", UnknownFirst: true, TimeZone: "UTC"}
	// Alternate on the same warmed PostgreSQL fixture to compare the same
	// owner/query/pageSize with a repeatable median rather than one noisy run.
	const samples = 3
	beforeMS := make([]float64, 0, samples)
	afterMS := make([]float64, 0, samples)
	var normal, tail mediaItemRangeDTO
	for sample := 0; sample < samples; sample++ {
		options.InitialPosition = ""
		start := time.Now()
		var err error
		normal, err = s.queryMediaItemRange(context.Background(), user.ID, options, "", 100, 0)
		if err != nil {
			t.Fatal(err)
		}
		beforeMS = append(beforeMS, float64(time.Since(start).Microseconds())/1000)
		options.InitialPosition = "latest"
		start = time.Now()
		tail, err = s.queryMediaItemRange(context.Background(), user.ID, options, "", 100, 0)
		if err != nil {
			t.Fatal(err)
		}
		afterMS = append(afterMS, float64(time.Since(start).Microseconds())/1000)
	}
	sort.Float64s(beforeMS)
	sort.Float64s(afterMS)
	if tail.TotalCount != 100_000 || tail.Offset != 99_900 ||
		len(tail.Items) != 100 || tail.AnchorIndex == nil || *tail.AnchorIndex != 99_999 {
		t.Fatalf("real 100k first-page contract: count=%d offset=%d items=%d anchor=%v",
			tail.TotalCount, tail.Offset, len(tail.Items), tail.AnchorIndex)
	}
	if normal.Offset != 0 || len(normal.Items) != 100 {
		t.Fatalf("regular range changed: offset=%d items=%d", normal.Offset, len(normal.Items))
	}
	t.Logf("MOBILE_GALLERY_TAIL_REAL_100K samples=%d seed_ms=%.3f first_normal_p50_ms=%.3f first_tail_p50_ms=%.3f total=%d offset=%d returned=%d",
		samples,
		float64(seedDuration.Microseconds())/1000,
		beforeMS[samples/2], afterMS[samples/2],
		tail.TotalCount, tail.Offset, len(tail.Items))
}
