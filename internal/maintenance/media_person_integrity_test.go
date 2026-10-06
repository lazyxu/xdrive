package maintenance

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestVerifyPhotoPersonIntegrityFindsDurableAndDerivedDrift(t *testing.T) {
	db := openMediaPersonIntegrityTestDB(t, "verify")
	owner, _, _, otherAsset := seedMediaPersonIntegrityOwners(t, db)

	person := meta.PhotoPerson{
		OwnerID: owner.ID, PersonKey: "person:v1:" + uuid.NewString(),
		Name: "Alice", CoverAssetID: &otherAsset.ID, Revision: 1,
	}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID, AssetID: otherAsset.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	missingPersonID := "person:v1:" + uuid.NewString()
	if err := db.Create(&meta.PhotoCollection{
		OwnerID: owner.ID, ExternalKey: "smart:" + uuid.NewString(),
		Kind: meta.PhotoCollectionKindSmart, Name: "Missing person",
		State: meta.PhotoCollectionStateActive, Revision: 1,
		QueryJSON: fmt.Sprintf(`{"person_identity":%q}`, missingPersonID),
	}).Error; err != nil {
		t.Fatal(err)
	}

	face := meta.PhotoFace{
		AssetID: otherAsset.ID, DetectionKey: "face:000",
		AnalyzerVersion: "detector-v1", Confidence: 0.99,
		X: 0.1, Y: 0.1, Width: 0.2, Height: 0.2,
		Embedding: []byte{0, 0, 0, 0}, EmbeddingFormat: "f32le",
		EmbeddingVersion: "embed-v1",
	}
	if err := db.Create(&face).Error; err != nil {
		t.Fatal(err)
	}
	cluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: "auto:v1:" + strings.Repeat("a", 64),
		AnalyzerVersion: "stale-cluster-version", EmbeddingVersion: "embed-v1",
		EmbeddingFormat: "f32le", Embedding: []byte{0, 0, 0, 0},
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterFace{
		ClusterID: cluster.ID, FaceID: face.ID, Confidence: 0.9,
	}).Error; err != nil {
		t.Fatal(err)
	}
	completed := time.Now().UTC()
	if err := db.Create(&meta.PhotoPersonClusterState{
		OwnerID:          owner.ID,
		AnalyzerVersion:  photointelligence.PersonClusterAnalyzerVersion(),
		EmbeddingVersion: "embed-v1", InputFingerprint: "cluster-input:owner",
		FaceCount: 1, State: meta.PhotoAnalysisStateReady, CompletedAt: &completed,
	}).Error; err != nil {
		t.Fatal(err)
	}

	stats, issues, err := verifyPhotoPersonIntegrity(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if stats.People != 1 || stats.Memberships != 1 || stats.SmartAlbums != 1 ||
		stats.PersonClusters != 1 || stats.PersonClusterFaces != 1 || stats.PersonClusterStates != 1 {
		t.Fatalf("stats=%+v", stats)
	}
	reasons := map[string]bool{}
	for _, issue := range issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"person_membership_owner_mismatch",
		"person_cover_owner_mismatch",
		"smart_album_person_identity_missing",
		"person_cluster_version_mismatch",
		"person_cluster_face_owner_mismatch",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue %q in %+v", want, issues)
		}
	}
}

