package meta

import "time"

const (
	PhotoAnalysisKindFaceDetection = "face_detection"
	PhotoAnalysisKindFaceEmbedding = "face_embedding"
	PhotoAnalysisKindPlaceLabel    = "place_label"
	PhotoAnalysisKindVisualLabel   = "visual_label"
	PhotoAnalysisKindOCRText       = "ocr_text"

	PhotoAnalysisStatePending = "pending"
	PhotoAnalysisStateRunning = "running"
	PhotoAnalysisStateReady   = "ready"
	PhotoAnalysisStateFailed  = "failed"
	PhotoAnalysisStateStale   = "stale"
)

type PhotoAnalysisState struct {
	ID               uint64     `gorm:"primaryKey"`
	AssetID          uint64     `gorm:"not null;index;uniqueIndex:idx_xd_photo_analysis_asset_kind,priority:1"`
	Kind             string     `gorm:"size:32;not null;index;uniqueIndex:idx_xd_photo_analysis_asset_kind,priority:2"`
	AnalyzerVersion  string     `gorm:"size:128;not null"`
	InputFingerprint string     `gorm:"size:128;not null;index"`
	State            string     `gorm:"size:16;not null;default:pending;index"`
	Attempt          uint       `gorm:"not null;default:0"`
	LastError        string     `gorm:"type:text"`
	CompletedAt      *time.Time `gorm:"index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoAnalysisState) TableName() string { return "xd_photo_analysis_states" }

type PhotoFace struct {
	ID               uint64  `gorm:"primaryKey"`
	AssetID          uint64  `gorm:"not null;index;uniqueIndex:idx_xd_photo_faces_asset_detection,priority:1"`
	DetectionKey     string  `gorm:"size:128;not null;uniqueIndex:idx_xd_photo_faces_asset_detection,priority:2"`
	AnalyzerVersion  string  `gorm:"size:128;not null;index"`
	X                float64 `gorm:"not null"`
	Y                float64 `gorm:"not null"`
	Width            float64 `gorm:"not null"`
	Height           float64 `gorm:"not null"`
	Confidence       float64 `gorm:"not null;default:0"`
	LandmarksJSON    string  `gorm:"type:text"`
	Embedding        []byte  `gorm:"type:bytea"`
	EmbeddingFormat  string  `gorm:"size:32"`
	EmbeddingVersion string  `gorm:"size:128"`
	CreatedAt        time.Time
	UpdatedAt        time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoFace) TableName() string { return "xd_photo_faces" }

type PhotoPersonCluster struct {
	ID               uint64 `gorm:"primaryKey"`
	OwnerID          uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_person_clusters_owner_key,priority:1"`
	ClusterKey       string `gorm:"size:128;not null;uniqueIndex:idx_xd_photo_person_clusters_owner_key,priority:2"`
	AnalyzerVersion  string `gorm:"size:128;not null;index"`
	Embedding        []byte `gorm:"type:bytea"`
	EmbeddingFormat  string `gorm:"size:32"`
	EmbeddingVersion string `gorm:"size:128"`
	CreatedAt        time.Time
	UpdatedAt        time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoPersonCluster) TableName() string { return "xd_photo_person_clusters" }

