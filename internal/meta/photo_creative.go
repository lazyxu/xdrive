package meta

import "time"

const (
	PhotoCreativeKindErase  = "erase"
	PhotoCreativeKindCutout = "cutout"
	PhotoCreativeKindMovie  = "movie"

	PhotoCreativeStateQueued    = "queued"
	PhotoCreativeStateRunning   = "running"
	PhotoCreativeStateCompleted = "completed"
	PhotoCreativeStateFailed    = "failed"
	PhotoCreativeStateCancelled = "cancelled"
)

type PhotoCreativeGeneration struct {
	ID                 string  `gorm:"primaryKey;size:64"`
	OwnerID            uint64  `gorm:"not null;index"`
	Kind               string  `gorm:"size:32;not null;index"`
	SourceAssetID      uint64  `gorm:"not null;index"`
	SourceNodeID       uint64  `gorm:"not null;index"`
	SourceNodeRevision uint64  `gorm:"not null"`
	SourceSHA256       string  `gorm:"size:64;not null;index"`
	RecipeJSON         string  `gorm:"type:text;not null"`
	AnalyzerVersion    string  `gorm:"size:128;not null;default:'';index"`
	State              string  `gorm:"size:16;not null;index"`
	OutputNodeID       *uint64 `gorm:"index"`
	LastError          string  `gorm:"type:text"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
	CompletedAt        *time.Time

	Owner       User       `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceAsset PhotoAsset `gorm:"foreignKey:SourceAssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceNode  Node       `gorm:"foreignKey:SourceNodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	OutputNode  *Node      `gorm:"foreignKey:OutputNodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
}

func (PhotoCreativeGeneration) TableName() string {
	return "xd_photo_creative_generations"
}

func ValidPhotoCreativeKind(kind string) bool {
	switch kind {
	case PhotoCreativeKindErase, PhotoCreativeKindCutout, PhotoCreativeKindMovie:
		return true
	default:
		return false
	}
}

func ValidPhotoCreativeState(state string) bool {
	switch state {
	case PhotoCreativeStateQueued,
		PhotoCreativeStateRunning,
		PhotoCreativeStateCompleted,
		PhotoCreativeStateFailed,
		PhotoCreativeStateCancelled:
		return true
	default:
		return false
	}
}
