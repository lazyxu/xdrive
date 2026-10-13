package meta

import "time"

// LocalPushStaging is a short-lived, noncanonical original-byte handoff from
// one credential-verified owning Agent to Server staging. One row per Source
// bounds simultaneous native staging. No Node, File, SourceItem, SyncRun or
// content-addressed reference is created by this record.
type LocalPushStaging struct {
	SourceID              uint64    `gorm:"primaryKey;autoIncrement:false"`
	StageID               string    `gorm:"size:36;not null;uniqueIndex"`
	OwnerID               uint64    `gorm:"not null;index"`
	SourceRevision        uint64    `gorm:"not null"`
	DeviceID              string    `gorm:"size:36;not null"`
	RootID                string    `gorm:"size:36;not null"`
	RootFingerprint       string    `gorm:"size:64;not null"`
	TargetNodeID          uint64    `gorm:"not null"`
	CurrentSnapshotSHA256 string    `gorm:"size:64;not null"`
	CurrentPathKey        string    `gorm:"size:64;not null"`
	ContentSHA256         string    `gorm:"size:64;not null"`
	TotalSize             int64     `gorm:"not null"`
	Status                string    `gorm:"size:20;not null;index"`
	ExpiresAt             time.Time `gorm:"not null;index"`
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

func (LocalPushStaging) TableName() string { return "xd_local_push_staging" }
