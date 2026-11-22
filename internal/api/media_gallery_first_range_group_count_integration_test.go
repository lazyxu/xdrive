package api

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A first Gallery Range must report the same exact Owner-bound count as the
// original independent DISTINCT query, even with filters, missing dates,
// albums, tombstones, timezone/sort variants, and subsequent sparse paging.
func TestMediaGalleryFirstRangeGroupedCountMatchesIndependentCount(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoAssetOccurrence{},
		&meta.PhotoAssetIdentityAlias{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoEditRecipe{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	owners := []meta.User{
		{Username: "grouped-count-a", PasswordHash: "unused", Role: meta.UserRoleUser},
		{Username: "grouped-count-b", PasswordHash: "unused", Role: meta.UserRoleUser},
	}
	if err := db.Create(&owners).Error; err != nil {
		t.Fatal(err)
	}
	album := meta.PhotoCollection{
		OwnerID: owners[0].ID, ExternalKey: "manual:grouped-count",
		Kind: meta.PhotoCollectionKindManual, Name: "Count audit",
		State: meta.PhotoCollectionStateActive, Revision: 1,
	}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 3, 8, 1, 30, 0, 0, time.UTC)
	ownerNodeIDs := make([]uint64, 0, 30)
	ownerByNodeID := make(map[uint64]uint64, 56)
	for ownerIndex, owner := range owners {
		for i := 0; i < 28; i++ {
			name := fmt.Sprintf("owner%d-photo-%02d.jpg", ownerIndex, i)
			if i%7 == 1 {
				name = fmt.Sprintf("owner%d-video-%02d.mp4", ownerIndex, i)
			}
			added := start.Add(time.Duration(i/4) * 24 * time.Hour)
			node := meta.Node{
				OwnerID: owner.ID, Type: meta.NodeTypeFile,
				Name: name, Revision: 1, CreatedAt: added,
			}
			if i == 26 {
				deleted := time.Now().UTC()
				node.DeletedAt = &deleted
			}
			if err := db.Create(&node).Error; err != nil {
				t.Fatal(err)
			}
			ownerByNodeID[node.ID] = owner.ID
			if ownerIndex == 0 {
				ownerNodeIDs = append(ownerNodeIDs, node.ID)
			}
			file := meta.File{
				NodeID: node.ID, Size: 1024,
				StorageKey: fmt.Sprintf("fixture/%d/%d", owner.ID, node.ID),
				SHA256:     fmt.Sprintf("%064x", node.ID),
			}
			if err := db.Create(&file).Error; err != nil {
				t.Fatal(err)
			}
			kind := meta.MediaKindImage
			if i%7 == 1 {
				kind = meta.MediaKindVideo
			}
			if i == 27 {
				kind = meta.MediaKindOther
			}
			var captured *time.Time
			if i%6 != 0 {
				value := start.Add(time.Duration(i/3) * 24 * time.Hour)
				captured = &value
			}
			metadata := meta.MediaMetadata{
				NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
				SHA256: file.SHA256, MediaKind: kind, CapturedAt: captured,
				IndexState: meta.MediaIndexStateReady,
			}
			if err := db.Create(&metadata).Error; err != nil {
				t.Fatal(err)
			}
			asset := meta.PhotoAsset{
				OwnerID: owner.ID, PrimaryNodeID: node.ID,
				Kind: kind, EvidenceKey: fmt.Sprintf("grouped-%d-%d", owner.ID, i),
			}
			if err := db.Create(&asset).Error; err != nil {
				t.Fatal(err)
			}
			tags := "[]"
			if i%5 == 0 {
				tags = "[\"sun\"]"
			}
			photo := meta.PhotoMetadata{
				AssetID: asset.ID, MediaKind: kind, CapturedAt: captured,
				Favorite: i%2 == 0, TagsJSON: tags,
			}
			if err := db.Create(&photo).Error; err != nil {
				t.Fatal(err)
			}
			if ownerIndex == 0 && i%3 == 0 {
				member := meta.PhotoCollectionAsset{
					CollectionID: album.ID, AssetID: asset.ID, Position: int64(i),
				}
				if err := db.Create(&member).Error; err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	server := &Server{DB: db}
	ctx := context.Background()
	favorite, notFavorite := true, false
	from := start.Add(2 * 24 * time.Hour)
	until := start.Add(7 * 24 * time.Hour)
	cases := []struct {
		name     string
		owner    uint64
		options  mediaQueryOptions
		albumKey string
	}{
		{"all", owners[0].ID, mediaQueryOptions{}, ""},
		{"other-owner", owners[1].ID, mediaQueryOptions{}, ""},
		{"favorite", owners[0].ID, mediaQueryOptions{Favorite: &favorite}, ""},
		{"not-favorite", owners[0].ID, mediaQueryOptions{Favorite: &notFavorite}, ""},
		{"video", owners[0].ID, mediaQueryOptions{MediaKind: meta.MediaKindVideo}, ""},
		{"image", owners[0].ID, mediaQueryOptions{MediaKind: meta.MediaKindImage}, ""},
		{"tag", owners[0].ID, mediaQueryOptions{Tag: "sun"}, ""},
		{"tag-empty", owners[0].ID, mediaQueryOptions{Tag: "not-present"}, ""},
		{"captured-range", owners[0].ID, mediaQueryOptions{CapturedFrom: &from, CapturedTo: &until}, ""},
		{"sort-added", owners[0].ID, mediaQueryOptions{SortBy: "added", SortDir: "asc"}, ""},
		{"unknown-first", owners[0].ID, mediaQueryOptions{SortDir: "asc", UnknownFirst: true}, ""},
		{"time-zone-la", owners[0].ID, mediaQueryOptions{SortDir: "desc", TimeZone: "America/Los_Angeles"}, ""},
		{"time-zone-shanghai", owners[0].ID, mediaQueryOptions{SortBy: "added", SortDir: "asc", TimeZone: "Asia/Shanghai"}, ""},
		{"single-node", owners[0].ID, mediaQueryOptions{FoldMemberIDs: []uint64{ownerNodeIDs[2]}}, ""},
		{"album", owners[0].ID, mediaQueryOptions{}, album.ExternalKey},
		{"album-favorite", owners[0].ID, mediaQueryOptions{Favorite: &favorite}, album.ExternalKey},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			query, err := server.mediaItemsBaseQuery(ctx, tc.owner, tc.options, tc.albumKey)
			if err != nil {
				t.Fatal(err)
			}
			var independent int64
			if err := query.Session(&gorm.Session{}).
				Distinct("xd_media_metadata.node_id").
				Count(&independent).Error; err != nil {
				t.Fatal(err)
			}
			const limit = 4
			first, err := server.queryMediaItemRange(ctx, tc.owner, tc.options, tc.albumKey, limit, 0)
			if err != nil {
				t.Fatal(err)
			}
			if first.TotalCount != independent || first.TimelineGroupSets == nil {
				t.Fatalf("first Range total=%d original DISTINCT=%d groups=%+v",
					first.TotalCount, independent, first.TimelineGroupSets)
			}
			var sum int64
			for _, day := range first.TimelineGroupSets.Day {
				if day.ItemCount <= 0 || day.StartIndex != sum {
					t.Fatalf("invalid day group %+v after %d", day, sum)
				}
				sum += day.ItemCount
			}
			if sum != independent {
				t.Fatalf("day groups sum=%d original DISTINCT=%d", sum, independent)
			}
			for _, item := range first.Items {
				if ownerByNodeID[item.Node.ID] != tc.owner {
					t.Fatalf("foreign Owner node leaked: node=%d expected Owner=%d", item.Node.ID, tc.owner)
				}
			}
			later, err := server.queryMediaItemRange(ctx, tc.owner, tc.options, tc.albumKey, limit, limit)
			if err != nil {
				t.Fatal(err)
			}
			if later.TotalCount != independent {
				t.Fatalf("later sparse total=%d original DISTINCT=%d", later.TotalCount, independent)
			}
			if later.TimelineGroupSets != nil {
				t.Fatal("later sparse page must not redo day grouping")
			}
		})
	}
}
