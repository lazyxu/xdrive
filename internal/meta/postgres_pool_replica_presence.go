package meta

import "time"

// PostgresPoolReplicaPresence is a short-lived observation of the effective
// database/sql pool on one Server. InstanceID is strictly database-internal.
type PostgresPoolReplicaPresence struct {
	InstanceID         string    `gorm:"size:64;primaryKey"`
	Configured         bool      `gorm:"not null"`
	AppliedRevision    uint64    `gorm:"not null;default:0"`
	MaxOpenConnections int       `gorm:"not null"`
	MaxIdleConnections int       `gorm:"not null"`
	HeartbeatAt        time.Time `gorm:"not null"`
	ExpiresAt          time.Time `gorm:"not null;index"`
}

func (PostgresPoolReplicaPresence) TableName() string {
	return "xd_postgres_pool_replica_presence"
}
