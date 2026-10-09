package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type galleryFoldStageMeasurement struct {
	Name       string  `json:"name"`
	ElapsedMS  float64 `json:"elapsed_ms"`
	AllocatedB uint64  `json:"allocated_bytes"`
}

type galleryFoldStageSample struct {
	Sample         int                           `json:"sample"`
	Stages         []galleryFoldStageMeasurement `json:"stages"`
	SplitTotalMS   float64                       `json:"split_total_ms"`
	FoldedVisible  int64                         `json:"folded_visible"`
	ReturnedItems  int                           `json:"returned_items"`
	FoldIndexNodes int                           `json:"fold_index_nodes"`
	TimelineDays   int                           `json:"timeline_days"`
}

type galleryFoldStageReport struct {
	Workload           string                   `json:"workload"`
	LogicalAssets      int                      `json:"logical_assets"`
	PhysicalMediaNodes int                      `json:"physical_media_nodes"`
	LiveGroups         int                      `json:"live_photo_groups"`
	DuplicateGroups    int                      `json:"duplicate_groups"`
	FoldedVisible      int64                    `json:"folded_visible"`
	SeedMS             float64                  `json:"seed_ms"`
	ProductionON       []float64                `json:"production_on_ms"`
	ProductionOFF      []float64                `json:"production_off_ms"`
	ProductionONP50    float64                  `json:"production_on_p50_ms"`
	ProductionOFFP50   float64                  `json:"production_off_p50_ms"`
	Split              []galleryFoldStageSample `json:"split"`
	Scope              string                   `json:"scope"`
}

