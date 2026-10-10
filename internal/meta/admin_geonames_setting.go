package meta

import "time"

// AdminGeoNamesSetting stores a versioned global GeoNames matching radius.
// Dataset roots remain operator-controlled read-only deployment mounts.
type AdminGeoNamesSetting struct {
	Name          string  `gorm:"primaryKey;size:64"`
	MaxDistanceKM float64 `gorm:"not null"`
	Revision      uint64  `gorm:"not null;default:1"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (AdminGeoNamesSetting) TableName() string { return "xd_admin_geonames_settings" }
