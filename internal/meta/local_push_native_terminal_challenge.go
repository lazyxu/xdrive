package meta

import "time"

const (
	LocalPushNativeTerminalChallengeIssued   = "issued"
	LocalPushNativeTerminalChallengeConsumed = "consumed"
)

// LocalPushNativeTerminalChallenge records ONE private, short-lived,
// original-Operation challenge. It does not prove an OS lock, authorize
// physical-COMMIT/CANCEL, retire a Stage/key/Writer or start a SourceRun.
// Only the digest of the unpredictable nonce is persisted. Never store raw
// Agent file identities, paths, credentials or the challenge nonce.
type LocalPushNativeTerminalChallenge struct {
	OperationID      string     `gorm:"size:36;primaryKey" json:"-"`
	StageID          string     `gorm:"size:36;not null;uniqueIndex:idx_xd_local_push_native_terminal_challenge_stage" json:"-"`
	SourceID         uint64     `gorm:"not null;index" json:"-"`
	Generation       uint64     `gorm:"not null" json:"-"`
	OwnerID          uint64     `gorm:"not null" json:"-"`
	OwnerSession     uint64     `gorm:"not null" json:"-"`
	DeviceID         string     `gorm:"size:36;not null" json:"-"`
	RootID           string     `gorm:"size:36;not null" json:"-"`
	RootFingerprint  string     `gorm:"size:64;not null" json:"-"`
	SourceRevision   uint64     `gorm:"not null" json:"-"`
	TargetNodeID     uint64     `gorm:"not null" json:"-"`
	RequestKeyDigest string     `gorm:"size:64;not null" json:"-"`
	NonceSHA256      string     `gorm:"size:64;not null" json:"-"`
	State            string     `gorm:"size:16;not null" json:"-"`
	IssuedAt         time.Time  `gorm:"not null" json:"-"`
	ExpiresAt        time.Time  `gorm:"not null" json:"-"`
	ConsumedAt       *time.Time `json:"-"`
	CreatedAt        time.Time  `json:"-"`
	UpdatedAt        time.Time  `json:"-"`
}

func (LocalPushNativeTerminalChallenge) TableName() string {
	return "xd_local_push_native_terminal_challenges"
}
