package meta

import "time"

// LocalPushFirstLeafOperationCommit is an immutable SERVER-PRIVATE SQL
// post-commit correlation for ONE first-leaf CAS/Node/SourceItem transaction.
// A row is visible only if that SQL transaction committed. It is NOT native
// OS-file attestation, a current physical-CAS guarantee, a completed backup,
// SourceRun, cancellation proof, or authority to retire local request keys.
type LocalPushFirstLeafOperationCommit struct {
	OperationID           string    `gorm:"size:36;primaryKey" json:"-"`
	StageID               string    `gorm:"size:36;not null;uniqueIndex:idx_xd_local_push_first_leaf_commit_stage" json:"-"`
	SourceID              uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_first_leaf_commit_generation,priority:1" json:"-"`
	Generation            uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_first_leaf_commit_generation,priority:2" json:"-"`
	OwnerID               uint64    `gorm:"not null" json:"-"`
	OwnerSession          uint64    `gorm:"not null" json:"-"`
	DeviceID              string    `gorm:"size:36;not null" json:"-"`
	RootID                string    `gorm:"size:36;not null" json:"-"`
	RootFingerprint       string    `gorm:"size:64;not null" json:"-"`
	SourceRevision        uint64    `gorm:"not null" json:"-"`
	TargetNodeID          uint64    `gorm:"not null" json:"-"`
	RequestKeyDigest      string    `gorm:"size:64;not null" json:"-"`
	CurrentSnapshotSHA256 string    `gorm:"size:64;not null" json:"-"`
	CurrentPathKey        string    `gorm:"size:64;not null" json:"-"`
	ContentSHA256         string    `gorm:"size:64;not null" json:"-"`
	TotalSize             int64     `gorm:"not null" json:"-"`
	NodeID                uint64    `gorm:"not null" json:"-"`
	SourceItemID          uint64    `gorm:"not null" json:"-"`
	CommittedAt           time.Time `gorm:"not null" json:"-"`
	CreatedAt             time.Time `json:"-"`
}

func (LocalPushFirstLeafOperationCommit) TableName() string {
	return "xd_local_push_first_leaf_operation_commits"
}
