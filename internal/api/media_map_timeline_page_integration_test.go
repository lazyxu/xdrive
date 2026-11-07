package api

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestMediaMapTimelineFirstPageMatchesUnrestrictedSort(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	if err := db.AutoMigrate(&meta.MediaMetadata{}, &meta.PhotoMetadata{}, &meta.PhotoEditRecipe{}, &meta.BaiduPhotoMapPosition{}, &meta.MediaGroup{}, &meta.MediaGroupItem{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "map-timeline-owner", PasswordHash: "unused", Role: meta.UserRoleUser}
	foreign := meta.User{Username: "map-timeline-foreign", PasswordHash: "unused", Role: meta.UserRoleUser}
	for _, user := range []*meta.User{&owner, &foreign} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	start := time.Date(2026, 3, 6, 3, 30, 0, 0, time.UTC)
	for _, user := range []meta.User{owner, foreign} {
		for i := 0; i < 24; i++ {
			node := meta.Node{OwnerID: user.ID, Type: meta.NodeTypeFile, Name: fmt.Sprintf("photo-%d.jpg", i), Revision: 1, CreatedAt: start.AddDate(0, 0, i/4)}
			if err := db.Create(&node).Error; err != nil {
				t.Fatal(err)
			}
			lat, lng := 30.0, 120.0
			captured := start.AddDate(0, 0, i/3)
			metadata := meta.MediaMetadata{NodeID: node.ID, OwnerID: user.ID, NodeRevision: 1, MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady, Latitude: &lat, Longitude: &lng, CapturedAt: &captured}
			if i >= 21 {
				metadata.CapturedAt = nil
			}
			if err := db.Create(&metadata).Error; err != nil {
				t.Fatal(err)
			}
			asset := meta.PhotoAsset{OwnerID: user.ID, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("timeline-%d", i)}
			if err := db.Create(&asset).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage}).Error; err != nil {
				t.Fatal(err)
			}
			position := meta.BaiduPhotoMapPosition{AssetID: asset.ID, OwnerID: user.ID, PrimaryNodeID: node.ID, NodeRevision: 1, MediaUpdatedAt: metadata.UpdatedAt, SourceLatitude: lat, SourceLongitude: lng, Latitude: 30.01, Longitude: 120.01, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL, ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2}
			if err := db.Create(&position).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	bounds := baiduPhotoMapBounds{West: 119, East: 121, South: 29, North: 31, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	for _, limit := range []int{2, 5} {
		for _, options := range []mediaQueryOptions{
			{SortDir: "desc"}, {SortDir: "asc"}, {SortDir: "asc", UnknownFirst: true},
			{SortBy: "added", SortDir: "asc"}, {SortBy: "added", SortDir: "desc"},
			{SortDir: "asc", TimeZone: "America/New_York"}, {SortDir: "desc", TimeZone: "Asia/Shanghai"},
		} {
			t.Run(fmt.Sprintf("%s-%s-unknown%t-%s-limit%d", options.SortBy, options.SortDir, options.UnknownFirst, options.TimeZone, limit), func(t *testing.T) {
				options.BaiduViewport = &bounds
				base, err := (&Server{DB: db}).mediaItemsBaseQuery(context.Background(), owner.ID, options, "")
				if err != nil {
					t.Fatal(err)
				}
				sets, err := queryMediaTimelineGroupSets(base, options)
				if err != nil {
					t.Fatal(err)
				}
				var total int64
				for _, day := range sets.Day {
					total += day.ItemCount
				}
				if total != 24 {
					t.Fatalf("Owner group total = %d", total)
				}
				page := func(query *gorm.DB, offset int) []uint64 {
					t.Helper()
					query = query.Session(&gorm.Session{})
					for _, clause := range mediaGallerySortClauses(options) {
						query = query.Order(clause)
					}
					var ids []uint64
					if err := query.Limit(limit).Offset(offset).Pluck("n.id", &ids).Error; err != nil {
						t.Fatal(err)
					}
					return ids
				}
				want := page(base, 0)
				narrow, applied := mediaFirstPageTimelineQuery(base, options, sets, total, limit)
				if !applied {
					t.Fatal("leading range was not narrowed")
				}
				got := page(narrow, 0)
				if len(got) != limit || !reflect.DeepEqual(got, want) {
					t.Fatalf("narrow first page %v, unrestricted %v", got, want)
				}
				var candidates int64
				if err := narrow.Session(&gorm.Session{}).Distinct("n.id").Count(&candidates).Error; err != nil {
					t.Fatal(err)
				}
				if candidates < int64(limit) || candidates >= total {
					t.Fatalf("date narrowing did not reduce eligible sort rows: %d", candidates)
				}
				// The base scope remains usable for the next independent sparse page.
				next := page(base, limit)
				if len(next) != limit {
					t.Fatalf("base query was mutated: %v", next)
				}
				for _, id := range next {
					for _, seen := range got {
						if id == seen {
							t.Fatal("sparse pages overlap")
						}
					}
				}
			})
		}
	}
	t.Run("concurrent-removal-refills-once-from-current-owner-scope", func(t *testing.T) {
		// The grouped count sees the latest two days (six nodes). Remove those
		// references just before the bounded page read, as a concurrent request
		// could, then require the complete next five current Owner nodes.
		var remaining []uint64
		if err := db.Table("xd_media_metadata AS mm").Select("mm.node_id").
			Where("mm.owner_id = ? AND mm.captured_at < ?", owner.ID, start.AddDate(0, 0, 5)).
			Order("mm.captured_at DESC, mm.node_id DESC").Limit(5).Scan(&remaining).Error; err != nil {
			t.Fatal(err)
		}
		pageReads := 0
		callback := "test:remove-leading-map-range"
		if err := db.Callback().Query().Before("gorm:query").Register(callback, func(tx *gorm.DB) {
			selection, ok := tx.Statement.Clauses["SELECT"].Expression.(clause.Select)
			if !ok || len(selection.Columns) != 1 || selection.Columns[0].Name != "xd_media_metadata.node_id" {
				return
			}
			pageReads++
			if pageReads != 1 {
				return
			}
			remove := db.Model(&meta.Node{}).Where("owner_id = ? AND id IN (?)", owner.ID,
				db.Model(&meta.MediaMetadata{}).Select("node_id").Where("owner_id = ? AND captured_at >= ?", owner.ID, start.AddDate(0, 0, 5))).
				Update("deleted_at", time.Now())
			if remove.Error != nil || remove.RowsAffected != 6 {
				t.Fatalf("remove leading references: %d, %v", remove.RowsAffected, remove.Error)
			}
		}); err != nil {
			t.Fatal(err)
		}
		defer db.Callback().Query().Remove(callback)
		page, err := (&Server{DB: db}).queryMediaItemRange(context.Background(), owner.ID,
			mediaQueryOptions{SortDir: "desc", BaiduViewport: &bounds}, "", 5, 0)
		if err != nil {
			t.Fatal(err)
		}
		var got []uint64
		for _, item := range page.Items {
			got = append(got, item.Node.ID)
		}
		if pageReads != 2 || len(got) != 5 || !reflect.DeepEqual(got, remaining) {
			t.Fatalf("expected one bounded retry and current Owner page %v; got %v (%d reads)", remaining, got, pageReads)
		}
	})
}
