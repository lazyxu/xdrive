package meta

import "time"

// AdminMediaWorkerSetting is global desired activation, never per-user
// Source state. Actual Host Manager/container state is observed separately.
type AdminMediaWorkerSetting struct {
	Name      string `gorm:"size:48;primaryKey"`
	Revision  uint64 `gorm:"not null"`
	Enabled   bool   `gorm:"not null"`
	MemoryMiB int    `gorm:"column:memory_mib;not null;default:768"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (AdminMediaWorkerSetting) TableName() string { return "xd_admin_media_worker_settings" }

type AdminMediaWorkerRevision struct {
	Name      string    `gorm:"size:48;primaryKey"`
	Revision  uint64    `gorm:"primaryKey;autoIncrement:false"`
	Enabled   bool      `gorm:"not null"`
	MemoryMiB int       `gorm:"column:memory_mib;not null;default:768"`
	Origin    string    `gorm:"size:16;not null"`
	CreatedAt time.Time `gorm:"not null"`
}

func (AdminMediaWorkerRevision) TableName() string { return "xd_admin_media_worker_revisions" }
