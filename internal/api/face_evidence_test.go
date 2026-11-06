package api

import (
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Fixture rows must carry the same current-pixel evidence as real FaceRunner
// output; arbitrary ready clusters no longer authorize access or adoption.
func seedCurrentFaceEvidence(t *testing.T, db *gorm.DB, faces []meta.PhotoFace) {
	t.Helper()
	for _, face := range faces {
		var asset meta.PhotoAsset
		var node meta.Node
		var file meta.File
		if err := db.First(&asset, face.AssetID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&node, asset.PrimaryNodeID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
			t.Fatal(err)
		}
		for kind, version := range map[string]string{meta.PhotoAnalysisKindFaceDetection: face.AnalyzerVersion, meta.PhotoAnalysisKindFaceEmbedding: face.EmbeddingVersion} {
			row := meta.PhotoAnalysisState{AssetID: asset.ID, Kind: kind, AnalyzerVersion: version,
				State: meta.PhotoAnalysisStateReady, InputFingerprint: mediapkg.AnalysisPreviewFingerprint(node.ID, node.Revision, file.SHA256)}
			if err := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}, {Name: "kind"}}, UpdateAll: true}).Create(&row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
}
