package meta

import "time"

// BaiduJSAPILoaderFlight is a short-lived, Server-only upstream concurrency
// lease. Its opaque digest never identifies a browser session or includes GPS.
type BaiduJSAPILoaderFlight struct {
	Digest    string    `gorm:"primaryKey;size:64;not null"`
	OwnerID   int64     `gorm:"index;not null"`
	ExpiresAt time.Time `gorm:"index;not null"`
	CreatedAt time.Time `gorm:"not null"`
}

func (BaiduJSAPILoaderFlight) TableName() string { return "xd_baidu_jsapi_loader_flights" }
