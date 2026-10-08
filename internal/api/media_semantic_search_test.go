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
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type fakeGallerySemanticAnalyzer struct {
	info  photointelligence.SemanticAnalyzerInfo
	query photointelligence.SemanticEmbedding
}

func (a fakeGallerySemanticAnalyzer) Info(
	context.Context,
) (photointelligence.SemanticAnalyzerInfo, error) {
	return a.info, nil
}

func (a fakeGallerySemanticAnalyzer) EmbedImage(
	context.Context,
	photointelligence.SemanticImageTask,
) (photointelligence.SemanticEmbedding, error) {
	return photointelligence.SemanticEmbedding{}, fmt.Errorf("unexpected image embedding")
}

func (a fakeGallerySemanticAnalyzer) EmbedText(
	context.Context,
	string,
) (photointelligence.SemanticEmbedding, error) {
	return a.query, nil
}

func TestSemanticPage(t *testing.T) {
	got := semanticPage([]uint64{9, 8, 7, 6}, 2, 1)
	if fmt.Sprint(got) != "[8 7]" {
		t.Fatalf("page=%v", got)
	}
	if got := semanticPage([]uint64{1}, 10, 2); len(got) != 0 {
		t.Fatalf("out-of-range page=%v", got)
	}
}

func TestCosineI8Normalized(t *testing.T) {
	if got := cosineI8Normalized([]byte{127, 0}, []byte{127, 0}); got < 0.999 {
		t.Fatalf("same cosine=%f", got)
	}
	if got := cosineI8Normalized([]byte{127, 0}, []byte{0, 127}); got > 0.001 {
		t.Fatalf("orthogonal cosine=%f", got)
	}
}

func TestGallerySemanticSearchRanksLexicalThenSemantic(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()
	schema := "gallery_semantic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoMetadata{}, &meta.PhotoResource{},
		&meta.PhotoAnalysisState{}, &meta.PhotoSemanticEmbedding{},
		&meta.PhotoVisualLabel{}, &meta.PhotoOCRText{}, &meta.PhotoPlaceLabel{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "semantic-gallery-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "海边的狗.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &root.ID, Name: "IMG_0002.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &root.ID, Name: "IMG_0003.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	info := photointelligence.SemanticAnalyzerInfo{
		ProtocolVersion: photointelligence.SemanticAnalyzerProtocolVersion,
		Name:            "test-semantic",
		PipelineVersion: "v1",
		VisionModel: photointelligence.FaceAnalyzerModelInfo{
			Name: "vision", Version: "v1", SHA256: strings.Repeat("a", 64), License: "Apache-2.0",
		},
		TextModel: photointelligence.FaceAnalyzerModelInfo{
			Name: "text", Version: "v1", SHA256: strings.Repeat("b", 64), License: "Apache-2.0",
		},
		TokenizerSHA256:     strings.Repeat("c", 64),
		EmbeddingFormat:     photointelligence.SemanticEmbeddingFormatI8Norm,
		EmbeddingDimensions: 64,
	}
	version := photointelligence.SemanticAnalyzerVersion(info)
	queryVector := make([]byte, 64)
	queryVector[0] = 127
	embeddings := [][]byte{
		append([]byte(nil), queryVector...),
		append([]byte(nil), queryVector...),
		make([]byte, 64),
	}
	embeddings[2][1] = 127
	captured := time.Now().UTC()
	for index := range nodes {
		file := meta.File{
			NodeID:     nodes[index].ID,
			Size:       int64(index + 1),
			StorageKey: fmt.Sprintf("semantic-%d", index),
			SHA256:     strings.Repeat(fmt.Sprintf("%x", index+1), 64),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID:       nodes[index].ID,
			OwnerID:      user.ID,
			NodeRevision: 1,
			SHA256:       file.SHA256,
			MediaKind:    meta.MediaKindImage,
			MIMEType:     "image/jpeg",
			CapturedAt:   &captured,
			IndexState:   meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID:       user.ID,
			PrimaryNodeID: nodes[index].ID,
			Kind:          meta.PhotoAssetKindImage,
			EvidenceKey:   fmt.Sprintf("semantic:%d", index),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID:    asset.ID,
			MediaKind:  meta.MediaKindImage,
			MIMEType:   "image/jpeg",
			CapturedAt: &captured,
		}).Error; err != nil {
			t.Fatal(err)
		}
		ready := captured
		if err := db.Create(&meta.PhotoAnalysisState{
			AssetID:          asset.ID,
			Kind:             meta.PhotoAnalysisKindSemanticEmbedding,
			AnalyzerVersion:  version,
			InputFingerprint: fmt.Sprintf("input-%d", index),
			State:            meta.PhotoAnalysisStateReady,
			CompletedAt:      &ready,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoSemanticEmbedding{
			AssetID:         asset.ID,
			OwnerID:         user.ID,
			AnalyzerVersion: version,
			Embedding:       embeddings[index],
			EmbeddingFormat: info.EmbeddingFormat,
			Dimensions:      info.EmbeddingDimensions,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	server := &Server{
		DB: db,
		PhotoSemanticAnalyzer: fakeGallerySemanticAnalyzer{
			info: info,
			query: photointelligence.SemanticEmbedding{
				Embedding:  queryVector,
				Format:     info.EmbeddingFormat,
				Dimensions: info.EmbeddingDimensions,
			},
		},
		photoSemanticSearch: newPhotoSemanticSearchEngine(),
	}
	page, err := server.queryMediaItemRange(
		context.Background(),
		user.ID,
		mediaQueryOptions{Search: "海边的狗"},
		"",
		10,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if page.SearchOrder != "relevance" || page.TotalCount != 3 || len(page.Items) != 3 {
		t.Fatalf("page=%+v", page)
	}
	if page.Items[0].Node.ID != nodes[0].ID {
		t.Fatalf("lexical boost did not win: ids=%d,%d,%d",
			page.Items[0].Node.ID,
			page.Items[1].Node.ID,
			page.Items[2].Node.ID,
		)
	}
	if page.Items[1].Node.ID != nodes[1].ID {
		t.Fatalf("semantic match not ranked second: %+v", page.Items)
	}
	if page.TimelineGroupSets != nil || len(page.TimelineGroups) != 0 {
		t.Fatalf("semantic relevance result exposed timeline groups: %+v", page)
	}
}
