package meta

import "time"

// AdminGeoNamesSetting stores the versioned desired radius and verified data
// content address; filesystem directories remain deployment-owned.
type AdminGeoNamesSetting struct {
	Name          string  `gorm:"primaryKey;size:64"`
	MaxDistanceKM float64 `gorm:"not null"`
	Fingerprint   string  `gorm:"size:64;not null;default:''"`
	Revision      uint64  `gorm:"not null;default:1"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (AdminGeoNamesSetting) TableName() string { return "xd_admin_geonames_settings" }
