package meta

import "time"

const (
	LocalSourceCommitIntentStateQuarantined = "quarantined"
	// Applied is an INTERNAL database-only prototype state. No runtime
	// endpoint or Agent executor may consume it as an upload success token.
	LocalSourceCommitIntentStateApplied = "applied"
)

// LocalSourceCommitIntent records a revision- and device-fenced PRIVATE
// reconciliation proposal. It is deliberately NOT an identity commit:
// no SourceItem, SourceItemAlias, Node, File, CAS, SyncRun or Mirror logic
// may consume this table as authority until a separate durable writer
// independently verifies native bytes and remote CAS within its own fence.
type LocalSourceCommitIntent struct {
	ID                     uint64 `gorm:"primaryKey"`
	SourceID               uint64 `gorm:"not null;index;uniqueIndex:idx_xd_local_ci_ev,priority:1;uniqueIndex:idx_xd_local_ci_gen_item,priority:1;uniqueIndex:idx_xd_local_ci_gen_path,priority:1"`
	SourceRevision         uint64 `gorm:"not null;uniqueIndex:idx_xd_local_ci_gen_item,priority:2;uniqueIndex:idx_xd_local_ci_gen_path,priority:2"`
	EvidenceID             uint64 `gorm:"not null;uniqueIndex:idx_xd_local_ci_ev,priority:2"`
	CurrentSnapshotSHA256  string `gorm:"size:64;not null;uniqueIndex:idx_xd_local_ci_gen_item,priority:3;uniqueIndex:idx_xd_local_ci_gen_path,priority:3"`
	SourceItemID           uint64 `gorm:"not null;uniqueIndex:idx_xd_local_ci_gen_item,priority:4"`
	CurrentPathKey         string `gorm:"size:64;not null;uniqueIndex:idx_xd_local_ci_gen_path,priority:4"`
	PreviousSnapshotSHA256 string `gorm:"size:64;not null"`
	PreviousPathKey        string `gorm:"size:64;not null"`
	NativeIdentityKey      string `gorm:"size:64;not null"`
	DeviceID               string `gorm:"size:36;not null"`
	RootID                 string `gorm:"size:36;not null"`
	RootFingerprint        string `gorm:"size:64;not null"`
	State                  string `gorm:"size:16;not null;default:quarantined"`
	CreatedAt              time.Time
	UpdatedAt              time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (LocalSourceCommitIntent) TableName() string { return "xd_local_source_commit_intents" }
