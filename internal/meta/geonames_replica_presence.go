package meta

import "time"

// GeoNamesReplicaPresence is a short-lived, instance-local observation of
// an immutable resolver snapshot. InstanceID stays in PostgreSQL and is
// NEVER exposed through the administrator service API.
type GeoNamesReplicaPresence struct {
	InstanceID      string    `gorm:"size:64;primaryKey"`
	Configured      bool      `gorm:"not null"`
	ResolverVersion string    `gorm:"size:128;not null"`
	MaxDistanceKM   float64   `gorm:"not null"`
	AppliedRevision uint64    `gorm:"not null;default:0"`
	HeartbeatAt     time.Time `gorm:"not null"`
	ExpiresAt       time.Time `gorm:"not null;index"`
}

func (GeoNamesReplicaPresence) TableName() string {
	return "xd_geonames_replica_presence"
}