func TestRepairMediaRepairsDurablePersonAndClusterProjection(t *testing.T) {
	db := openMediaPersonIntegrityTestDB(t, "repair")
	owner, _, _, otherAsset := seedMediaPersonIntegrityOwners(t, db)

	person := meta.PhotoPerson{
		OwnerID: owner.ID, PersonKey: "person:v1:" + uuid.NewString(),
		Name: "Alice", CoverAssetID: &otherAsset.ID, Revision: 1,
	}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID, AssetID: otherAsset.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	cluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: "auto:v1:" + strings.Repeat("b", 64),
		AnalyzerVersion: "stale-cluster-version", EmbeddingVersion: "embed-v1",
		EmbeddingFormat: "f32le", Embedding: []byte{0, 0, 0, 0},
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	completed := time.Now().UTC()
	if err := db.Create(&meta.PhotoPersonClusterState{
		OwnerID:          owner.ID,
		AnalyzerVersion:  photointelligence.PersonClusterAnalyzerVersion(),
		EmbeddingVersion: "", InputFingerprint: "cluster-input:owner",
		FaceCount: 0, State: meta.PhotoAnalysisStateReady, CompletedAt: &completed,
	}).Error; err != nil {
		t.Fatal(err)
	}

	report, err := RepairMedia(context.Background(), db, t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	if !report.After.OK() {
		t.Fatalf("after issues=%+v", report.After.Issues)
	}
	if len(report.PersonMembershipActions) != 1 || !report.PersonMembershipActions[0].Applied {
		t.Fatalf("membership actions=%+v", report.PersonMembershipActions)
	}
	if len(report.PersonCoverActions) != 1 || !report.PersonCoverActions[0].Applied {
		t.Fatalf("cover actions=%+v", report.PersonCoverActions)
	}
	if len(report.PersonClusterActions) != 1 ||
		!report.PersonClusterActions[0].ResetProjection ||
		!report.PersonClusterActions[0].Applied {
		t.Fatalf("cluster actions=%+v", report.PersonClusterActions)
	}

	var membershipCount int64
	if err := db.Model(&meta.PhotoPersonAsset{}).
		Where("person_id = ?", person.ID).Count(&membershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if membershipCount != 0 {
		t.Fatalf("membership count=%d", membershipCount)
	}
	var repaired meta.PhotoPerson
	if err := db.First(&repaired, "id = ?", person.ID).Error; err != nil {
		t.Fatal(err)
	}
	if repaired.CoverAssetID != nil || repaired.Revision != 2 {
		t.Fatalf("repaired person=%+v", repaired)
	}
	var clusterCount, stateCount int64
	if err := db.Model(&meta.PhotoPersonCluster{}).
		Where("owner_id = ?", owner.ID).Count(&clusterCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", owner.ID).Count(&stateCount).Error; err != nil {
		t.Fatal(err)
	}
	if clusterCount != 0 || stateCount != 0 {
		t.Fatalf("cluster projection remains clusters=%d states=%d", clusterCount, stateCount)
	}
}

func TestGarbageCollectPhotoIntelligenceDeletesOldNonAuthoritativeClusters(t *testing.T) {
	db := openMediaPersonIntegrityTestDB(t, "gc")
	owner, _, ownerAsset, _ := seedMediaPersonIntegrityOwners(t, db)
	old := time.Now().UTC().Add(-2 * MediaPhotoIntelligenceGCMinAge)

	face := meta.PhotoFace{
		AssetID: ownerAsset.ID, DetectionKey: "face:000",
		AnalyzerVersion: "detector-v1", Confidence: 0.99,
		X: 0.1, Y: 0.1, Width: 0.2, Height: 0.2,
		Embedding: []byte{0, 0, 0, 0}, EmbeddingFormat: "f32le",
		EmbeddingVersion: "embed-v1", CreatedAt: old, UpdatedAt: old,
	}
	if err := db.Create(&face).Error; err != nil {
		t.Fatal(err)
	}
	cluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: "auto:v1:" + strings.Repeat("c", 64),
		AnalyzerVersion:  photointelligence.PersonClusterAnalyzerVersion(),
		EmbeddingVersion: "embed-v1", EmbeddingFormat: "f32le",
		Embedding: []byte{0, 0, 0, 0}, CreatedAt: old, UpdatedAt: old,
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterFace{
		ClusterID: cluster.ID, FaceID: face.ID, Confidence: 0.9,
		CreatedAt: old, UpdatedAt: old,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonClusterState{
		OwnerID:          owner.ID,
		AnalyzerVersion:  photointelligence.PersonClusterAnalyzerVersion(),
		EmbeddingVersion: "embed-v1", InputFingerprint: "cluster-input:owner",
		FaceCount: 1, State: meta.PhotoAnalysisStatePending,
		CreatedAt: old, UpdatedAt: old,
	}).Error; err != nil {
		t.Fatal(err)
	}

	dry, err := GarbageCollectPhotoIntelligence(context.Background(), db, true)
	if err != nil {
		t.Fatal(err)
	}
	if dry.CandidateClusters != 1 || dry.Actions[0].Reason != "state_not_ready" ||
		dry.Actions[0].Applied {
		t.Fatalf("dry GC=%+v", dry)
	}
	applied, err := GarbageCollectPhotoIntelligence(context.Background(), db, false)
	if err != nil {
		t.Fatal(err)
	}
	if applied.DeletedClusters != 1 || !applied.Actions[0].Applied {
		t.Fatalf("applied GC=%+v", applied)
	}
	var clusterCount, stateCount, faceCount int64
	if err := db.Model(&meta.PhotoPersonCluster{}).Count(&clusterCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoPersonClusterState{}).Count(&stateCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoFace{}).Count(&faceCount).Error; err != nil {
		t.Fatal(err)
	}
	if clusterCount != 0 || stateCount != 1 || faceCount != 1 {
		t.Fatalf(
			"post-GC clusters=%d states=%d faces=%d",
			clusterCount,
			stateCount,
			faceCount,
		)
	}
}

func openMediaPersonIntegrityTestDB(t *testing.T, suffix string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_person_integrity_" + suffix + "_" +
		strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
		&meta.PhotoCollection{}, &meta.PhotoAnalysisState{}, &meta.PhotoFace{},
		&meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedMediaPersonIntegrityOwners(
	t *testing.T,
	db *gorm.DB,
) (meta.User, meta.User, meta.PhotoAsset, meta.PhotoAsset) {
	t.Helper()
	owner := meta.User{
		Username: "photo-integrity-owner-" + uuid.NewString(), PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	other := meta.User{
		Username: "photo-integrity-other-" + uuid.NewString(), PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{Name: "owner.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{Name: "other.jpg", Type: meta.NodeTypeFile, OwnerID: other.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	assets := []meta.PhotoAsset{
		{
			OwnerID: owner.ID, PrimaryNodeID: nodes[0].ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: "integrity:owner:" + uuid.NewString(),
		},
		{
			OwnerID: other.ID, PrimaryNodeID: nodes[1].ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: "integrity:other:" + uuid.NewString(),
		},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	return owner, other, assets[0], assets[1]
}
