package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Dedicated, opt-in PostgreSQL workload for Cleanup. Never run 100k fixture
// seeding on every PR: this is measurement evidence, not a global test gate.
const (
	galleryCleanupHugeGroupCopies  = 10_000
	galleryCleanupExtraBurstGroups = 8_000
	galleryCleanupExtremeSamples   = 3
)

type galleryCleanupExtremeSample struct {
	Phase          string  `json:"phase"`
	Sample         int     `json:"sample"`
	ElapsedMS      float64 `json:"elapsed_ms"`
	TotalGroups    int64   `json:"total_groups"`
	ReturnedGroups int     `json:"returned_groups"`
	TotalItems     int64   `json:"total_items"`
	AllocatedBytes uint64  `json:"allocated_bytes"`
	Error          string  `json:"error,omitempty"`
}

func TestGalleryCleanupExtremeGroupsPerformance100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_CLEANUP_EXTREME_PERF") != "1" {
		t.Skip("branch-scoped 100k Cleanup benchmark: set XD_GALLERY_CLEANUP_EXTREME_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.ContentBlob{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username:       "gallery-cleanup-extreme",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		ParentID: &root.ID,
		Name:     "100k cleanup stress",
		Type:     meta.NodeTypeDir,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	startSeed := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, owner.ID, folder.ID)
	galleryEntryPerfSeed(t, db, owner.ID, folder.ID)
	seedMS := float64(time.Since(startSeed).Microseconds()) / 1000
	measure := &Server{DB: db}
	ctx := context.Background()
	samples := make([]galleryCleanupExtremeSample, 0, galleryCleanupExtremeSamples*4)
	record := func(phase string, ordinal int, expectedGroups int64, read func() (int64, int, int64, error)) {
		t.Helper()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		start := time.Now()
		total, visible, items, err := read()
		elapsedMS := float64(time.Since(start).Microseconds()) / 1000
		runtime.ReadMemStats(&after)
		allocated := after.TotalAlloc - before.TotalAlloc
		row := galleryCleanupExtremeSample{
			Phase: phase, Sample: ordinal, ElapsedMS: elapsedMS,
			TotalGroups: total, ReturnedGroups: visible,
			TotalItems: items, AllocatedBytes: allocated,
		}
		if err != nil {
			row.Error = err.Error()
		}
		samples = append(samples, row)
		t.Logf("GALLERY_CLEANUP_EXTREME_PHASE phase=%s sample=%d elapsed_ms=%.3f groups=%d visible=%d items=%d alloc_bytes=%d error=%q",
			phase, ordinal, elapsedMS, total, visible, items, allocated, row.Error)
		if err != nil {
			t.Fatalf("phase=%s sample=%d: %v", phase, ordinal, err)
		}
		if total != expectedGroups || visible != 48 && !(expectedGroups == 1 && visible == 1) {
			t.Fatalf("phase=%s sample=%d group page=%d/%d expected %d groups",
				phase, ordinal, visible, total, expectedGroups)
		}
	}
	duplicate := func(huge bool) func() (int64, int, int64, error) {
		return func() (int64, int, int64, error) {
			page, err := measure.queryDuplicateGroups(ctx, owner.ID, 48, 0)
			if err != nil {
				return 0, 0, 0, err
			}
			if huge && (len(page.Groups) != 1 ||
				page.Groups[0].ItemCount != galleryCleanupHugeGroupCopies ||
				page.Groups[0].AssetComparison != duplicateAssetUnverified) {
				return 0, 0, 0, fmt.Errorf(
					"huge group must remain conservatively unverified: %+v", page)
			}
			return page.TotalGroups, len(page.Groups), page.TotalItems, nil
		}
	}
	bursts := func() (int64, int, int64, error) {
		page, err := measure.queryBurstReviews(ctx, owner.ID, 48, 0)
		if err != nil {
			return 0, 0, 0, err
		}
		return page.TotalGroups, len(page.Groups), page.TotalItems, nil
	}
	for i := 1; i <= galleryCleanupExtremeSamples; i++ {
		record("duplicate-2000-groups", i, 2000, duplicate(false))
		record("burst-2000-groups", i, 2000, bursts)
	}
	hugeSHA := strings.Repeat("f", 64)
	// Model a single 10k-copy hash, keeping all three projections consistent.
	// This deliberately measures the current unbounded duplicateMembers shape.
	for _, query := range []string{
		`UPDATE xd_files AS f SET sha256 = ? FROM xd_nodes AS n
		  WHERE f.node_id = n.id AND n.owner_id = ? AND n.parent_id = ?
		    AND n.name LIKE 'photo-%'
		    AND substring(n.name from 7 for 6)::integer <= 10000`,
		`UPDATE xd_media_metadata AS mm SET sha256 = ?
		  FROM xd_files AS f JOIN xd_nodes AS n ON n.id = f.node_id
		  WHERE mm.node_id = f.node_id AND n.owner_id = ? AND n.parent_id = ?
		    AND n.name LIKE 'photo-%'
		    AND substring(n.name from 7 for 6)::integer <= 10000`,
		`UPDATE xd_photo_resources AS pr SET sha256 = ?
		  FROM xd_nodes AS n WHERE pr.node_id = n.id
		    AND n.owner_id = ? AND n.parent_id = ?
		    AND n.name LIKE 'photo-%'
		    AND substring(n.name from 7 for 6)::integer <= 10000`,
	} {
		if err := db.Exec(query, hugeSHA, owner.ID, folder.ID).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_photo_resources"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 1; i <= galleryCleanupExtremeSamples; i++ {
		record("duplicate-one-10000-copy-group", i, 1, duplicate(true))
	}
	// Expand 2k native 3-frame Burst groups to 10k using additional distinct
	// image nodes. The original 100k/115k fixture cardinalities stay unchanged.
	if err := db.Exec(
		`INSERT INTO xd_media_groups (owner_id, kind, evidence_key, created_at, updated_at)
		 SELECT ?, ?, 'perf-extra-burst-' || gs::text, NOW(), NOW()
		 FROM generate_series(1, ?) AS gs`,
		owner.ID, meta.MediaGroupKindBurst, galleryCleanupExtraBurstGroups,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`INSERT INTO xd_media_group_items
		   (group_id, node_id, role, ordinal, created_at, updated_at)
		 SELECT g.id, n.id, ?, frame.ordinal, NOW(), NOW()
		 FROM xd_media_groups AS g
		 CROSS JOIN generate_series(0, 2) AS frame(ordinal)
		 JOIN xd_nodes AS n ON n.owner_id = g.owner_id AND n.parent_id = ?
		   AND n.name = 'photo-' ||
		    lpad(((split_part(g.evidence_key, '-', 4)::integer - 1)*3 +
			  frame.ordinal + 10001)::text, 6, '0') || '.jpg'
		 WHERE g.owner_id = ? AND g.kind = ?
		   AND g.evidence_key LIKE 'perf-extra-burst-%'`,
		meta.MediaGroupRoleAuxiliary, folder.ID, owner.ID, meta.MediaGroupKindBurst,
	).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_media_groups", "xd_media_group_items"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 1; i <= galleryCleanupExtremeSamples; i++ {
		record("burst-10000-groups", i, 10000, bursts)
	}
	medians := map[string]float64{}
	byPhase := make(map[string][]float64)
	for _, sample := range samples {
		byPhase[sample.Phase] = append(byPhase[sample.Phase], sample.ElapsedMS)
	}
	for phase, values := range byPhase {
		sort.Float64s(values)
		medians[phase] = values[len(values)/2]
	}
	raw, err := json.Marshal(map[string]any{
		"workload":                  "gallery-cleanup-extreme-native-postgres-100k",
		"status":                    "baseline_only_no_optimization",
		"logical_photo_assets":      100000,
		"physical_media_nodes":      115000,
		"huge_single_group_copies":  galleryCleanupHugeGroupCopies,
		"burst_group_count_extreme": 10000,
		"samples_per_phase":         galleryCleanupExtremeSamples,
		"seed_ms":                   seedMS,
		"medians_ms":                medians,
		"samples":                   samples,
		"scope":                     "real PostgreSQL 17 direct cleanup SQL; excludes HTTP/Web/Desktop rendering and source bytes",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_CLEANUP_EXTREME_100K %s", string(raw))
}
