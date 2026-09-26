package meta

import "time"

const (
	SourceCollectionStateActive  = "active"
	SourceCollectionStateMissing = "missing"
)

// SourceCollection represents a connector-owned logical collection such as a
// photo album. It is metadata only and never owns or duplicates xDrive Nodes.
type SourceCollection struct {
	ID             uint64    `gorm:"primaryKey"`
	SourceID       uint64    `gorm:"not null;index;uniqueIndex:idx_xd_source_collections_source_external"`
	ExternalID     string    `gorm:"size:512;not null;uniqueIndex:idx_xd_source_collections_source_external"`
	Kind           string    `gorm:"size:32;not null;index"`
	Name           string    `gorm:"size:512;not null"`
	State          string    `gorm:"size:16;not null;default:active;index"`
	RemoteRevision string    `gorm:"size:255"`
	LastSeenRunID  string    `gorm:"size:36;index"`
	LastSeenAt     time.Time `gorm:"not null;index"`
	CreatedAt      time.Time
	UpdatedAt      time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceCollection) TableName() string { return "xd_source_collections" }

// SourceCollectionItem links one logical collection to one stable SourceItem.
// A media object may belong to many collections without creating duplicate
// xDrive Nodes or CAS objects.
type SourceCollectionItem struct {
	ID            uint64    `gorm:"primaryKey"`
	CollectionID  uint64    `gorm:"not null;index;uniqueIndex:idx_xd_source_collection_items_collection_item"`
	SourceItemID  uint64    `gorm:"not null;index;uniqueIndex:idx_xd_source_collection_items_collection_item"`
	Position      int64     `gorm:"not null;default:0"`
	LastSeenRunID string    `gorm:"size:36;not null;index"`
	LastSeenAt    time.Time `gorm:"not null;index"`
	CreatedAt     time.Time
	UpdatedAt     time.Time

	Collection SourceCollection `gorm:"foreignKey:CollectionID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceItem SourceItem       `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceCollectionItem) TableName() string { return "xd_source_collection_items" }

func ValidSourceCollectionState(state string) bool {
	return state == SourceCollectionStateActive || state == SourceCollectionStateMissing
}
