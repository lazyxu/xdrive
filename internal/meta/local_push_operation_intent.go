package meta

import "time"

const (
	LocalPushOperationIntentReserved = "reserved"
	LocalPushOperationIntentAborted  = "aborted"
)

// LocalPushOperationIntent is a Server-private, append-only admission record.
// A lease is NOT an upload ticket, proof of native bytes, backup completion,
// or permission to call the existing CAS/SQL writers. Every field is private.
// The monotonically increasing per-Source Generation fences obsolete attempts;
// only the latest generation can ever be considered by a later protocol.
type LocalPushOperationIntent struct {
	ID               string     `gorm:"size:36;primaryKey" json:"-"`
	SourceID         uint64     `gorm:"not null;uniqueIndex:idx_xd_local_push_op_generation,priority:1;uniqueIndex:idx_xd_local_push_op_request,priority:1" json:"-"`
	Generation       uint64     `gorm:"not null;uniqueIndex:idx_xd_local_push_op_generation,priority:2" json:"-"`
	OwnerID          uint64     `gorm:"not null;index" json:"-"`
	OwnerSession     uint64     `gorm:"not null" json:"-"`
	SourceRevision   uint64     `gorm:"not null" json:"-"`
	TargetNodeID     uint64     `gorm:"not null" json:"-"`
	DeviceID         string     `gorm:"size:36;not null" json:"-"`
	RootID           string     `gorm:"size:36;not null" json:"-"`
	RootFingerprint  string     `gorm:"size:64;not null" json:"-"`
	RequestKeyDigest *string    `gorm:"size:64;uniqueIndex:idx_xd_local_push_op_request,priority:2" json:"-"`
	State            string     `gorm:"size:16;not null" json:"-"`
	IssuedAt         time.Time  `gorm:"not null" json:"-"`
	ExpiresAt        time.Time  `gorm:"not null;index" json:"-"`
	AbortedAt        *time.Time `json:"-"`
	CreatedAt        time.Time  `json:"-"`
	UpdatedAt        time.Time  `json:"-"`
}

func (LocalPushOperationIntent) TableName() string { return "xd_local_push_operation_intents" }
