package meta

import "time"

// AdminGeoNamesDatasetSnapshot is a content-addressed copy of three trusted,
// deployment-mounted GeoNames files. It is not an active resolver, an upload,
// a fleet-wide installation, or a user-owned Sync Folder record.
type AdminGeoNamesDatasetSnapshot struct {
	Fingerprint     string    `gorm:"size:64;primaryKey"`
	ResolverVersion string    `gorm:"size:128;not null"`
	SourceVersion   string    `gorm:"size:128;not null"`
	CheckedRadiusKM float64   `gorm:"not null"`
	CheckedRevision uint64    `gorm:"not null"`
	TotalBytes      int64     `gorm:"not null"`
	CreatedAt       time.Time `gorm:"not null"`
}

func (AdminGeoNamesDatasetSnapshot) TableName() string {
	return "xd_admin_geonames_dataset_snapshots"
}
