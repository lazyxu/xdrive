package meta

import "time"

const (
	LocalPushFileTerminalPhysicalCommit         = "physical-commit"
	LocalPushFileTerminalPhysicalCancelQuiesced = "physical-cancel-quiesced"
)

// LocalPushFileTerminal is an immutable SERVER-PRIVATE per-file decision slot.
// An inserted row requires independently replayable native and physical
// Server proof supplied by later G2c2d2b phases. This schema does not create
// that proof or authorize key/Stage retirement, SourceRun or automatic backup.
// The SQL uniqueness contract prevents competing decisions for one original
// operation/Stage/generation. All fields are deliberately excluded from JSON.
type LocalPushFileTerminal struct {
	OperationID           string    `gorm:"size:36;primaryKey" json:"-"`
	StageID               string    `gorm:"size:36;not null;uniqueIndex:idx_xd_local_push_file_terminal_stage" json:"-"`
	SourceID              uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_file_terminal_generation,priority:1" json:"-"`
	Generation            uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_file_terminal_generation,priority:2" json:"-"`
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
	NativeWitnessSHA256   string    `gorm:"size:64;not null" json:"-"`
	State                 string    `gorm:"size:32;not null" json:"-"`
	NodeID                uint64    `gorm:"not null;default:0" json:"-"`
	SourceItemID          uint64    `gorm:"not null;default:0" json:"-"`
	RecordedAt            time.Time `gorm:"not null" json:"-"`
	CreatedAt             time.Time `json:"-"`
}

func (LocalPushFileTerminal) TableName() string {
	return "xd_local_push_file_terminals"
}
