package meta

import "time"

// ClientDevice records one authenticated client installation. Its credential
// is returned only once on enrollment; only a SHA-256 digest is persisted.
type ClientDevice struct {
	ID             string    `gorm:"size:36;primaryKey"`
	OwnerID        uint64    `gorm:"not null;index"`
	Name           string    `gorm:"size:128;not null"`
	Platform       string    `gorm:"size:16;not null"`
	ClientVersion  string    `gorm:"size:64"`
	CredentialHash string    `gorm:"size:64;not null"`
	CreatedAt      time.Time `gorm:"not null"`
	UpdatedAt      time.Time `gorm:"not null"`
	LastSeenAt     *time.Time
	RevokedAt      *time.Time `gorm:"index"`
}

func (ClientDevice) TableName() string { return "xd_client_devices" }

// LocalSourceBinding is only a remote identity record. It never authorizes
// arbitrary access to a local OS path; the agent will keep that grant locally.
type LocalSourceBinding struct {
	SourceID        uint64    `gorm:"primaryKey"`
	OwnerID         uint64    `gorm:"not null;index"`
	DeviceID        string    `gorm:"size:36;not null;index"`
	RootID          string    `gorm:"size:36;not null"`
	RootFingerprint string    `gorm:"size:64;not null"`
	CreatedAt       time.Time `gorm:"not null"`
	UpdatedAt       time.Time `gorm:"not null"`

	Source Source       `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Device ClientDevice `gorm:"foreignKey:DeviceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (LocalSourceBinding) TableName() string { return "xd_local_source_bindings" }
