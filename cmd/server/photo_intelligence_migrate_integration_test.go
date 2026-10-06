package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigrateCreatesPhotoIntelligenceFoundation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_photo_intelligence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	for _, table := range []string{
		"xd_photo_analysis_states",
		"xd_photo_faces",
		"xd_photo_person_clusters",
		"xd_photo_person_cluster_faces",
		"xd_photo_person_cluster_states",
		"xd_photo_intelligence_reanalyze_intents",
		"xd_photo_people",
		"xd_photo_person_assets",
		"xd_photo_place_labels",
	} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("photo intelligence table %q was not created", table)
		}
	}

	if !db.Migrator().HasColumn("xd_photo_faces", "landmarks_json") {
		t.Fatal("photo face landmarks_json column was not created")
	}

	user := meta.User{
		Username: "photo-intelligence-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	intent := meta.PhotoIntelligenceReanalyzeIntent{
		OwnerID:        user.ID,
		Kind:           "face",
		RequestedEpoch: 1,
		AppliedEpoch:   0,
		Trigger:        "user_action",
		Initiator:      "user",
		InitiatorID:    user.ID,
		RequestedAt:    time.Now().UTC(),
	}
	if err := db.Create(&intent).Error; err != nil {
		t.Fatal(err)
	}
	duplicateIntent := intent
	duplicateIntent.RequestedEpoch = 2
	if err := db.Create(&duplicateIntent).Error; err == nil {
		t.Fatal("duplicate owner+kind reanalyze intent was accepted")
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &root.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID: user.ID, PrimaryNodeID: node.ID,
		Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:photo.jpg",
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	analysis := meta.PhotoAnalysisState{
		AssetID: asset.ID, Kind: meta.PhotoAnalysisKindFaceDetection,
		AnalyzerVersion: "test-face-v1", InputFingerprint: "sha256:test",
		State: meta.PhotoAnalysisStateReady,
	}
	if err := db.Create(&analysis).Error; err != nil {
		t.Fatal(err)
	}
	duplicateAnalysis := analysis
	duplicateAnalysis.ID = 0
	if err := db.Create(&duplicateAnalysis).Error; err == nil {
		t.Fatal("duplicate per-asset analysis kind was accepted")
	}

	face := meta.PhotoFace{
		AssetID: asset.ID, DetectionKey: "face:0", AnalyzerVersion: "test-face-v1",
		X: 0.1, Y: 0.2, Width: 0.3, Height: 0.4, Confidence: 0.99,
		LandmarksJSON: `[{"x":0.2,"y":0.3},{"x":0.3,"y":0.3},{"x":0.25,"y":0.4},{"x":0.2,"y":0.5},{"x":0.3,"y":0.5}]`,
		Embedding:     []byte{1, 2, 3, 4}, EmbeddingFormat: "f32le", EmbeddingVersion: "test-embed-v1",
	}
	if err := db.Create(&face).Error; err != nil {
		t.Fatal(err)
	}
	duplicateFace := face
	duplicateFace.ID = 0
	if err := db.Create(&duplicateFace).Error; err == nil {
		t.Fatal("duplicate face detection key was accepted")
	}

	cluster := meta.PhotoPersonCluster{
		OwnerID: user.ID, ClusterKey: "cluster:0", AnalyzerVersion: "test-cluster-v1",
		Embedding: []byte{4, 5, 6}, EmbeddingFormat: "f32le", EmbeddingVersion: "test-embed-v1",
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	duplicateCluster := cluster
	duplicateCluster.ID = 0
	if err := db.Create(&duplicateCluster).Error; err == nil {
		t.Fatal("duplicate per-owner person cluster key was accepted")
	}
	membership := meta.PhotoPersonClusterFace{
		ClusterID: cluster.ID, FaceID: face.ID, Confidence: 0.97,
	}
	if err := db.Create(&membership).Error; err != nil {
		t.Fatal(err)
	}
	otherCluster := meta.PhotoPersonCluster{
		OwnerID: user.ID, ClusterKey: "cluster:1", AnalyzerVersion: "test-cluster-v1",
	}
	if err := db.Create(&otherCluster).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterFace{
		ClusterID: otherCluster.ID, FaceID: face.ID, Confidence: 0.50,
	}).Error; err == nil {
		t.Fatal("face was accepted into multiple automatic person clusters")
	}

	clusterState := meta.PhotoPersonClusterState{
		OwnerID:          user.ID,
		AnalyzerVersion:  "test-person-cluster-v1",
		EmbeddingVersion: "test-embed-v1",
		InputFingerprint: "person-input:test",
		FaceCount:        1,
		State:            meta.PhotoAnalysisStateReady,
		Attempt:          1,
	}
	if err := db.Create(&clusterState).Error; err != nil {
		t.Fatal(err)
	}
	duplicateClusterState := clusterState
	if err := db.Create(&duplicateClusterState).Error; err == nil {
		t.Fatal("multiple person cluster states were accepted for one owner")
	}

	person := meta.PhotoPerson{
		OwnerID:   user.ID,
		PersonKey: "person:v1:11111111-1111-1111-1111-111111111111",
		Name:      "Alice",
		Revision:  1,
	}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	duplicatePerson := person
	duplicatePerson.ID = 0
	if err := db.Create(&duplicatePerson).Error; err == nil {
		t.Fatal("duplicate durable person key was accepted")
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID,
		AssetID:  asset.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID,
		AssetID:  asset.ID,
	}).Error; err == nil {
		t.Fatal("duplicate durable person asset membership was accepted")
	}

	place := meta.PhotoPlaceLabel{
		AssetID: asset.ID, Resolver: "test-offline", ResolverVersion: "v1",
		Latitude: 1.3521, Longitude: 103.8198,
		CountryCode: "SG", Country: "Singapore", City: "Singapore",
		Formatted: "Singapore",
	}
	if err := db.Create(&place).Error; err != nil {
		t.Fatal(err)
	}
	duplicatePlace := place
	if err := db.Create(&duplicatePlace).Error; err == nil {
		t.Fatal("multiple current place labels were accepted for one photo asset")
	}
}
