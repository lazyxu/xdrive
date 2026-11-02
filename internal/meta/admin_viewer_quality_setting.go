package meta

import "time"

// AdminViewerQualitySetting is the global maximum generated Viewer quality.
// It does not restrict canonical downloads or stored originals.
type AdminViewerQualitySetting struct {
	Name          string `gorm:"size:48;primaryKey"`
	Revision      uint64 `gorm:"not null"`
	MaximumPreset string `gorm:"size:16;not null"`
	CacheBudgetBytes int64 `gorm:"not null;default:10737418240"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (AdminViewerQualitySetting) TableName() string {
	return "xd_admin_viewer_quality_settings"
}
