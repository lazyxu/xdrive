package meta

import "time"

// Global administrator HTTPS intent. These rows do not control Caddy
// until a separately audited, lockout-safe Host Manager apply is delivered.
type AdminCaddyHTTPSSetting struct {
	Name       string `gorm:"size:48;primaryKey"`
	Revision   uint64 `gorm:"not null"`
	Enabled    bool   `gorm:"not null"`
	Domain     string `gorm:"size:253;not null"`
	LANEnabled bool   `gorm:"not null;default:false"`
	LANIP      string `gorm:"size:45;not null;default:''"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (AdminCaddyHTTPSSetting) TableName() string { return "xd_admin_caddy_https_settings" }

// Immutable revisions permit review and a rollback *of desired configuration*.
// They never claim the HTTPS configuration was installed by the host.
type AdminCaddyHTTPSRevision struct {
	Name       string    `gorm:"size:48;primaryKey"`
	Revision   uint64    `gorm:"primaryKey;autoIncrement:false"`
	Enabled    bool      `gorm:"not null"`
	Domain     string    `gorm:"size:253;not null"`
	LANEnabled bool      `gorm:"not null;default:false"`
	LANIP      string    `gorm:"size:45;not null;default:''"`
	Origin     string    `gorm:"size:16;not null"`
	CreatedAt  time.Time `gorm:"not null"`
}

func (AdminCaddyHTTPSRevision) TableName() string { return "xd_admin_caddy_https_revisions" }
