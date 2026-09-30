package meta

import "time"

const SourceItemAliasKindExternalID = "external_id"

// SourceItemAlias preserves a prior or alternate provider identity for one
// stable SourceItem. Alias lookup is always scoped by SourceID.
type SourceItemAlias struct {
	ID              uint64 `gorm:"primaryKey"`
	SourceID        uint64 `gorm:"not null;index;uniqueIndex:idx_xd_source_item_aliases_source_alias"`
	SourceItemID    uint64 `gorm:"not null;index"`
	AliasExternalID string `gorm:"size:512;not null;uniqueIndex:idx_xd_source_item_aliases_source_alias"`
	AliasKind       string `gorm:"size:32;not null;default:external_id;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time

	Source     Source     `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceItem SourceItem `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceItemAlias) TableName() string { return "xd_source_item_aliases" }
