package meta

import "time"

// AdminPostgresPoolSetting controls ONLY this application's database/sql pool.
// PostgreSQL address, credentials, schema, container and storage remain
// deployment-owned. A saved revision is read by each Server instance.
type AdminPostgresPoolSetting struct {
	Name               string `gorm:"size:48;primaryKey"`
	MaxOpenConnections int    `gorm:"not null"`
	MaxIdleConnections int    `gorm:"not null"`
	Revision           uint64 `gorm:"not null"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (AdminPostgresPoolSetting) TableName() string { return "xd_admin_postgres_pool_settings" }

// Immutable historical snapshots allow an audited admin to roll back without
// rewriting a previous revision or impacting database connection credentials.
type AdminPostgresPoolRevision struct {
	Name               string    `gorm:"size:48;primaryKey"`
	Revision           uint64    `gorm:"primaryKey;autoIncrement:false"`
	MaxOpenConnections int       `gorm:"not null"`
	MaxIdleConnections int       `gorm:"not null"`
	Origin             string    `gorm:"size:16;not null"`
	CreatedAt          time.Time `gorm:"not null"`
}

func (AdminPostgresPoolRevision) TableName() string { return "xd_admin_postgres_pool_revisions" }
