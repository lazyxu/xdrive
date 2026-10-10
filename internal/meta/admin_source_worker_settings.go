package meta

import "time"

// Global desired Pull Worker scheduling policy; not per-user Sync Folder state.
type AdminSourceWorkerSetting struct {
	Name                string `gorm:"size:48;primaryKey"`
	ScanIntervalSeconds int64  `gorm:"not null"`
	PollIntervalSeconds int64  `gorm:"not null"`
	MaxConcurrency      int    `gorm:"not null"`
	Revision            uint64 `gorm:"not null"`
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (AdminSourceWorkerSetting) TableName() string { return "xd_admin_source_worker_settings" }

// Append-only, audited history of instance-wide scheduling policy.
type AdminSourceWorkerRevision struct {
	Name                string    `gorm:"size:48;primaryKey"`
	Revision            uint64    `gorm:"primaryKey;autoIncrement:false"`
	ScanIntervalSeconds int64     `gorm:"not null"`
	PollIntervalSeconds int64     `gorm:"not null"`
	MaxConcurrency      int       `gorm:"not null"`
	Origin              string    `gorm:"size:16;not null"`
	CreatedAt           time.Time `gorm:"not null"`
}

func (AdminSourceWorkerRevision) TableName() string { return "xd_admin_source_worker_revisions" }
