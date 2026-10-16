package meta

import "time"

// BaiduGeoconvQuotaBucket is a Server-only cross-replica rate limit.
// Scope 0 is fleet-wide, positive ScopeIDs are trusted Owner IDs.
// It stores no GPS, credentials, paths, provider URLs or photos.
type BaiduGeoconvQuotaBucket struct {
	ScopeID      int64 `gorm:"primaryKey;autoIncrement:false;not null"`
	WindowMinute int64 `gorm:"not null"`
	Requests     int64 `gorm:"not null"`
	Points       int64 `gorm:"not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (BaiduGeoconvQuotaBucket) TableName() string {
	return "xd_baidu_geoconv_quota_buckets"
}
