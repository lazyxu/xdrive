package photointelligence

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestLoadPhotoIntelligenceDatabaseStatus(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_intelligence_status_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{},
		&meta.PhotoAsset{}, &meta.PhotoAnalysisState{}, &meta.PhotoFace{},
		&meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{}, &meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "photo-status-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       user.ID,
		PrimaryNodeID: node.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "status:" + uuid.NewString(),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	states := []meta.PhotoAnalysisState{
		{
			AssetID: asset.ID, Kind: meta.PhotoAnalysisKindFaceDetection,
			AnalyzerVersion: "detector-v1", InputFingerprint: "input-1",
			State: meta.PhotoAnalysisStateReady,
		},
		{
			AssetID: asset.ID, Kind: meta.PhotoAnalysisKindFaceEmbedding,
			AnalyzerVersion: "embedding-v1", InputFingerprint: "input-1",
			State: meta.PhotoAnalysisStateFailed,
		},
		{
			AssetID: asset.ID, Kind: meta.PhotoAnalysisKindPlaceLabel,
			AnalyzerVersion: "place-v1", InputFingerprint: "input-1",
			State: meta.PhotoAnalysisStatePending,
		},
	}
	if err := db.Create(&states).Error; err != nil {
		t.Fatal(err)
	}
	face := meta.PhotoFace{
		AssetID:         asset.ID,
		DetectionKey:    "face:000",
		AnalyzerVersion: "detector-v1",
		X:               0.1, Y: 0.1, Width: 0.2, Height: 0.2,
		Confidence:       0.99,
		Embedding:        []byte{0, 0, 0, 0},
		EmbeddingFormat:  "f32le",
		EmbeddingVersion: "embedding-v1",
	}
	if err := db.Create(&face).Error; err != nil {
		t.Fatal(err)
	}
	cluster := meta.PhotoPersonCluster{
		OwnerID:          user.ID,
		ClusterKey:       "auto:v1:" + strings.Repeat("a", 64),
		AnalyzerVersion:  PersonClusterAnalyzerVersion(),
		Embedding:        []byte{0, 0, 0, 0},
		EmbeddingFormat:  "f32le",
		EmbeddingVersion: "embedding-v1",
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterFace{
		ClusterID:  cluster.ID,
		FaceID:     face.ID,
		Confidence: 0.95,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterState{
		OwnerID:          user.ID,
		AnalyzerVersion:  PersonClusterAnalyzerVersion(),
		EmbeddingVersion: "embedding-v1",
		InputFingerprint: "cluster-input",
		FaceCount:        1,
		State:            meta.PhotoAnalysisStateRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}
	person := meta.PhotoPerson{
		OwnerID:   user.ID,
		PersonKey: "person:v1:" + uuid.NewString(),
		Name:      "Alice",
		Revision:  1,
	}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID,
		AssetID:  asset.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPlaceLabel{
		AssetID:         asset.ID,
		Resolver:        "test",
		ResolverVersion: "v1",
		Latitude:        1.0,
		Longitude:       103.0,
		Formatted:       "Singapore",
	}).Error; err != nil {
		t.Fatal(err)
	}

	status, err := LoadPhotoIntelligenceDatabaseStatus(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if status.PhotoAssets != 1 ||
		status.FaceRows != 1 ||
		status.PlaceLabels != 1 ||
		status.AutomaticClusters != 1 ||
		status.AutomaticClusterFaces != 1 ||
		status.DurablePeople != 1 ||
		status.DurablePersonMemberships != 1 {
		t.Fatalf("counts=%+v", status)
	}
	if status.FaceDetection.Ready != 1 ||
		status.FaceEmbedding.Failed != 1 ||
		status.PlaceAnalysis.Pending != 1 ||
		status.PersonClustering.Running != 1 {
		t.Fatalf("states=%+v", status)
	}
}
