package meta

import "time"

// AdminPhotoAutoRevision records immutable instance-wide automatic task
// admission settings, never per-user sources or model/container credentials.
type AdminPhotoAutoRevision struct {
	Name        string    `gorm:"size:64;primaryKey"`
	Revision    uint64    `gorm:"primaryKey;autoIncrement:false"`
	AutoEnabled bool      `gorm:"not null"`
	KindsJSON   string    `gorm:"column:kinds_json;type:text;not null;default:''"`
	Origin      string    `gorm:"size:16;not null"`
	CreatedAt   time.Time `gorm:"not null"`
}

func (AdminPhotoAutoRevision) TableName() string { return "xd_admin_photo_auto_revisions" }
