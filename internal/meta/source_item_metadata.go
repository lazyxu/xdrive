package meta

import "time"

// SourceItemMetadata stores connector-neutral synchronization/provenance hints
// for one stable SourceItem. Canonical media state never belongs here: capture
// time, thumbnails, EXIF/GPS, Live Photo pairing, tags, people, favorites and
// other media semantics are derived from preserved originals by the Media layer.
type SourceItemMetadata struct {
	SourceItemID    uint64     `gorm:"primaryKey"`
	SourceID        uint64     `gorm:"not null;index"`
	OriginalPath    string     `gorm:"size:4096"`
	OwnerExternalID string     `gorm:"size:128;index"`
	RemoteCreatedAt *time.Time `gorm:"index"`
	ContentMD5      string     `gorm:"size:32;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time

	SourceItem SourceItem `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Source     Source     `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceItemMetadata) TableName() string { return "xd_source_item_metadata" }
