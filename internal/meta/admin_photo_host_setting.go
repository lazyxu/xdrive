package meta

import "time"

// AdminPhotoHostSetting records ONLY the desired opt-in for the fixed,
// shared photo-intelligence deployment profile. It does not control Docker,
// per-model scheduling, credentials, or per-user Source records.
type AdminPhotoHostSetting struct {
	Name      string `gorm:"size:48;primaryKey"`
	Revision  uint64 `gorm:"not null"`
	Enabled   bool   `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (AdminPhotoHostSetting) TableName() string { return "xd_admin_photo_host_settings" }

// Every revision, including the unmanaged revision zero, is immutable.
// Rollback creates a NEW desired revision and never changes the live host.
type AdminPhotoHostRevision struct {
	Name      string    `gorm:"size:48;primaryKey"`
	Revision  uint64    `gorm:"primaryKey;autoIncrement:false"`
	Enabled   bool      `gorm:"not null"`
	Origin    string    `gorm:"size:16;not null"`
	CreatedAt time.Time `gorm:"not null"`
}

func (AdminPhotoHostRevision) TableName() string { return "xd_admin_photo_host_revisions" }