// TestGalleryFoldStagesPerformance100K isolates each production Server query
// stage against the same 100k/115k/15k-Live + 2000-group SQL fixture as the
// already-merged actual Web ON/OFF benchmark (#1178). It is measurement-only:
// the production query, resource/recipe identity and cache policies are intact.
func TestGalleryFoldStagesPerformance100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_FOLD_STAGE_PERF") != "1" {
		t.Skip("set XD_GALLERY_FOLD_STAGE_PERF=1 for 100k SQL stage attribution")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("native PostgreSQL database URL required for real 100k profiling")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:     "gallery-fold-stage-profile-100k",
		PasswordHash: "unused-performance-fixture",
		Role:         meta.UserRoleUser,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		Name:     "Gallery fold 100k SQL stage profile",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	startedSeed := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, user.ID, folder.ID)
	server := &Server{DB: db}
	initial, err := server.queryMediaItemRange(
		context.Background(), user.ID, mediaQueryOptions{}, "", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if initial.TotalCount != mediaGalleryFirstOpenLogicalCount || len(initial.Items) != 100 {
		t.Fatalf("base 100k sparse range invalid total=%d rows=%d",
			initial.TotalCount, len(initial.Items))
	}
	galleryRealWebFoldSeed100K(t, db, user.ID, initial.Items)
	seedMS := float64(time.Since(startedSeed).Microseconds()) / 1000
	report := galleryFoldStageReport{
		Workload:           "real-browser-equivalent-100k-fold-sql-stage-profile",
		LogicalAssets:      100000,
		PhysicalMediaNodes: 115000,
		LiveGroups:         15000,
		DuplicateGroups:    galleryRealWebFoldGroups,
		FoldedVisible:      galleryRealWebFoldVisible,
		SeedMS:             seedMS,
		ProductionON:       make([]float64, 0, 3),
		ProductionOFF:      make([]float64, 0, 3),
		Split:              make([]galleryFoldStageSample, 0, 3),
		Scope:              "Native PostgreSQL 17 actual production Go fold index/count/timeline/materialize. No Chromium, HTTP, decoder, WAN, GPU or source-byte verification for synthetic offscreen SHA groups.",
	}
	runProduction := func(options mediaQueryOptions, expected int64) float64 {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		start := time.Now()
		result, err := server.queryMediaItemRange(ctx, user.ID, options, "", 100, 0)
		elapsed := float64(time.Since(start).Microseconds()) / 1000
		if err != nil {
			t.Fatal(err)
		}
		if result.TotalCount != expected || len(result.Items) != 100 ||
			result.TimelineGroupSets == nil {
			t.Fatalf("wrong 100k fold production range total=%d expected=%d rows=%d groups=%t",
				result.TotalCount, expected, len(result.Items), result.TimelineGroupSets != nil)
		}
		return elapsed
	}
	for sampleID := 1; sampleID <= 3; sampleID++ {
		// Reverse ordering for sample 2 to avoid calling the cheaper OFF path
		// first every time. These are sequential successful production calls.
		var onMS, offMS float64
		if sampleID%2 == 0 {
			onMS = runProduction(mediaQueryOptions{FoldDuplicates: true}, galleryRealWebFoldVisible)
			offMS = runProduction(mediaQueryOptions{}, mediaGalleryFirstOpenLogicalCount)
		} else {
			offMS = runProduction(mediaQueryOptions{}, mediaGalleryFirstOpenLogicalCount)
			onMS = runProduction(mediaQueryOptions{FoldDuplicates: true}, galleryRealWebFoldVisible)
		}
		report.ProductionON = append(report.ProductionON, onMS)
		report.ProductionOFF = append(report.ProductionOFF, offMS)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		sample := galleryFoldStageSample{Sample: sampleID}
		record := func(name string, action func() error) {
			t.Helper()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			start := time.Now()
			err := action()
			duration := float64(time.Since(start).Microseconds()) / 1000
			runtime.ReadMemStats(&after)
			if err != nil {
				t.Fatalf("fold stage %s sample %d: %v", name, sampleID, err)
			}
			sample.Stages = append(sample.Stages, galleryFoldStageMeasurement{
				Name:       name,
				ElapsedMS:  duration,
				AllocatedB: after.TotalAlloc - before.TotalAlloc,
			})
			sample.SplitTotalMS += duration
		}
		var options mediaQueryOptions
		record("verified_full_resource_index", func() error {
			var err error
			options, err = server.prepareVerifiedMediaFolding(
				ctx, user.ID, mediaQueryOptions{FoldDuplicates: true},
			)
			return err
		})
		if options.foldIndex == nil {
			t.Fatal("fold index was not built")
		}
		if len(options.foldIndex.ByNode) != galleryRealWebFoldMembers {
			t.Fatalf("fold index includes %d nodes, want %d",
				len(options.foldIndex.ByNode), galleryRealWebFoldMembers)
		}
		sample.FoldIndexNodes = len(options.foldIndex.ByNode)
		var query *gorm.DB
		record("build_filtered_ranked_sql", func() error {
			var err error
			query, err = server.mediaItemsBaseQuery(ctx, user.ID, options, "")
			return err
		})
		record("authoritative_distinct_count", func() error {
			return query.Session(&gorm.Session{}).
				Distinct("xd_media_metadata.node_id").
				Count(&sample.FoldedVisible).Error
		})
		if sample.FoldedVisible != galleryRealWebFoldVisible {
			t.Fatalf("folded count=%d want=%d",
				sample.FoldedVisible, galleryRealWebFoldVisible)
		}
		var sets mediaTimelineGroupSetsDTO
		record("full_timeline_group_sets", func() error {
			var err error
			sets, err = queryMediaTimelineGroupSets(query, options)
			return err
		})
		sample.TimelineDays = len(sets.Day)
		if sample.TimelineDays == 0 {
			t.Fatal("folded first-page timeline day groups missing")
		}
		var items []mediaItemDTO
		record("first_100_materialize", func() error {
			var err error
			items, err = server.materializeMediaItems(ctx, user.ID, query, 100, 0, options)
			return err
		})
		sample.ReturnedItems = len(items)
		if sample.ReturnedItems != 100 {
			t.Fatalf("folded first range rows=%d", len(items))
		}
		cancel()
		report.Split = append(report.Split, sample)
		t.Logf("GALLERY_FOLD_STAGE_SAMPLE sample=%d on_ms=%.3f off_ms=%.3f stages=%+v",
			sampleID, onMS, offMS, sample.Stages)
	}
	a := append([]float64(nil), report.ProductionON...)
	b := append([]float64(nil), report.ProductionOFF...)
	sort.Float64s(a)
	sort.Float64s(b)
	report.ProductionONP50 = a[1]
	report.ProductionOFFP50 = b[1]
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_FOLD_STAGE_100K_REPORT %s", encoded)
	fmt.Printf("GALLERY_FOLD_STAGE_100K_REPORT %s\n", encoded)
}
