package meta

import "testing"

func TestPhotoIntelligenceModelContracts(t *testing.T) {
	if (PhotoAnalysisState{}).TableName() != "xd_photo_analysis_states" {
		t.Fatal("unexpected photo analysis state table name")
	}
	if (PhotoFace{}).TableName() != "xd_photo_faces" {
		t.Fatal("unexpected photo face table name")
	}
	if (PhotoPersonCluster{}).TableName() != "xd_photo_person_clusters" {
		t.Fatal("unexpected photo person cluster table name")
	}
	if (PhotoPersonClusterFace{}).TableName() != "xd_photo_person_cluster_faces" {
		t.Fatal("unexpected photo person cluster face table name")
	}
	if (PhotoPersonClusterState{}).TableName() != "xd_photo_person_cluster_states" {
		t.Fatal("unexpected photo person cluster state table name")
	}
	if (PhotoPerson{}).TableName() != "xd_photo_people" {
		t.Fatal("unexpected photo person table name")
	}
	if (PhotoPersonAsset{}).TableName() != "xd_photo_person_assets" {
		t.Fatal("unexpected photo person asset table name")
	}
	if (PhotoPlaceLabel{}).TableName() != "xd_photo_place_labels" {
		t.Fatal("unexpected photo place label table name")
	}
}

func TestValidPhotoAnalysisKind(t *testing.T) {
	for _, kind := range []string{
		PhotoAnalysisKindFaceDetection,
		PhotoAnalysisKindFaceEmbedding,
		PhotoAnalysisKindPlaceLabel,
	} {
		if !ValidPhotoAnalysisKind(kind) {
			t.Fatalf("expected %q to be a valid photo analysis kind", kind)
		}
	}
	for _, kind := range []string{"", "people", "provider_face", "source_metadata"} {
		if ValidPhotoAnalysisKind(kind) {
			t.Fatalf("expected %q to be rejected as a photo analysis kind", kind)
		}
	}
}

func TestValidPhotoAnalysisState(t *testing.T) {
	for _, state := range []string{
		PhotoAnalysisStatePending,
		PhotoAnalysisStateRunning,
		PhotoAnalysisStateReady,
		PhotoAnalysisStateFailed,
		PhotoAnalysisStateStale,
	} {
		if !ValidPhotoAnalysisState(state) {
			t.Fatalf("expected %q to be a valid photo analysis state", state)
		}
	}
	for _, state := range []string{"", "complete", "cancelled", "source_failed"} {
		if ValidPhotoAnalysisState(state) {
			t.Fatalf("expected %q to be rejected as a photo analysis state", state)
		}
	}
}
