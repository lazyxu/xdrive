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

type fakeSemanticAnalyzer struct {
	info  SemanticAnalyzerInfo
	image SemanticEmbedding
	text  SemanticEmbedding
}

func (a fakeSemanticAnalyzer) Info(context.Context) (SemanticAnalyzerInfo, error) {
	return a.info, nil
}

func (a fakeSemanticAnalyzer) EmbedImage(
	context.Context,
	SemanticImageTask,
) (SemanticEmbedding, error) {
	return a.image, nil
}

func (a fakeSemanticAnalyzer) EmbedText(
	context.Context,
	string,
) (SemanticEmbedding, error) {
	return a.text, nil
}

func TestSemanticRunnerPersistsReadyEmbedding(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_semantic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.PhotoAnalysisState{},
		&meta.PhotoSemanticEmbedding{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "semantic-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		Name:     "photo.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.File{
		NodeID:     node.ID,
		Size:       123,
		StorageKey: "semantic",
		SHA256:     strings.Repeat("a", 64),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{
		NodeID:       node.ID,
		OwnerID:      user.ID,
		NodeRevision: node.Revision,
		SHA256:       file.SHA256,
		MediaKind:    meta.MediaKindImage,
		MIMEType:     "image/jpeg",
		IndexState:   meta.MediaIndexStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       user.ID,
		PrimaryNodeID: node.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "semantic:" + uuid.NewString(),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	info := testSemanticAnalyzerInfo()
	raw := make([]byte, info.EmbeddingDimensions)
	raw[0] = 127
	updated := uint64(0)
	runner := &SemanticRunner{
		DB: db,
		Analyzer: fakeSemanticAnalyzer{
			info: info,
			image: SemanticEmbedding{
				Embedding:  raw,
				Format:     info.EmbeddingFormat,
				Dimensions: info.EmbeddingDimensions,
			},
		},
		PreviewURL: func(
			context.Context,
			uint64,
			uint64,
			uint64,
			uint64,
		) (string, error) {
			return "http://server:8080/api/v1/media-analysis-preview/1?ticket=test", nil
		},
		OnUpdated: func(ownerID uint64) {
			updated = ownerID
		},
	}

	owners, err := runner.CandidateOwnerIDs(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(owners) != 1 || owners[0] != user.ID {
		t.Fatalf("owners=%v", owners)
	}
	processed, err := runner.RunOwnerBatch(context.Background(), user.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || updated != user.ID {
		t.Fatalf("processed=%d updated=%d", processed, updated)
	}

	var embedding meta.PhotoSemanticEmbedding
	if err := db.First(&embedding, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if embedding.OwnerID != user.ID ||
		embedding.AnalyzerVersion != SemanticAnalyzerVersion(info) ||
		embedding.EmbeddingFormat != info.EmbeddingFormat ||
		embedding.Dimensions != info.EmbeddingDimensions ||
		len(embedding.Embedding) != info.EmbeddingDimensions {
		t.Fatalf("embedding=%+v", embedding)
	}
	var state meta.PhotoAnalysisState
	if err := db.Where(
		"asset_id = ? AND kind = ?",
		asset.ID,
		meta.PhotoAnalysisKindSemanticEmbedding,
	).First(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.State != meta.PhotoAnalysisStateReady ||
		state.AnalyzerVersion != SemanticAnalyzerVersion(info) ||
		state.InputFingerprint == "" {
		t.Fatalf("state=%+v", state)
	}

	processed, err = runner.RunOwnerBatch(context.Background(), user.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 {
		t.Fatalf("stable semantic embedding reprocessed %d assets", processed)
	}
}
