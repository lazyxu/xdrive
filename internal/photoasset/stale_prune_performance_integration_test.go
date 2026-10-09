package photoasset

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	stalePrunePerfAssets  = 100_000
	stalePrunePerfSamples = 3
	stalePrunePerfDrop    = 4_300
	stalePrunePerfFrozen  = 50
)

type stalePrunePerfSample struct {
	Sample    int     `json:"sample"`
	ElapsedMS float64 `json:"elapsed_ms"`
	Retained  int     `json:"retained"`
}

// TestPhotoAssetStalePrunePerformance100K isolates the first confirmed
// ReconcileOwner oversized SQL stage without running the later 100k write path.
// A query failure is a diagnostic baseline, never a successful speed comparison.
func TestPhotoAssetStalePrunePerformance100K(t *testing.T) {
	if os.Getenv("XD_PHOTOASSET_STALE_PRUNE_PERF") != "1" {
		t.Skip("set XD_PHOTOASSET_STALE_PRUNE_PERF=1 for native 100k active PhotoAsset prune")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photoasset_prune_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	parameters := dsnURL.Query()
	parameters.Set("search_path", schema)
	dsnURL.RawQuery = parameters.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.PhotoAsset{},
		&meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "stale-prune-100k", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "root", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes(parent_id, name, type, owner_id, revision, created_at, updated_at) "+
			"SELECT ?, 'asset-' || lpad(gs::text, 6, '0') || '.jpg', 'file', ?, 1, NOW(), NOW() FROM generate_series(1, ?) AS gs",
		root.ID, owner.ID, stalePrunePerfAssets,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		"INSERT INTO xd_photo_assets(owner_id, primary_node_id, kind, evidence_key, created_at, updated_at) "+
			"SELECT ?, n.id, 'image', 'node:' || n.id::text, NOW(), NOW() FROM xd_nodes n "+
			"WHERE n.owner_id = ? AND n.parent_id = ? AND n.type = 'file'",
		owner.ID, owner.ID, root.ID,
	).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_photo_assets"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	var allIDs []uint64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", owner.ID).
		Order("primary_node_id ASC").
		Pluck("primary_node_id", &allIDs).Error; err != nil {
		t.Fatal(err)
	}
	if len(allIDs) != stalePrunePerfAssets {
		t.Fatalf("seeded primary IDs=%d want=%d", len(allIDs), stalePrunePerfAssets)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	desired := make(map[uint64]struct{}, len(allIDs))
	for _, id := range allIDs {
		desired[id] = struct{}{}
	}

	activeNodes := db.Model(&meta.Node{}).Select("id").
		Where("owner_id = ? AND deleted_at IS NULL", owner.ID)
	baselineStart := time.Now()
	legacyErr := db.Where("owner_id = ? AND primary_node_id IN (?)", owner.ID, activeNodes).
		Where("primary_node_id NOT IN ?", allIDs).
		Delete(&meta.PhotoAsset{}).Error
	baselineFailureMS := float64(time.Since(baselineStart).Microseconds()) / 1000
	if legacyErr == nil || !strings.Contains(legacyErr.Error(), "65535") {
		t.Fatalf("expected old 100k NOT IN parameter overflow; error=%v", legacyErr)
	}
	var samples []stalePrunePerfSample
	for sample := 1; sample <= stalePrunePerfSamples; sample++ {
		start := time.Now()
		kept, err := loadAndPruneStalePhotoAssets(db, owner.ID, desired)
		elapsedMS := float64(time.Since(start).Microseconds()) / 1000
		if err != nil {
			t.Fatal(err)
		}
		if len(kept) != stalePrunePerfAssets {
			t.Fatalf("sample=%d retained=%d want=%d", sample, len(kept), stalePrunePerfAssets)
		}
		samples = append(samples, stalePrunePerfSample{Sample: sample, ElapsedMS: elapsedMS, Retained: len(kept)})
	}
	times := make([]float64, 0, len(samples))
	for _, row := range samples {
		times = append(times, row.ElapsedMS)
	}
	sort.Float64s(times)

	// Remove 4,300 primary nodes from desired: 50 soft-deleted snapshots
	// must survive, and 4,250 active stale assets must be deleted in two
	// bounded SQL batches (4,096 plus 154).
	cutoff := stalePrunePerfAssets - stalePrunePerfDrop
	frozenIDs := allIDs[cutoff : cutoff+stalePrunePerfFrozen]
	staleIDs := allIDs[cutoff+stalePrunePerfFrozen:]
	desiredChanged := make(map[uint64]struct{}, cutoff)
	for _, id := range allIDs[:cutoff] {
		desiredChanged[id] = struct{}{}
	}
	now := time.Now().UTC()
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND id IN ?", owner.ID, frozenIDs).
		Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	inspectPrimaries := []uint64{allIDs[0], frozenIDs[0], staleIDs[0]}
	var inspectAssets []meta.PhotoAsset
	if err := db.Where("owner_id = ? AND primary_node_id IN ?", owner.ID, inspectPrimaries).
		Find(&inspectAssets).Error; err != nil {
		t.Fatal(err)
	}
	if len(inspectAssets) != 3 {
		t.Fatalf("fixture sample assets=%d want 3", len(inspectAssets))
	}
	assetsByPrimary := make(map[uint64]meta.PhotoAsset, len(inspectAssets))
	for _, a := range inspectAssets {
		assetsByPrimary[a.PrimaryNodeID] = a
	}
	collection := meta.PhotoCollection{
		OwnerID: owner.ID, ExternalKey: "manual:stale-prune-samples",
		Kind: meta.PhotoCollectionKindManual, Name: "Keep Metadata",
		State: meta.PhotoCollectionStateActive,
	}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	for index, primary := range inspectPrimaries {
		asset := assetsByPrimary[primary]
		if asset.ID == 0 {
			t.Fatalf("sample primary %d missing", primary)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			Favorite: true, Description: "metadata remains on frozen assets",
			TagsJSON: "[\"keep\"]", PeopleJSON: "[\"person\"]",
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: primary, Role: meta.PhotoResourceRolePrimary,
			Name: "asset.jpg", MediaKind: meta.MediaKindImage,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoCollectionAsset{
			CollectionID: collection.ID, AssetID: asset.ID, Position: int64(index),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	other := meta.User{Username: "stale-prune-other", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	otherNode := meta.Node{Name: "other.jpg", Type: meta.NodeTypeFile, OwnerID: other.ID, Revision: 1}
	if err := db.Create(&otherNode).Error; err != nil {
		t.Fatal(err)
	}
	otherAsset := meta.PhotoAsset{
		OwnerID: other.ID, PrimaryNodeID: otherNode.ID,
		Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", otherNode.ID),
	}
	if err := db.Create(&otherAsset).Error; err != nil {
		t.Fatal(err)
	}
	kept, err := loadAndPruneStalePhotoAssets(db, owner.ID, desiredChanged)
	if err != nil {
		t.Fatal(err)
	}
	wantRetained := stalePrunePerfAssets - len(staleIDs)
	if len(kept) != wantRetained {
		t.Fatalf("retained assets=%d want=%d", len(kept), wantRetained)
	}
	var actualOwner int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", owner.ID).Count(&actualOwner).Error; err != nil {
		t.Fatal(err)
	}
	if actualOwner != int64(wantRetained) {
		t.Fatalf("owner asset count=%d want=%d", actualOwner, wantRetained)
	}
	var otherCount int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", other.ID).Count(&otherCount).Error; err != nil {
		t.Fatal(err)
	}
	if otherCount != 1 {
		t.Fatalf("other owner asset count=%d want 1", otherCount)
	}
	for _, check := range []struct {
		nodeID uint64
		exists bool
	}{
		{inspectPrimaries[0], true},
		{inspectPrimaries[1], true},
		{inspectPrimaries[2], false},
	} {
		asset := assetsByPrimary[check.nodeID]
		var count int64
		if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", asset.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if (count == 1) != check.exists {
			t.Fatalf("node=%d asset exists=%t want=%t", check.nodeID, count == 1, check.exists)
		}
		for _, model := range []any{&meta.PhotoMetadata{}, &meta.PhotoResource{}} {
			if err := db.Model(model).Where("asset_id = ?", asset.ID).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if (count == 1) != check.exists {
				t.Fatalf("node=%d relation exists=%t want=%t", check.nodeID, count == 1, check.exists)
			}
		}
		if err := db.Model(&meta.PhotoCollectionAsset{}).
			Where("collection_id = ? AND asset_id = ?", collection.ID, asset.ID).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if (count == 1) != check.exists {
			t.Fatalf("node=%d membership exists=%t want=%t", check.nodeID, count == 1, check.exists)
		}
	}
	var frozenMetadata meta.PhotoMetadata
	if err := db.First(&frozenMetadata, "asset_id = ?", assetsByPrimary[inspectPrimaries[1]].ID).Error; err != nil {
		t.Fatal(err)
	}
	if !frozenMetadata.Favorite ||
		frozenMetadata.TagsJSON != "[\"keep\"]" ||
		frozenMetadata.PeopleJSON != "[\"person\"]" ||
		frozenMetadata.Description != "metadata remains on frozen assets" {
		t.Fatalf("frozen metadata modified: %+v", frozenMetadata)
	}

	out, err := json.Marshal(map[string]any{
		"workload":                       "photoasset-owner-stale-prune-100k",
		"assets":                         stalePrunePerfAssets,
		"sample_count":                   stalePrunePerfSamples,
		"baseline_failed_ms":             baselineFailureMS,
		"baseline_error":                 legacyErr.Error(),
		"candidate_samples":              samples,
		"candidate_median_ms":            times[len(times)/2],
		"seed_ms":                        seedMS,
		"owner_assets_after_stale_prune": actualOwner,
		"stale_active_removed":           len(staleIDs),
		"soft_deleted_frozen_retained":   len(frozenIDs),
		"other_owner_asset_count":        otherCount,
		"bound_ids_per_delete":           photoAssetNodeBatchSize,
		"stale_delete_batches":           (len(staleIDs) + photoAssetNodeBatchSize - 1) / photoAssetNodeBatchSize,
		"scope":                          "native PostgreSQL stale PhotoAsset pruning only; not full owner reconcile or rendering",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PHOTOASSET_STALE_PRUNE_100K %s", out)
}
