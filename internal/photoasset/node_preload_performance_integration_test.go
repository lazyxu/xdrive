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
)

const (
	photoAssetNodePerfPhotos  = 100_000
	photoAssetNodePerfMotion  = 15_000
	photoAssetNodePerfBatch   = photoAssetNodeBatchSize
	photoAssetNodePerfSamples = 3
)

type photoAssetNodePerfSample struct {
	Sample        int     `json:"sample"`
	ElapsedMS     float64 `json:"elapsed_ms"`
	Nodes         int     `json:"nodes"`
	Files         int     `json:"files"`
	Batches       int     `json:"batches"`
	MaxParameters int     `json:"max_parameters"`
}

// TestPhotoAssetOwnerNodePreload100K isolates the first red SQL in the
// owner-wide photoasset reconciliation. It does not benchmark writes,
// collections, PhotoResource derivation, or a complete ReconcileOwner call.
func TestPhotoAssetOwnerNodePreload100K(t *testing.T) {
	if os.Getenv("XD_PHOTOASSET_NODE_PRELOAD_PERF") != "1" {
		t.Skip("set XD_PHOTOASSET_NODE_PRELOAD_PERF=1 for PostgreSQL 115k Node+File workload")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photoasset_node_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := dsnURL.Query()
	query.Set("search_path", schema)
	dsnURL.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(8)
	conn.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "photoasset-node-benchmark", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{ParentID: &root.ID, Name: "100k media", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}

	startSeed := time.Now()
	for _, spec := range []struct {
		prefix, extension string
		count             int
	}{
		{"photo", "jpg", photoAssetNodePerfPhotos},
		{"motion", "mov", photoAssetNodePerfMotion},
	} {
		if err := db.Exec(`
INSERT INTO xd_nodes(parent_id, name, type, owner_id, revision, created_at, updated_at)
SELECT ?, ? || '-' || lpad(gs::text, 6, '0') || '.' || ?, 'file', ?, 1, NOW(), NOW()
FROM generate_series(1, ?) AS gs
`, folder.ID, spec.prefix, spec.extension, owner.ID, spec.count).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`
INSERT INTO xd_files(node_id, size, storage_key, sha256, created_at, updated_at)
SELECT n.id, 256000, 'fixture:node-preload', lpad(to_hex(n.id::bigint), 64, '0'), NOW(), NOW()
FROM xd_nodes n WHERE n.parent_id = ? AND n.owner_id = ? AND n.type = 'file'
`, folder.ID, owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_media_metadata(
  node_id, owner_id, node_revision, sha256, media_kind, mime_type,
  relation_evidence_version, width, height, orientation,
  index_state, created_at, updated_at
)
SELECT n.id, ?, 1, f.sha256,
  CASE WHEN n.name LIKE 'photo-%' THEN 'image' ELSE 'video' END,
  CASE WHEN n.name LIKE 'photo-%' THEN 'image/jpeg' ELSE 'video/quicktime' END,
  1, 1600, 900, 1, 'ready', NOW(), NOW()
FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id
WHERE n.parent_id = ? AND n.owner_id = ? AND n.type = 'file'
`, owner.ID, folder.ID, owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_media_metadata"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedMS := float64(time.Since(startSeed).Microseconds()) / 1000
	var metadata []meta.MediaMetadata
	startMetadata := time.Now()
	if err := db.Where("owner_id = ? AND index_state = ? AND media_kind IN ?",
		owner.ID, meta.MediaIndexStateReady,
		[]string{meta.MediaKindImage, meta.MediaKindVideo},
	).Order("node_id ASC").Find(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	metadataMS := float64(time.Since(startMetadata).Microseconds()) / 1000
	const logicalPhotoCount = photoAssetNodePerfPhotos
	const physicalMediaNodeCount = photoAssetNodePerfPhotos + photoAssetNodePerfMotion
	if len(metadata) != physicalMediaNodeCount {
		t.Fatalf("metadata count %d want %d", len(metadata), physicalMediaNodeCount)
	}
	nodeIDs := make([]uint64, len(metadata))
	for i, row := range metadata {
		nodeIDs[i] = row.NodeID
	}

	baselineStart := time.Now()
	var oversized []meta.Node
	baselineErr := db.Preload("File").Where("id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		nodeIDs, owner.ID, meta.NodeTypeFile,
	).Find(&oversized).Error
	baselineMS := float64(time.Since(baselineStart).Microseconds()) / 1000
	if baselineErr == nil || !strings.Contains(baselineErr.Error(), "65535") {
		t.Fatalf("expected 115k GORM bind-parameter failure, got err=%v nodes=%d", baselineErr, len(oversized))
	}

	var results []photoAssetNodePerfSample
	for sample := 1; sample <= photoAssetNodePerfSamples; sample++ {
		started := time.Now()
		nodes, err := preloadPhotoAssetNodes(db, owner.ID, nodeIDs)
		if err != nil {
			t.Fatal(err)
		}
		nodeCount, fileCount := len(nodes), 0
		batches := (len(nodeIDs) + photoAssetNodePerfBatch - 1) / photoAssetNodePerfBatch
		seen := make(map[uint64]struct{}, len(nodes))
		for _, node := range nodes {
			if node.OwnerID != owner.ID {
				t.Fatalf("sample=%d node=%d wrong owner=%d", sample, node.ID, node.OwnerID)
			}
			if _, duplicate := seen[node.ID]; duplicate {
				t.Fatalf("sample=%d duplicate node=%d", sample, node.ID)
			}
			seen[node.ID] = struct{}{}
			if node.File == nil || node.File.NodeID != node.ID {
				t.Fatalf("sample=%d node=%d File preloading missing", sample, node.ID)
			}
			fileCount++
		}
		if nodeCount != physicalMediaNodeCount || fileCount != physicalMediaNodeCount {
			t.Fatalf("sample=%d nodes=%d files=%d want=%d", sample, nodeCount, fileCount, physicalMediaNodeCount)
		}
		results = append(results, photoAssetNodePerfSample{
			Sample:    sample,
			ElapsedMS: float64(time.Since(started).Microseconds()) / 1000,
			Nodes:     nodeCount, Files: fileCount, Batches: batches,
			MaxParameters: photoAssetNodePerfBatch + 3,
		})
	}
	times := make([]float64, 0, len(results))
	for _, result := range results {
		times = append(times, result.ElapsedMS)
	}
	sort.Float64s(times)
	out, err := json.Marshal(map[string]any{
		"workload": "photoasset-node-file-preload-100k", "logical_photo_filenames": logicalPhotoCount,
		"physical_media_nodes": physicalMediaNodeCount, "samples": results,
		"max_bound_ids_per_query":            photoAssetNodePerfBatch,
		"max_node_query_bind_parameters":     photoAssetNodePerfBatch + 3,
		"node_query_statements_per_sample":   results[0].Batches,
		"preload_file_statements_per_sample": results[0].Batches,
		"seed_ms":                            seedMS, "metadata_fetch_ms": metadataMS,
		"baseline_failed_ms": baselineMS, "baseline_error": baselineErr.Error(),
		"candidate_median_ms": times[len(times)/2],
		"scope":               "real PostgreSQL Node/File preload stage only; 15k motion filenames are not paired/grouped here; not full ReconcileOwner, no HTTP or UI",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PHOTOASSET_NODE_PRELOAD_100K %s", out)
}
