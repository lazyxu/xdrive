package api

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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSuggestedPeopleReadyProjectionAndItems(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_suggested_people_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoAnalysisState{}, &meta.PhotoFace{},
		&meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
		&meta.PhotoPlaceLabel{}, &meta.PhotoVisualLabel{}, &meta.PhotoOCRText{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "suggested-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	other := meta.User{
		Username: "suggested-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	captured := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "alice-one.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "alice-two.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "other.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := make([]meta.File, 0, len(nodes))
	for index, node := range nodes {
		file := meta.File{
			NodeID: node.ID, Size: int64(100 + index),
			StorageKey: fmt.Sprintf("file-%d", index),
			SHA256:     strings.Repeat(fmt.Sprintf("%x", index+1), 64),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		files = append(files, file)
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", CapturedAt: &captured,
			IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	assets := make([]meta.PhotoAsset, 0, len(nodes))
	for index, node := range nodes {
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: node.ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: fmt.Sprintf("evidence:%d", index),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		assets = append(assets, asset)
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", CapturedAt: &captured,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: node.Name, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: files[index].Size,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	clusterKey := mediaSuggestedPersonKeyPrefix + strings.Repeat("a", 64)
	cluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: clusterKey,
		AnalyzerVersion:  "cluster-v1",
		Embedding:        []byte{1, 2, 3, 4},
		EmbeddingFormat:  "f32le",
		EmbeddingVersion: "embed-v1",
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	state := meta.PhotoPersonClusterState{
		OwnerID: owner.ID, AnalyzerVersion: cluster.AnalyzerVersion,
		EmbeddingVersion: cluster.EmbeddingVersion,
		InputFingerprint: "person-input:test",
		FaceCount:        2, State: meta.PhotoAnalysisStatePending,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	faces := []meta.PhotoFace{
		{
			AssetID: assets[0].ID, DetectionKey: "face:000",
			AnalyzerVersion: "detector-v1", X: 0.1, Y: 0.1,
			Width: 0.3, Height: 0.3, Confidence: 0.90,
			Embedding:       []byte{1, 2, 3, 4},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
		{
			AssetID: assets[1].ID, DetectionKey: "face:000",
			AnalyzerVersion: "detector-v1", X: 0.1, Y: 0.1,
			Width: 0.3, Height: 0.3, Confidence: 0.99,
			Embedding:       []byte{1, 2, 3, 4},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
	}
	if err := db.Create(&faces).Error; err != nil {
		t.Fatal(err)
	}
	memberships := []meta.PhotoPersonClusterFace{
		{ClusterID: cluster.ID, FaceID: faces[0].ID, Confidence: 0.91},
		{ClusterID: cluster.ID, FaceID: faces[1].ID, Confidence: 0.98},
	}
	if err := db.Create(&memberships).Error; err != nil {
		t.Fatal(err)
	}

	suggestions, err := queryMediaSuggestedPeople(
		context.Background(), db, owner.ID, 24,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 0 {
		t.Fatalf("pending cluster leaked into suggestions: %+v", suggestions)
	}
	if err := ensureCurrentSuggestedPerson(
		context.Background(), db, owner.ID, clusterKey,
	); err != gorm.ErrRecordNotFound {
		t.Fatalf("pending cluster lookup err=%v want=%v", err, gorm.ErrRecordNotFound)
	}

	now := captured.Add(time.Minute)
	if err := db.Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", owner.ID).
		Updates(map[string]any{
			"state":        meta.PhotoAnalysisStateReady,
			"completed_at": &now,
			"updated_at":   now,
		}).Error; err != nil {
		t.Fatal(err)
	}

	suggestions, err = queryMediaSuggestedPeople(
		context.Background(), db, owner.ID, 24,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 1 {
		t.Fatalf("suggestions=%+v", suggestions)
	}
	suggestion := suggestions[0]
	if suggestion.ID != clusterKey ||
		suggestion.FaceCount != 2 ||
		suggestion.ItemCount != 2 ||
		suggestion.CoverNodeID == nil ||
		*suggestion.CoverNodeID != nodes[1].ID {
		t.Fatalf("suggestion=%+v", suggestion)
	}
	if err := ensureCurrentSuggestedPerson(
		context.Background(), db, other.ID, clusterKey,
	); err != gorm.ErrRecordNotFound {
		t.Fatalf("cross-owner cluster lookup err=%v", err)
	}

	server := &Server{DB: db}
	items, err := server.queryMediaItems(
		context.Background(),
		owner.ID,
		mediaQueryOptions{PersonCluster: clusterKey},
		"",
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("cluster items=%+v", items)
	}
	got := map[uint64]bool{}
	for _, item := range items {
		got[item.Node.ID] = true
	}
	if !got[nodes[0].ID] || !got[nodes[1].ID] || got[nodes[2].ID] {
		t.Fatalf("cluster item ids=%v", got)
	}

	rangePage, err := server.queryMediaItemRange(
		context.Background(),
		owner.ID,
		mediaQueryOptions{PersonCluster: clusterKey},
		"",
		1,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if rangePage.TotalCount != 2 || rangePage.Offset != 1 || rangePage.Limit != 1 ||
		len(rangePage.Items) != 1 {
		t.Fatalf("cluster range=%+v", rangePage)
	}

	filtered, err := server.queryMediaItems(
		context.Background(),
		owner.ID,
		mediaQueryOptions{
			PersonCluster: clusterKey,
			Search:        "alice-two",
		},
		"",
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 1 || filtered[0].Node.ID != nodes[1].ID {
		t.Fatalf("cluster+search items=%+v", filtered)
	}

	if err := db.Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", owner.ID).
		Update("state", meta.PhotoAnalysisStateFailed).Error; err != nil {
		t.Fatal(err)
	}
	suggestions, err = queryMediaSuggestedPeople(
		context.Background(), db, owner.ID, 24,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 0 {
		t.Fatalf("failed cluster leaked into suggestions: %+v", suggestions)
	}
	items, err = server.queryMediaItems(
		context.Background(),
		owner.ID,
		mediaQueryOptions{PersonCluster: clusterKey},
		"",
		100,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("failed cluster leaked into item filter: %+v", items)
	}
}

func TestValidMediaSuggestedPersonID(t *testing.T) {
	valid := mediaSuggestedPersonKeyPrefix + strings.Repeat("a", 64)
	if !validMediaSuggestedPersonID(valid) {
		t.Fatalf("valid key rejected: %q", valid)
	}
	for _, value := range []string{
		"",
		"auto:v1:",
		"auto:v2:" + strings.Repeat("a", 64),
		mediaSuggestedPersonKeyPrefix + strings.Repeat("g", 64),
		mediaSuggestedPersonKeyPrefix + strings.Repeat("a", 63),
	} {
		if validMediaSuggestedPersonID(value) {
			t.Fatalf("invalid key accepted: %q", value)
		}
	}
}
