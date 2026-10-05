package meta

import "time"

type FileQuickAccess struct {
	OwnerID   uint64    `gorm:"primaryKey;autoIncrement:false;index:idx_xd_file_quick_access_owner_created,priority:1"`
	NodeID    uint64    `gorm:"primaryKey;autoIncrement:false"`
	CreatedAt time.Time `gorm:"not null;index:idx_xd_file_quick_access_owner_created,priority:2"`
	UpdatedAt time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node  Node `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileQuickAccess) TableName() string { return "xd_file_quick_access" }