type PhotoPersonClusterFace struct {
	ClusterID  uint64  `gorm:"primaryKey;autoIncrement:false;index"`
	FaceID     uint64  `gorm:"primaryKey;autoIncrement:false;index;uniqueIndex"`
	Confidence float64 `gorm:"not null;default:0"`
	CreatedAt  time.Time
	UpdatedAt  time.Time

	Cluster PhotoPersonCluster `gorm:"foreignKey:ClusterID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Face    PhotoFace          `gorm:"foreignKey:FaceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoPersonClusterFace) TableName() string { return "xd_photo_person_cluster_faces" }

type PhotoPersonClusterState struct {
	OwnerID          uint64     `gorm:"primaryKey;autoIncrement:false"`
	AnalyzerVersion  string     `gorm:"size:128;not null"`
	EmbeddingVersion string     `gorm:"size:128"`
	InputFingerprint string     `gorm:"size:128;not null;index"`
	FaceCount        uint64     `gorm:"not null;default:0"`
	SourceUpdatedAt  *time.Time `gorm:"index"`
	State            string     `gorm:"size:16;not null;default:pending;index"`
	Attempt          uint       `gorm:"not null;default:0"`
	LastError        string     `gorm:"type:text"`
	CompletedAt      *time.Time `gorm:"index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoPersonClusterState) TableName() string {
	return "xd_photo_person_cluster_states"
}

type PhotoIntelligenceReanalyzeIntent struct {
	OwnerID        uint64     `gorm:"primaryKey;autoIncrement:false"`
	Kind           string     `gorm:"primaryKey;size:32"`
	RequestedEpoch uint64     `gorm:"not null;default:0"`
	AppliedEpoch   uint64     `gorm:"not null;default:0"`
	CancelledEpoch uint64     `gorm:"not null;default:0"`
	Trigger        string     `gorm:"size:32;not null"`
	Initiator      string     `gorm:"size:16;not null"`
	InitiatorID    uint64     `gorm:"not null;default:0"`
	RequestedAt    time.Time  `gorm:"not null;index"`
	AppliedAt      *time.Time `gorm:"index"`
	CancelledAt    *time.Time `gorm:"index"`
	CreatedAt      time.Time
	UpdatedAt      time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoIntelligenceReanalyzeIntent) TableName() string {
	return "xd_photo_intelligence_reanalyze_intents"
}

type PhotoPerson struct {
	ID           uint64  `gorm:"primaryKey"`
	OwnerID      uint64  `gorm:"not null;index"`
	PersonKey    string  `gorm:"size:64;not null;uniqueIndex"`
	Name         string  `gorm:"size:128;not null;default:'';index"`
	Hidden       bool    `gorm:"not null;default:false;index"`
	CoverAssetID *uint64 `gorm:"index"`
	Revision     uint64  `gorm:"not null;default:1"`
	CreatedAt    time.Time
	UpdatedAt    time.Time

	Owner      User       `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	CoverAsset PhotoAsset `gorm:"foreignKey:CoverAssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
}

func (PhotoPerson) TableName() string { return "xd_photo_people" }

type PhotoPersonAsset struct {
	PersonID  uint64 `gorm:"primaryKey;autoIncrement:false;index"`
	AssetID   uint64 `gorm:"primaryKey;autoIncrement:false;index"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Person PhotoPerson `gorm:"foreignKey:PersonID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Asset  PhotoAsset  `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoPersonAsset) TableName() string { return "xd_photo_person_assets" }

type PhotoPlaceLabel struct {
	AssetID         uint64  `gorm:"primaryKey;autoIncrement:false"`
	Resolver        string  `gorm:"size:64;not null;index"`
	ResolverVersion string  `gorm:"size:128;not null"`
	Latitude        float64 `gorm:"not null;index"`
	Longitude       float64 `gorm:"not null;index"`
	CountryCode     string  `gorm:"size:8;index"`
	Country         string  `gorm:"size:128;index"`
	Region          string  `gorm:"size:128;index"`
	City            string  `gorm:"size:128;index"`
	District        string  `gorm:"size:128;index"`
	Locality        string  `gorm:"size:256;index"`
	Formatted       string  `gorm:"size:512;not null"`
	CreatedAt       time.Time
	UpdatedAt       time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoPlaceLabel) TableName() string { return "xd_photo_place_labels" }

type PhotoVisualLabel struct {
	ID         uint64  `gorm:"primaryKey"`
	AssetID    uint64  `gorm:"not null;index;uniqueIndex:idx_xd_photo_visual_labels_asset_label,priority:1"`
	Label      string  `gorm:"size:128;not null;index;uniqueIndex:idx_xd_photo_visual_labels_asset_label,priority:2"`
	Confidence float64 `gorm:"not null;default:0;index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoVisualLabel) TableName() string { return "xd_photo_visual_labels" }

type PhotoOCRText struct {
	AssetID   uint64 `gorm:"primaryKey;autoIncrement:false"`
	Text      string `gorm:"type:text;not null"`
	Language  string `gorm:"size:32;not null;default:'zh-en'"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoOCRText) TableName() string { return "xd_photo_ocr_texts" }

func ValidPhotoAnalysisKind(kind string) bool {
	switch kind {
	case PhotoAnalysisKindFaceDetection, PhotoAnalysisKindFaceEmbedding, PhotoAnalysisKindPlaceLabel,
		PhotoAnalysisKindVisualLabel, PhotoAnalysisKindOCRText:
		return true
	default:
		return false
	}
}

func ValidPhotoAnalysisState(state string) bool {
	switch state {
	case PhotoAnalysisStatePending, PhotoAnalysisStateRunning, PhotoAnalysisStateReady,
		PhotoAnalysisStateFailed, PhotoAnalysisStateStale:
		return true
	default:
		return false
	}
}
