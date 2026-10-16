package meta

import "time"

const (
	LocalPushFirstDirectoryChallengeIssued   = "issued"
	LocalPushFirstDirectoryChallengeConsumed = "consumed"
)

// LocalPushFirstDirectoryChallenge is ONE private, bounded, DB-clock-scoped
// advisory MAC challenge per Source. It NEVER authorizes a backup, a native
// handle, a canonical CAS write, or deletion inference. Store ONLY a SHA-256
// digest of the unpredictable 32-byte nonce, not the nonce, device secret,
// native path/identity, HMAC tag or original file data. A new issue replaces
// an expired or consumed challenge and invalidates the old one.
type LocalPushFirstDirectoryChallenge struct {
	SourceID        uint64     `gorm:"primaryKey;autoIncrement:false" json:"-"`
	OwnerID         uint64     `gorm:"not null;index" json:"-"`
	OwnerSession    uint64     `gorm:"not null" json:"-"`
	SourceRevision  uint64     `gorm:"not null" json:"-"`
	TargetNodeID    uint64     `gorm:"not null" json:"-"`
	DeviceID        string     `gorm:"size:36;not null" json:"-"`
	RootID          string     `gorm:"size:36;not null" json:"-"`
	RootFingerprint string     `gorm:"size:64;not null" json:"-"`
	NonceSHA256     string     `gorm:"size:64;not null" json:"-"`
	State           string     `gorm:"size:16;not null" json:"-"`
	IssuedAt        time.Time  `gorm:"not null" json:"-"`
	ExpiresAt       time.Time  `gorm:"not null;index" json:"-"`
	ConsumedAt      *time.Time `json:"-"`
	CreatedAt       time.Time  `json:"-"`
	UpdatedAt       time.Time  `json:"-"`

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (LocalPushFirstDirectoryChallenge) TableName() string {
	return "xd_local_push_first_directory_challenges"
}
