package photointelligence

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type fakeFaceAnalyzer struct {
	info         FaceAnalyzerInfo
	infoCalls    int
	analyzeCalls int
	tasks        []FaceAnalysisTask
}

func (a *fakeFaceAnalyzer) Info(context.Context) (FaceAnalyzerInfo, error) {
	a.infoCalls++
	return a.info, nil
}

func (a *fakeFaceAnalyzer) Analyze(
	ctx context.Context,
	task FaceAnalysisTask,
) ([]FaceObservation, error) {
	a.analyzeCalls++
	a.tasks = append(a.tasks, task)
	return []FaceObservation{
		{
			Box: NormalizedBox{
				X: 0.1, Y: 0.2, Width: 0.3, Height: 0.4,
			},
			Landmarks: []NormalizedPoint{
				{X: 0.17, Y: 0.31},
				{X: 0.32, Y: 0.31},
				{X: 0.245, Y: 0.39},
				{X: 0.18, Y: 0.50},
				{X: 0.31, Y: 0.50},
			},
			Confidence: 0.98,
			Embedding:  testEmbedding(a.info.EmbeddingDimensions),
		},
	}, nil
}

func TestFaceRunnerPersistsAndInvalidatesDerivedFaces(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_face_runner_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.File{},
		&meta.MediaMetadata{},
		&meta.PhotoAsset{},
		&meta.PhotoAnalysisState{},
		&meta.PhotoFace{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "face-runner-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 7,
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
	node := meta.Node{
		ParentID: &root.ID,
		Name:     "portrait.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}

	firstSHA := strings.Repeat("a", 64)
	file := meta.File{
		NodeID:     node.ID,
		Size:       100,
		StorageKey: "portrait-v1",
		SHA256:     firstSHA,
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	media := meta.MediaMetadata{
		NodeID:       node.ID,
		OwnerID:      owner.ID,
		NodeRevision: node.Revision,
		SHA256:       firstSHA,
		MediaKind:    meta.MediaKindImage,
		MIMEType:     "image/jpeg",
		Width:        800,
		Height:       600,
		Orientation:  1,
		IndexState:   meta.MediaIndexStateReady,
	}
	if err := db.Create(&media).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       owner.ID,
		PrimaryNodeID: node.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "node:portrait",
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	info := testFaceAnalyzerInfo()
	analyzer := &fakeFaceAnalyzer{info: info}
	current := time.Date(2026, 10, 5, 11, 0, 0, 0, time.UTC)
	previewCalls := 0
	runner := &FaceRunner{
		DB:       db,
		Analyzer: analyzer,
		PreviewURL: func(
			ctx context.Context,
			ownerID, sessionVersion, nodeID, nodeRevision uint64,
		) (string, error) {
			previewCalls++
			if ownerID != owner.ID ||
				sessionVersion != owner.SessionVersion ||
				nodeID != node.ID {
				return "", fmt.Errorf(
					"unexpected preview identity owner=%d session=%d node=%d",
					ownerID,
					sessionVersion,
					nodeID,
				)
			}
			return fmt.Sprintf(
				"http://server:8080/api/v1/media-analysis-preview/%d?ticket=rev-%d",
				nodeID,
				nodeRevision,
			), nil
		},
		Now: func() time.Time {
			return current
		},
	}

	processed, err := runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || analyzer.analyzeCalls != 1 || previewCalls != 1 {
		t.Fatalf(
			"first run processed=%d analyze=%d preview=%d",
			processed,
			analyzer.analyzeCalls,
			previewCalls,
		)
	}
	expectedFingerprint := mediapkg.AnalysisPreviewFingerprint(
		node.ID,
		node.Revision,
		firstSHA,
	)
	if len(analyzer.tasks) != 1 ||
		analyzer.tasks[0].InputFingerprint != expectedFingerprint ||
		analyzer.tasks[0].PreviewVersion != mediapkg.AnalysisPreviewVersion ||
		analyzer.tasks[0].PreviewEdge != mediapkg.AnalysisPreviewEdge {
		t.Fatalf("task=%+v", analyzer.tasks)
	}

	var face meta.PhotoFace
	if err := db.First(&face, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if face.DetectionKey != "face:000" ||
		face.Confidence != 0.98 ||
		face.LandmarksJSON == "" ||
		len(face.Embedding) != info.EmbeddingDimensions*4 ||
		face.EmbeddingFormat != "f32le" {
		t.Fatalf("face=%+v", face)
	}

	var states []meta.PhotoAnalysisState
	if err := db.Where("asset_id = ?", asset.ID).
		Order("kind ASC").
		Find(&states).Error; err != nil {
		t.Fatal(err)
	}
	if len(states) != 2 {
		t.Fatalf("states=%+v", states)
	}
	for _, state := range states {
		if state.State != meta.PhotoAnalysisStateReady ||
			state.Attempt != 1 ||
			state.InputFingerprint != expectedFingerprint {
			t.Fatalf("state=%+v", state)
		}
	}

	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 || analyzer.analyzeCalls != 1 {
		t.Fatalf(
			"unchanged run processed=%d analyze=%d",
			processed,
			analyzer.analyzeCalls,
		)
	}

	current = current.Add(time.Minute)
	analyzer.info.Detector.SHA256 = strings.Repeat("c", 64)
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || analyzer.analyzeCalls != 2 {
		t.Fatalf(
			"model change processed=%d analyze=%d",
			processed,
			analyzer.analyzeCalls,
		)
	}

	secondSHA := strings.Repeat("d", 64)
	current = current.Add(time.Minute)
	if err := db.Model(&meta.Node{}).
		Where("id = ?", node.ID).
		Updates(map[string]any{
			"revision":   2,
			"updated_at": current,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).
		Where("node_id = ?", node.ID).
		Updates(map[string]any{
			"storage_key": "portrait-v2",
			"sha256":      secondSHA,
			"updated_at":  current,
		}).Error; err != nil {
		t.Fatal(err)
	}

	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 || analyzer.analyzeCalls != 2 {
		t.Fatalf(
			"stale media metadata was analyzed processed=%d analyze=%d",
			processed,
			analyzer.analyzeCalls,
		)
	}

	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", node.ID).
		Updates(map[string]any{
			"node_revision": 2,
			"sha256":        secondSHA,
			"updated_at":    current,
		}).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || analyzer.analyzeCalls != 3 {
		t.Fatalf(
			"content change processed=%d analyze=%d",
			processed,
			analyzer.analyzeCalls,
		)
	}
	expectedFingerprint = mediapkg.AnalysisPreviewFingerprint(
		node.ID,
		2,
		secondSHA,
	)
	states = nil
	if err := db.Where("asset_id = ?", asset.ID).
		Order("kind ASC").
		Find(&states).Error; err != nil {
		t.Fatal(err)
	}
	for _, state := range states {
		if state.InputFingerprint != expectedFingerprint ||
			state.Attempt != 3 ||
			state.State != meta.PhotoAnalysisStateReady {
			t.Fatalf("updated state=%+v", state)
		}
	}
}
