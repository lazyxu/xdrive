package meta

import "time"

const LocalPushCASPrepareIntentQuarantined = "quarantined"

// LocalPushCASPrepareIntent is a private, non-authoritative SQL replay marker
// for ONE native Agent staging generation. It does not certify bytes, retain
// a ContentBlob, reserve quota or permit Source/Node/Run mutations. Every
// future consumer MUST revalidate the owning device, Root and live Stage.
type LocalPushCASPrepareIntent struct {
	StageID               string    `gorm:"size:36;primaryKey"`
	SourceID              uint64    `gorm:"not null;index"`
	OwnerID               uint64    `gorm:"not null;index"`
	SourceRevision        uint64    `gorm:"not null"`
	DeviceID              string    `gorm:"size:36;not null"`
	RootID                string    `gorm:"size:36;not null"`
	RootFingerprint       string    `gorm:"size:64;not null"`
	TargetNodeID          uint64    `gorm:"not null"`
	CurrentSnapshotSHA256 string    `gorm:"size:64;not null"`
	CurrentPathKey        string    `gorm:"size:64;not null"`
	ContentSHA256         string    `gorm:"size:64;not null;index"`
	TotalSize             int64     `gorm:"not null"`
	StageExpiresAt        time.Time `gorm:"not null;index"`
	State                 string    `gorm:"size:24;not null"`
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

func (LocalPushCASPrepareIntent) TableName() string { return "xd_local_push_cas_prepare_intents" }
