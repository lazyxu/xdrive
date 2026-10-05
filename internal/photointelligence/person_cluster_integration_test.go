package photointelligence

import (
	"context"
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

func TestPersonClusterRunnerRebuildLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_person_cluster_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.PhotoAsset{},
		&meta.PhotoAnalysisState{},
		&meta.PhotoFace{},
		&meta.PhotoPersonCluster{},
		&meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "cluster-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name:     "",
		Type:     meta.NodeTypeDir,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	createFace := func(
		name string,
		vector []float64,
		embeddingVersion string,
		updatedAt time.Time,
	) (meta.PhotoAsset, meta.PhotoFace) {
		t.Helper()
		node := meta.Node{
			ParentID: &root.ID,
			Name:     name + ".jpg",
			Type:     meta.NodeTypeFile,
			OwnerID:  owner.ID,
			Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID:       owner.ID,
			PrimaryNodeID: node.ID,
			Kind:          meta.PhotoAssetKindImage,
			EvidenceKey:   "evidence:" + name,
			CreatedAt:     updatedAt,
			UpdatedAt:     updatedAt,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		embedding, err := encodeNormalizedF32LE(vector)
		if err != nil {
			t.Fatal(err)
		}
		face := meta.PhotoFace{
			AssetID:          asset.ID,
			DetectionKey:     "face:000",
			AnalyzerVersion:  "detector-v1",
			X:                0.1,
			Y:                0.1,
			Width:            0.3,
			Height:           0.3,
			Confidence:       0.99,
			LandmarksJSON:    "[]",
			Embedding:        embedding,
			EmbeddingFormat:  "f32le",
			EmbeddingVersion: embeddingVersion,
			CreatedAt:        updatedAt,
			UpdatedAt:        updatedAt,
		}
		if err := db.Create(&face).Error; err != nil {
			t.Fatal(err)
		}
		state := meta.PhotoAnalysisState{
			AssetID:          asset.ID,
			Kind:             meta.PhotoAnalysisKindFaceEmbedding,
			AnalyzerVersion:  embeddingVersion,
			InputFingerprint: "test:" + name,
			State:            meta.PhotoAnalysisStateReady,
			Attempt:          1,
			CompletedAt:      &updatedAt,
			CreatedAt:        updatedAt,
			UpdatedAt:        updatedAt,
		}
		if err := db.Create(&state).Error; err != nil {
			t.Fatal(err)
		}
		return asset, face
	}

	_, faceA1 := createFace("a1", []float64{1, 0, 0}, "embed-v1", now)
	_, faceA2 := createFace("a2", []float64{0.98, 0.08, 0}, "embed-v1", now)
	_, faceB1 := createFace("b1", []float64{0, 1, 0}, "embed-v1", now)
	_, faceB2 := createFace("b2", []float64{0.08, 0.98, 0}, "embed-v1", now)

	current := now.Add(time.Minute)
	runner := &PersonClusterRunner{
		DB: db,
		Now: func() time.Time {
			return current
		},
	}

	processed, err := runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed=%d want=1", processed)
	}
	assertPersonClusterState(t, db, owner.ID, meta.PhotoAnalysisStateReady, 4, 1, "embed-v1")
	assertPersonClusterSizes(t, db, owner.ID, []int{2, 2})

	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 {
		t.Fatalf("unchanged processed=%d want=0", processed)
	}

	current = current.Add(time.Minute)
	_, faceA3 := createFace(
		"a3",
		[]float64{0.97, 0.12, 0},
		"embed-v1",
		current,
	)
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("new face processed=%d want=1", processed)
	}
	assertPersonClusterState(t, db, owner.ID, meta.PhotoAnalysisStateReady, 5, 2, "embed-v1")
	assertPersonClusterSizes(t, db, owner.ID, []int{2, 3})

	current = current.Add(time.Minute)
	if err := db.Model(&meta.PhotoFace{}).
		Where("id = ?", faceA3.ID).
		Updates(map[string]any{
			"embedding_version": "embed-v2",
			"updated_at":        current,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoAnalysisState{}).
		Where(
			"asset_id = ? AND kind = ?",
			faceA3.AssetID,
			meta.PhotoAnalysisKindFaceEmbedding,
		).
		Updates(map[string]any{
			"analyzer_version": "embed-v2",
			"updated_at":       current,
		}).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("mixed version processed=%d want=1", processed)
	}
	assertPersonClusterState(t, db, owner.ID, meta.PhotoAnalysisStatePending, 5, 2, "")
	assertPersonClusterSizes(t, db, owner.ID, []int{2, 3})

	current = current.Add(time.Minute)
	var allFaces []meta.PhotoFace
	if err := db.Order("id ASC").Find(&allFaces).Error; err != nil {
		t.Fatal(err)
	}
	for _, face := range allFaces {
		if err := db.Model(&meta.PhotoFace{}).
			Where("id = ?", face.ID).
			Updates(map[string]any{
				"embedding_version": "embed-v2",
				"updated_at":        current,
			}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.PhotoAnalysisState{}).
			Where(
				"asset_id = ? AND kind = ?",
				face.AssetID,
				meta.PhotoAnalysisKindFaceEmbedding,
			).
			Updates(map[string]any{
				"analyzer_version": "embed-v2",
				"updated_at":       current,
			}).Error; err != nil {
			t.Fatal(err)
		}
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("version converge processed=%d want=1", processed)
	}
	assertPersonClusterState(t, db, owner.ID, meta.PhotoAnalysisStateReady, 5, 3, "embed-v2")
	assertPersonClusterSizes(t, db, owner.ID, []int{2, 3})

	current = current.Add(time.Minute)
	if err := db.Delete(&meta.PhotoFace{}, faceB1.ID).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("delete processed=%d want=1", processed)
	}
	assertPersonClusterState(t, db, owner.ID, meta.PhotoAnalysisStateReady, 4, 4, "embed-v2")
	assertPersonClusterSizes(t, db, owner.ID, []int{3})

	var count int64
	if err := db.Model(&meta.PhotoPersonClusterFace{}).
		Where("face_id IN ?", []uint64{faceA1.ID, faceA2.ID}).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected original A faces to remain clustered; memberships=%d", count)
	}

	_ = faceB2
}

