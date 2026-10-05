package meta

import "time"

type FileRecentAccess struct {
	OwnerID      uint64    `gorm:"primaryKey;autoIncrement:false;index:idx_xd_file_recent_owner_accessed,priority:1"`
	NodeID       uint64    `gorm:"primaryKey;autoIncrement:false"`
	LastAccessed time.Time `gorm:"column:last_accessed_at;not null;index:idx_xd_file_recent_owner_accessed,priority:2,sort:desc"`
	CreatedAt    time.Time
	UpdatedAt    time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node  Node `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileRecentAccess) TableName() string { return "xd_file_recent_access" }
