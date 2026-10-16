package meta

import "time"

// BaiduPhotoMapConsent is an explicit, expiring per-PhotoAsset opt-in for
// derived position indexing AND sending original GPS to Baidu Geoconv.
// Absence of a row, revision zero, expiry or revocation always denies.
// No user-facing consent issuance API or production indexer exists yet.
// Source identity is required on every write/read: an old opt-in for an
// earlier GPS pair or media revision never authorizes exporting a new pair.
// This row is private Server state; it must never be serialized to clients.
type BaiduPhotoMapConsent struct {
	AssetID              uint64     `gorm:"primaryKey;autoIncrement:false"`
	OwnerID              uint64     `gorm:"not null;index"`
	Revision             uint64     `gorm:"not null;default:0"`
	AllowIndex           bool       `gorm:"not null;default:false"`
	AllowBaiduConversion bool       `gorm:"not null;default:false"`
	ExpiresAt            time.Time  `gorm:"not null"`
	RevokedAt            *time.Time `gorm:"index"`
	// Bound to exactly the WGS84 location and primary source generation that
	// the Owner explicitly approved. A missing/zero legacy binding NEVER grants
	// permission to convert a later/edited photo location.
	SourceNodeID         uint64 `gorm:"not null;default:0"`
	SourceNodeRevision   uint64 `gorm:"not null;default:0"`
	SourceMediaUpdatedAt *time.Time
	SourceLatitude       *float64
	SourceLongitude      *float64
	CreatedAt            time.Time
	UpdatedAt            time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Owner User       `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BaiduPhotoMapConsent) TableName() string { return "xd_baidu_photo_map_consents" }
