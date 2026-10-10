package meta

import "time"

// SourceWorkerPresence is the observable lease of an independent, long-running
// Pull Worker process, not the Server's per-task background scheduler. It is
// intentionally free of host identifiers, user data and credentials.
type SourceWorkerPresence struct {
	InstanceID          string    `gorm:"size:64;primaryKey"`
	ScanIntervalSeconds int64     `gorm:"not null"`
	PollIntervalSeconds int64     `gorm:"not null"`
	MaxConcurrency      int       `gorm:"not null"`
	HeartbeatAt         time.Time `gorm:"not null"`
	ExpiresAt           time.Time `gorm:"not null;index"`
}

func (SourceWorkerPresence) TableName() string {
	return "xd_source_worker_presence"
}
