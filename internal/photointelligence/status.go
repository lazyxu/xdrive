package photointelligence

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type AnalysisStateCounts struct {
	Pending int64 `json:"pending"`
	Running int64 `json:"running"`
	Ready   int64 `json:"ready"`
	Failed  int64 `json:"failed"`
	Stale   int64 `json:"stale"`
}

type PhotoIntelligenceDatabaseStatus struct {
	PhotoAssets              int64               `json:"photo_assets"`
	FaceRows                 int64               `json:"face_rows"`
	PlaceLabels              int64               `json:"place_labels"`
	VisualLabels             int64               `json:"visual_labels"`
	OCRDocuments             int64               `json:"ocr_documents"`
	SemanticEmbeddings       int64               `json:"semantic_embeddings"`
	AutomaticClusters        int64               `json:"automatic_clusters"`
	AutomaticClusterFaces    int64               `json:"automatic_cluster_faces"`
	DurablePeople            int64               `json:"durable_people"`
	DurablePersonMemberships int64               `json:"durable_person_memberships"`
	FaceDetection            AnalysisStateCounts `json:"face_detection"`
	FaceEmbedding            AnalysisStateCounts `json:"face_embedding"`
	PlaceAnalysis            AnalysisStateCounts `json:"place_analysis"`
	VisualAnalysis           AnalysisStateCounts `json:"visual_analysis"`
	OCRAnalysis              AnalysisStateCounts `json:"ocr_analysis"`
	SemanticAnalysis         AnalysisStateCounts `json:"semantic_analysis"`
	PersonClustering         AnalysisStateCounts `json:"person_clustering"`
}

type photoAnalysisStateCountRow struct {
	Kind  string
	State string
	Count int64
}

type personClusterStateCountRow struct {
	State string
	Count int64
}

func LoadPhotoIntelligenceDatabaseStatus(
	ctx context.Context,
	db *gorm.DB,
) (PhotoIntelligenceDatabaseStatus, error) {
	var status PhotoIntelligenceDatabaseStatus
	if db == nil {
		return status, fmt.Errorf("photo intelligence status database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	scoped := db.WithContext(ctx)

	counts := []struct {
		model any
		dest  *int64
		label string
	}{
		{&meta.PhotoAsset{}, &status.PhotoAssets, "photo assets"},
		{&meta.PhotoFace{}, &status.FaceRows, "photo faces"},
		{&meta.PhotoPlaceLabel{}, &status.PlaceLabels, "photo place labels"},
		{&meta.PhotoVisualLabel{}, &status.VisualLabels, "photo visual labels"},
		{&meta.PhotoOCRText{}, &status.OCRDocuments, "photo OCR documents"},
		{&meta.PhotoSemanticEmbedding{}, &status.SemanticEmbeddings, "photo semantic embeddings"},
		{&meta.PhotoPersonCluster{}, &status.AutomaticClusters, "automatic person clusters"},
		{&meta.PhotoPersonClusterFace{}, &status.AutomaticClusterFaces, "automatic cluster faces"},
		{&meta.PhotoPerson{}, &status.DurablePeople, "durable people"},
		{&meta.PhotoPersonAsset{}, &status.DurablePersonMemberships, "durable person memberships"},
	}
	for _, item := range counts {
		if err := scoped.Model(item.model).Count(item.dest).Error; err != nil {
			return status, fmt.Errorf("count %s: %w", item.label, err)
		}
	}

	var analysisRows []photoAnalysisStateCountRow
	if err := scoped.Model(&meta.PhotoAnalysisState{}).
		Select("kind, state, COUNT(*) AS count").
		Group("kind, state").
		Scan(&analysisRows).Error; err != nil {
		return status, fmt.Errorf("count photo analysis states: %w", err)
	}
	for _, row := range analysisRows {
		target := (*AnalysisStateCounts)(nil)
		switch row.Kind {
		case meta.PhotoAnalysisKindFaceDetection:
			target = &status.FaceDetection
		case meta.PhotoAnalysisKindFaceEmbedding:
			target = &status.FaceEmbedding
		case meta.PhotoAnalysisKindPlaceLabel:
			target = &status.PlaceAnalysis
		case meta.PhotoAnalysisKindVisualLabel:
			target = &status.VisualAnalysis
		case meta.PhotoAnalysisKindOCRText:
			target = &status.OCRAnalysis
		case meta.PhotoAnalysisKindSemanticEmbedding:
			target = &status.SemanticAnalysis
		default:
			continue
		}
		addAnalysisStateCount(target, row.State, row.Count)
	}

	var clusterRows []personClusterStateCountRow
	if err := scoped.Model(&meta.PhotoPersonClusterState{}).
		Select("state, COUNT(*) AS count").
		Group("state").
		Scan(&clusterRows).Error; err != nil {
		return status, fmt.Errorf("count person cluster states: %w", err)
	}
	for _, row := range clusterRows {
		addAnalysisStateCount(&status.PersonClustering, row.State, row.Count)
	}

	return status, nil
}

func addAnalysisStateCount(
	counts *AnalysisStateCounts,
	state string,
	value int64,
) {
	switch state {
	case meta.PhotoAnalysisStatePending:
		counts.Pending += value
	case meta.PhotoAnalysisStateRunning:
		counts.Running += value
	case meta.PhotoAnalysisStateReady:
		counts.Ready += value
	case meta.PhotoAnalysisStateFailed:
		counts.Failed += value
	case meta.PhotoAnalysisStateStale:
		counts.Stale += value
	}
}
