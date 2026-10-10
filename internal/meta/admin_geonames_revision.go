package meta

import "time"

// AdminGeoNamesRevision is immutable, instance-wide matching-distance history.
// Dataset paths and user-level source data are never stored in this table.
type AdminGeoNamesRevision struct {
	Name          string    `gorm:"size:64;primaryKey"`
	Revision      uint64    `gorm:"primaryKey;autoIncrement:false"`
	MaxDistanceKM float64   `gorm:"not null"`
	Origin        string    `gorm:"size:16;not null"`
	CreatedAt     time.Time `gorm:"not null"`
}

func (AdminGeoNamesRevision) TableName() string { return "xd_admin_geonames_revisions" }
