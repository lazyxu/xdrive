package meta

import "time"

// BaiduGeoconvFlight is an ephemeral, Server-only capacity reservation.
// It contains no source GPS, derived coordinates, AK, URL, asset or job ID.
// Its random opaque digest cannot authorize a conversion.
type BaiduGeoconvFlight struct {
	Digest    string    `gorm:"primaryKey;size:64;not null"`
	OwnerID   int64     `gorm:"index;not null"`
	ExpiresAt time.Time `gorm:"index;not null"`
	CreatedAt time.Time `gorm:"not null"`
}

func (BaiduGeoconvFlight) TableName() string {
	return "xd_baidu_geoconv_flights"
}
