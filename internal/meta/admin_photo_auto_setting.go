package meta

import "time"

// AdminPhotoAutoSetting controls instance-wide automatic Photo Intelligence
// scheduling. It does not install/start analyzers or change user sources.
type AdminPhotoAutoSetting struct {
	Name        string `gorm:"primaryKey;size:64"`
	AutoEnabled bool   `gorm:"not null"`
	// Empty means all four automatic analysis groups enabled (legacy default).
	KindsJSON string `gorm:"column:kinds_json;type:text;not null;default:''"`
	Revision  uint64 `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (AdminPhotoAutoSetting) TableName() string { return "xd_admin_photo_auto_settings" }
