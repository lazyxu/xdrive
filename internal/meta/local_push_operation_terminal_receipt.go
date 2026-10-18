package meta

import "time"

const (
	LocalPushTerminalReservationAborted = "aborted"
	LocalPushTerminalReservationExpired = "expired"
)

// LocalPushOperationTerminalReceipt is append-only evidence about the end of
// one Server reservation, NOT physical file, CAS, SourceRun or transfer status.
// The owning operation's durable row supplies the original authorization
// scope. Never serialize this private correlation through Agent IPC or Web.
type LocalPushOperationTerminalReceipt struct {
	OperationID      string    `gorm:"size:36;primaryKey" json:"-"`
	SourceID         uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_terminal_generation,priority:1" json:"-"`
	Generation       uint64    `gorm:"not null;uniqueIndex:idx_xd_local_push_terminal_generation,priority:2" json:"-"`
	RequestKeyDigest string    `gorm:"size:64;not null" json:"-"`
	State            string    `gorm:"size:16;not null" json:"-"`
	RecordedAt       time.Time `gorm:"not null" json:"-"`
	CreatedAt        time.Time `json:"-"`
}

func (LocalPushOperationTerminalReceipt) TableName() string {
	return "xd_local_push_operation_terminal_receipts"
}
