package meta

import "time"

// BaiduJSAPIQuotaBucket is a cross-replica quota row; 0 is the fleet, positive
// ScopeID is a trusted Server-resolved owner. It stores no secrets or GPS.
type BaiduJSAPIQuotaBucket struct {
	ScopeID       int64 `gorm:"primaryKey;autoIncrement:false;not null"`
	WindowMinute  int64 `gorm:"not null"`
	Requests      int64 `gorm:"not null"`
	ReservedBytes int64 `gorm:"not null"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (BaiduJSAPIQuotaBucket) TableName() string { return "xd_baidu_jsapi_quota_buckets" }
