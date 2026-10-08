package meta

import "time"

type FileTag struct {
	ID        uint64 `gorm:"primaryKey"`
	OwnerID   uint64 `gorm:"not null;uniqueIndex:idx_xd_file_tags_owner_name,priority:1;index"`
	Name      string `gorm:"size:64;not null;uniqueIndex:idx_xd_file_tags_owner_name,priority:2"`
	Color     string `gorm:"size:16;not null;default:''"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileTag) TableName() string { return "xd_file_tags" }

type FileNodeTag struct {
	OwnerID   uint64    `gorm:"primaryKey;autoIncrement:false;index:idx_xd_file_node_tags_owner_tag,priority:1"`
	NodeID    uint64    `gorm:"primaryKey;autoIncrement:false;index"`
	TagID     uint64    `gorm:"primaryKey;autoIncrement:false;index:idx_xd_file_node_tags_owner_tag,priority:2"`
	CreatedAt time.Time `gorm:"not null"`

	Owner User    `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node  Node    `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Tag   FileTag `gorm:"foreignKey:TagID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileNodeTag) TableName() string { return "xd_file_node_tags" }

type FileSavedSearch struct {
	ID          uint64 `gorm:"primaryKey"`
	OwnerID     uint64 `gorm:"not null;uniqueIndex:idx_xd_file_saved_searches_owner_name,priority:1;index:idx_xd_file_saved_searches_owner_position,priority:1"`
	Name        string `gorm:"size:128;not null;uniqueIndex:idx_xd_file_saved_searches_owner_name,priority:2"`
	Query       string `gorm:"size:256;not null;default:''"`
	FiltersJSON string `gorm:"type:text;not null;default:'{}'"`
	Position    int    `gorm:"not null;default:0;index:idx_xd_file_saved_searches_owner_position,priority:2"`
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileSavedSearch) TableName() string { return "xd_file_saved_searches" }
