package meta

import "time"

// ViewerQualityPreference stores one Owner's default Viewer quality setting.
// The user ID is always taken from authenticated Server context, never input.
type ViewerQualityPreference struct {
	UserID    uint64 `gorm:"primaryKey;autoIncrement:false"`
	Revision  uint64 `gorm:"not null"`
	Preset    string `gorm:"size:16;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ViewerQualityPreference) TableName() string {
	return "xd_viewer_quality_preferences"
}
