package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The same production Gallery queries are run with and without the explicit
// folding option. This is a Server/PostgreSQL benchmark, not a UI render proxy.
type galleryFoldPerfPhase struct {
	Name         string    `json:"name"`
	ValuesMS     []float64 `json:"samples_ms"`
	MedianMS     float64   `json:"median_ms"`
	Rows         int64     `json:"rows"`
	VisibleCount int64     `json:"visible_count"`
	HasError     bool      `json:"has_error"`
	Error        string    `json:"error,omitempty"`
}
type galleryFoldPerfReport struct {
	Workload           string                 `json:"workload"`
	LogicalAssets      int                    `json:"logical_assets"`
	PhysicalMediaNodes int                    `json:"physical_media_nodes"`
	IdenticalGroups    int                    `json:"identical_groups"`
	IdenticalAssets    int                    `json:"identical_assets"`
	ExpectedVisible    int                    `json:"expected_visible"`
	SamplesPerPhase    int                    `json:"samples_per_phase"`
	SeedMS             float64                `json:"seed_ms"`
	Phases             []galleryFoldPerfPhase `json:"phases"`
	Scope              string                 `json:"scope"`
}

func TestGalleryVerifiedFoldPerformance10K100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_FOLD_PERF") != "1" {
		t.Skip("set XD_GALLERY_FOLD_PERF=1 to measure verified Gallery folds at 10k and 100k")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	for _, logicalCount := range []int{10_000, 100_000} {
		t.Run(fmt.Sprintf("%dk", logicalCount/1000), func(t *testing.T) {
			galleryVerifiedFoldMeasureScale(t, dsn, logicalCount)
		})
	}
}

