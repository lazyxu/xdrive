package meta

import "time"

// IOSPhotoBackgroundGrant is a separately revocable Owner/Device/Root-bound
// opt-in. Never reuse the identity-only device credential or a Web cookie as
// an upload grant. Only the SHA-256 of a random grant secret is retained.
type IOSPhotoBackgroundGrant struct {
	ID             string     `gorm:"size:36;primaryKey"`
	OwnerID        uint64     `gorm:"not null;index"`
	DeviceID       string     `gorm:"size:36;not null;index"`
	RootNodeID     uint64     `gorm:"not null"`
	ServerInstance string     `gorm:"size:256;not null"`
	CredentialHash string     `gorm:"size:64;not null;uniqueIndex"`
	SessionVersion uint64     `gorm:"not null"`
	CreatedAt      time.Time  `gorm:"not null"`
	UpdatedAt      time.Time  `gorm:"not null"`
	ExpiresAt      time.Time  `gorm:"not null;index"`
	RevokedAt      *time.Time `gorm:"index"`
}

func (IOSPhotoBackgroundGrant) TableName() string {
	return "xd_ios_photo_background_grants"
}
