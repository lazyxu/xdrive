package meta

import "time"

// LocalPushOperationStageBinding is a PRIVATE, immutable SQL correlation of
// ONE first-file Stage and ONE exact latest reservation. It never attests
// native file contents, authorizes CAS/File/SourceItem writes, or reports a
// completed backup. Every field is intentionally excluded from JSON.
type LocalPushOperationStageBinding struct {
	StageID               string    `gorm:"size:36;primaryKey" json:"-"`
	OperationID           string    `gorm:"size:36;not null;uniqueIndex:idx_xd_local_push_stage_operation" json:"-"`
	SourceID              uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_stage_generation,priority:1" json:"-"`
	Generation            uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_stage_generation,priority:2" json:"-"`
	OwnerID               uint64    `gorm:"not null" json:"-"`
	OwnerSession          uint64    `gorm:"not null" json:"-"`
	SourceRevision        uint64    `gorm:"not null" json:"-"`
	DeviceID              string    `gorm:"size:36;not null" json:"-"`
	RootID                string    `gorm:"size:36;not null" json:"-"`
	RootFingerprint       string    `gorm:"size:64;not null" json:"-"`
	TargetNodeID          uint64    `gorm:"not null" json:"-"`
	RequestKeyDigest      string    `gorm:"size:64;not null" json:"-"`
	CurrentSnapshotSHA256 string    `gorm:"size:64;not null" json:"-"`
	CurrentPathKey        string    `gorm:"size:64;not null" json:"-"`
	ContentSHA256         string    `gorm:"size:64;not null" json:"-"`
	TotalSize             int64     `gorm:"not null" json:"-"`
	StageExpiresAt        time.Time `gorm:"not null" json:"-"`
	BoundAt               time.Time `gorm:"not null" json:"-"`
	CreatedAt             time.Time `json:"-"`
}

func (LocalPushOperationStageBinding) TableName() string {
	return "xd_local_push_operation_stage_bindings"
}