func galleryVerifiedFoldMeasureScale(t *testing.T, dsn string, logicalCount int) {
	t.Helper()
	db := fileExplorerMediaPerfDatabase(t, dsn)
	// SQL logs must not inline the full 10k-member JSON map into CI output.
	// Keep errors visible; do not affect production logging or measurement SQL.
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Error)})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: fmt.Sprintf("gallery-fold-%d", logicalCount), PasswordHash: "test", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{Name: "Gallery fold benchmark", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	seedStarted := time.Now()
	mediaGallerySeedFirstOpenScaled(t, db, user.ID, folder.ID, logicalCount)
	groups := logicalCount / 50
	foldMembers := groups * 5
	// 10% JPEG nodes share five bytes-identical original representations per group.
	// Keep File, MediaMetadata and PhotoResource digests mutually consistent.
	if err := db.Exec(`UPDATE xd_files AS f
SET sha256 = lpad(to_hex(900000000 + ((substring(n.name from 7 for 6)::integer - 1) % ?)), 64, '0')
FROM xd_nodes AS n WHERE f.node_id = n.id AND n.owner_id = ?
AND n.name LIKE 'photo-%' AND substring(n.name from 7 for 6)::integer <= ?`,
		groups, user.ID, foldMembers).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE xd_media_metadata AS mm SET sha256 = f.sha256
FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
WHERE mm.node_id = n.id AND n.owner_id = ? AND n.name LIKE 'photo-%'
AND substring(n.name from 7 for 6)::integer <= ?`, user.ID, foldMembers).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`UPDATE xd_photo_resources AS r SET sha256 = f.sha256
FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
WHERE r.node_id = n.id AND n.owner_id = ? AND n.name LIKE 'photo-%'
AND substring(n.name from 7 for 6)::integer <= ?`, user.ID, foldMembers).Error; err != nil {
		t.Fatal(err)
	}
	// Favorite is only the first independent copy of each of the identical
	// groups, not the (possibly different) default chronological representative.
	if err := db.Exec(`UPDATE xd_photo_metadata AS pm SET favorite = true
FROM xd_photo_assets AS a JOIN xd_nodes AS n ON n.id = a.primary_node_id
WHERE pm.asset_id = a.id AND a.owner_id = ? AND n.name LIKE 'photo-%'
AND substring(n.name from 7 for 6)::integer <= ?`, user.ID, groups).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_files", "xd_nodes", "xd_photo_assets", "xd_photo_resources", "xd_photo_metadata", "xd_media_metadata", "xd_photo_collection_assets"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000
	server := &Server{DB: db}
	expectedVisible := logicalCount - 4*groups
	report := galleryFoldPerfReport{
		Workload:           "gallery-fold-mixed-v1",
		LogicalAssets:      logicalCount,
		PhysicalMediaNodes: logicalCount * 115 / 100,
		IdenticalGroups:    groups,
		IdenticalAssets:    foldMembers,
		ExpectedVisible:    expectedVisible,
		SamplesPerPhase:    3,
		SeedMS:             seedMS,
		Scope:              "native PostgreSQL 17 + Go production queries; no HTTP, browser, transport or thumbnails",
	}
	type loadFn func(context.Context) (int64, int64, error)
	sample := func(name string, fn loadFn) {
		t.Helper()
		phase := galleryFoldPerfPhase{Name: name, ValuesMS: make([]float64, 0, 3)}
		for run := 1; run <= 3; run++ {
			ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
			started := time.Now()
			rows, total, err := fn(ctx)
			ms := float64(time.Since(started).Microseconds()) / 1000
			cancel()
			phase.ValuesMS = append(phase.ValuesMS, ms)
			phase.Rows = rows
			phase.VisibleCount = total
			if err != nil {
				phase.HasError = true
				phase.Error = err.Error()
			}
			t.Logf("GALLERY_FOLD_SAMPLE scale=%d phase=%s sample=%d ms=%.3f rows=%d total=%d error=%q", logicalCount, name, run, ms, rows, total, phase.Error)
			if err != nil {
				break
			}
		}
		sort.Float64s(phase.ValuesMS)
		phase.MedianMS = phase.ValuesMS[len(phase.ValuesMS)/2]
		report.Phases = append(report.Phases, phase)
	}
	verify := func(page mediaItemRangeDTO, total int64, maxRows int, expectedMembers int) (int64, int64, error) {
		if page.TotalCount != total {
			return int64(len(page.Items)), page.TotalCount, fmt.Errorf("visible total=%d want=%d", page.TotalCount, total)
		}
		if len(page.Items) != maxRows {
			return int64(len(page.Items)), page.TotalCount, fmt.Errorf("page rows=%d want=%d", len(page.Items), maxRows)
		}
		// As defined by the sparse Gallery API, time-line sets are returned
		// on offset=0, not on subsequent viewport pages.
		if page.Offset == 0 && page.TimelineGroupSets == nil {
			return int64(len(page.Items)), page.TotalCount, fmt.Errorf("first range timeline group sets missing")
		}
		if expectedMembers > 0 {
			for _, item := range page.Items {
				if len(item.FoldMemberIDs) != expectedMembers {
					return int64(len(page.Items)), page.TotalCount, fmt.Errorf("folded favorite ID=%d members=%d want=%d", item.Node.ID, len(item.FoldMemberIDs), expectedMembers)
				}
			}
		}
		return int64(len(page.Items)), page.TotalCount, nil
	}
	sample("fold_off_first", func(ctx context.Context) (int64, int64, error) {
		p, err := server.queryMediaItemRange(ctx, user.ID, mediaQueryOptions{}, "", 100, 0)
		if err != nil {
			return 0, 0, err
		}
		return verify(p, int64(logicalCount), 100, 0)
	})
	sample("fold_index", func(ctx context.Context) (int64, int64, error) {
		x, err := server.buildVerifiedMediaFoldIndex(ctx, user.ID)
		if err != nil {
			return 0, 0, err
		}
		if len(x.ByNode) != foldMembers {
			return int64(len(x.ByNode)), 0, fmt.Errorf("fold index=%d want=%d", len(x.ByNode), foldMembers)
		}
		return int64(len(x.ByNode)), int64(len(x.MappingJSON)), nil
	})
	sample("fold_on_first", func(ctx context.Context) (int64, int64, error) {
		p, err := server.queryMediaItemRange(ctx, user.ID, mediaQueryOptions{FoldDuplicates: true}, "", 100, 0)
		if err != nil {
			return 0, 0, err
		}
		return verify(p, int64(expectedVisible), 100, 0)
	})
	sample("fold_on_mid", func(ctx context.Context) (int64, int64, error) {
		p, err := server.queryMediaItemRange(ctx, user.ID, mediaQueryOptions{FoldDuplicates: true}, "", 100, expectedVisible/2)
		if err != nil {
			return 0, 0, err
		}
		return verify(p, int64(expectedVisible), 100, 0)
	})
	albumKey := fmt.Sprintf("%s:%d", meta.PhotoCollectionKindFolder, folder.ID)
	sample("fold_album", func(ctx context.Context) (int64, int64, error) {
		p, err := server.queryMediaItemRange(ctx, user.ID, mediaQueryOptions{FoldDuplicates: true}, albumKey, 100, 0)
		if err != nil {
			return 0, 0, err
		}
		return verify(p, int64(expectedVisible), 100, 0)
	})
	fav := true
	sample("fold_favorite", func(ctx context.Context) (int64, int64, error) {
		p, err := server.queryMediaItemRange(ctx, user.ID, mediaQueryOptions{FoldDuplicates: true, Favorite: &fav}, "", 100, 0)
		if err != nil {
			return 0, 0, err
		}
		return verify(p, int64(groups), 100, 5)
	})
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_VERIFIED_FOLD_PERF %s", string(encoded))
	for _, p := range report.Phases {
		if p.HasError {
			t.Errorf("baseline phase=%s failed: %s", p.Name, p.Error)
		}
	}
}
