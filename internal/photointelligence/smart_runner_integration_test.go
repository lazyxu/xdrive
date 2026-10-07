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

type fakeSmartAnalyzer struct {
	info   SmartAnalyzerInfo
	result SmartAnalysisResult
}

func (a fakeSmartAnalyzer) Info(context.Context) (SmartAnalyzerInfo, error) {
	return a.info, nil
}

func (a fakeSmartAnalyzer) Analyze(
	context.Context,
	SmartAnalysisTask,
) (SmartAnalysisResult, error) {
	return a.result, nil
}

func TestSmartRunnerPersistsSearchEvidence(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_smart_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.PhotoVisualLabel{}, &meta.PhotoOCRText{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "smart-" + uuid.NewString(),
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
		StorageKey: "smart",
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
		EvidenceKey:   "smart:" + uuid.NewString(),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	info := testSmartAnalyzerInfo()
	runner := &SmartRunner{
		DB: db,
		Analyzer: fakeSmartAnalyzer{
			info: info,
			result: SmartAnalysisResult{
				Labels: []SmartVisualLabel{
					{Label: "golden retriever", Confidence: 0.92},
					{Label: "seashore", Confidence: 0.70},
				},
				OCRText:     "上海 Marina 2026",
				OCRLanguage: "zh-en",
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
	}

	owners, err := runner.CandidateOwnerIDs(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(owners) != 1 || owners[0] != user.ID {
		t.Fatalf("candidate owners=%v", owners)
	}
	processed, err := runner.RunOwnerBatch(context.Background(), user.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed=%d want 1", processed)
	}

	var labels []meta.PhotoVisualLabel
	if err := db.Where("asset_id = ?", asset.ID).
		Order("confidence DESC").
		Find(&labels).Error; err != nil {
		t.Fatal(err)
	}
	if len(labels) != 2 ||
		labels[0].Label != "golden retriever" ||
		labels[0].Confidence != 0.92 {
		t.Fatalf("labels=%+v", labels)
	}
	var ocr meta.PhotoOCRText
	if err := db.First(&ocr, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ocr.Text != "上海 Marina 2026" || ocr.Language != "zh-en" {
		t.Fatalf("ocr=%+v", ocr)
	}
	for _, kind := range []string{
		meta.PhotoAnalysisKindVisualLabel,
		meta.PhotoAnalysisKindOCRText,
	} {
		var state meta.PhotoAnalysisState
		if err := db.Where("asset_id = ? AND kind = ?", asset.ID, kind).
			First(&state).Error; err != nil {
			t.Fatal(err)
		}
		if state.State != meta.PhotoAnalysisStateReady ||
			state.InputFingerprint == "" {
			t.Fatalf("state=%+v", state)
		}
	}

	processed, err = runner.RunOwnerBatch(context.Background(), user.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 {
		t.Fatalf("stable ready state reprocessed %d assets", processed)
	}
}
