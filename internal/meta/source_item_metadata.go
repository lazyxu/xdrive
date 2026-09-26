package meta

import "time"

const (
	SourceMediaPairRoleStill     = "still"
	SourceMediaPairRoleMotion    = "motion"
	SourceMediaPairRoleContainer = "container"
)

// SourceItemMetadata stores connector-neutral media metadata for one stable
// SourceItem. PairGroupID/PairRole are reserved for explicit remote pairing
// semantics such as Live Photos; connectors must not infer them from filenames.
type SourceItemMetadata struct {
	SourceItemID    uint64     `gorm:"primaryKey"`
	SourceID        uint64     `gorm:"not null;index"`
	OriginalPath    string     `gorm:"size:4096"`
	OwnerExternalID string     `gorm:"size:128;index"`
	RemoteCreatedAt *time.Time `gorm:"index"`
	ContentMD5      string     `gorm:"size:32;index"`
	ThumbnailURL    string     `gorm:"type:text"`
	PairGroupID     string     `gorm:"size:512;index"`
	PairRole        string     `gorm:"size:16;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time

	SourceItem SourceItem `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Source     Source     `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceItemMetadata) TableName() string { return "xd_source_item_metadata" }

func ValidSourceMediaPairRole(role string) bool {
	switch role {
	case "", SourceMediaPairRoleStill, SourceMediaPairRoleMotion, SourceMediaPairRoleContainer:
		return true
	default:
		return false
	}
}
