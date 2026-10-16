package meta

import "time"

// LocalPushQuotaHold books one bounded, PRIVATE owner quota slot for a
// credential-verified native Stage generation. It is NOT a ContentBlob ref,
// a physical disk reservation, an upload receipt or a SourceRun. Expired or
// released rows never count towards owner quota; historical records are kept
// for future fenced reconciliation rather than silently reactivated.
type LocalPushQuotaHold struct {
	StageID         string     `gorm:"size:36;primaryKey"`
	OwnerID         uint64     `gorm:"not null;index:idx_xd_local_push_quota_hold_owner_expiry,priority:1"`
	SourceID        uint64     `gorm:"not null;index"`
	SourceRevision  uint64     `gorm:"not null"`
	DeviceID        string     `gorm:"size:36;not null"`
	RootID          string     `gorm:"size:36;not null"`
	RootFingerprint string     `gorm:"size:64;not null"`
	TargetNodeID    uint64     `gorm:"not null"`
	ContentSHA256   string     `gorm:"size:64;not null;index"`
	Bytes           int64      `gorm:"not null"`
	ExpiresAt       time.Time  `gorm:"not null;index:idx_xd_local_push_quota_hold_owner_expiry,priority:2"`
	ReleasedAt      *time.Time `gorm:"index"`
	CommittedNodeID *uint64    `gorm:"index"`
	CommittedAt     *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (LocalPushQuotaHold) TableName() string { return "xd_local_push_quota_holds" }
