package meta

import "time"

// PhotoHostReplicaPresence is a best-effort process-session observation of a
// Server that might admit Photo Intelligence work. Unlike task-only runtime
// presence, even an idle Server publishes a row. It is NOT an exhaustive
// deployment roster, an admission fence or a safe-stop acknowledgment.
// Instance identifiers remain inside PostgreSQL, never in admin REST/IPC.
type PhotoHostReplicaPresence struct {
	InstanceID  string    `gorm:"size:64;primaryKey"`
	StartedAt   time.Time `gorm:"not null"`
	HeartbeatAt time.Time `gorm:"not null;index"`
	ExpiresAt   time.Time `gorm:"not null;index"`
}

func (PhotoHostReplicaPresence) TableName() string {
	return "xd_photo_host_replica_presence"
}