func assertPersonClusterState(
	t *testing.T,
	db *gorm.DB,
	ownerID uint64,
	state string,
	faceCount uint64,
	attempt uint,
	embeddingVersion string,
) {
	t.Helper()
	var row meta.PhotoPersonClusterState
	if err := db.First(&row, "owner_id = ?", ownerID).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != state ||
		row.FaceCount != faceCount ||
		row.Attempt != attempt ||
		row.EmbeddingVersion != embeddingVersion {
		t.Fatalf(
			"cluster state=%+v want state=%s face_count=%d attempt=%d embedding=%q",
			row,
			state,
			faceCount,
			attempt,
			embeddingVersion,
		)
	}
}

func assertPersonClusterSizes(
	t *testing.T,
	db *gorm.DB,
	ownerID uint64,
	want []int,
) {
	t.Helper()
	type row struct {
		ClusterID uint64
		Count     int
	}
	var rows []row
	if err := db.Table("xd_photo_person_clusters AS pc").
		Select("pc.id AS cluster_id, COUNT(pcf.face_id) AS count").
		Joins(
			"JOIN xd_photo_person_cluster_faces AS pcf ON pcf.cluster_id = pc.id",
		).
		Where("pc.owner_id = ?", ownerID).
		Group("pc.id").
		Order("count ASC, pc.id ASC").
		Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	got := make([]int, 0, len(rows))
	for _, row := range rows {
		got = append(got, row.Count)
	}
	sort.Ints(want)
	if len(got) != len(want) {
		t.Fatalf("cluster sizes=%v want=%v", got, want)
	}
	for index := range got {
		if got[index] != want[index] {
			t.Fatalf("cluster sizes=%v want=%v", got, want)
		}
	}
}
