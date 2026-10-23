package meta

import "time"

// AdminCaddyAppliedNonce is the durable, global, append-only anti-replay ledger
// for independently signed Host Collector evidence. This is NOT the current
// Caddy configuration authority and never stores a private key, TLS material,
// source IP, credential, or raw signed receipt.
type AdminCaddyAppliedNonce struct {
	NonceSHA256         string    `gorm:"size:64;primaryKey"`
	CollectorID         string    `gorm:"size:64;not null"`
	HostID              string    `gorm:"size:64;not null"`
	ServerID            string    `gorm:"size:64;not null"`
	OperationID         string    `gorm:"size:24;not null"`
	PublicKeyDER_SHA256 string    `gorm:"size:64;not null"`
	EnvSHA              string    `gorm:"size:64;not null"`
	GenerationSHA       string    `gorm:"size:64;not null"`
	ConfigSHA           string    `gorm:"size:64;not null"`
	ConsumedAt          time.Time `gorm:"not null"`
}

func (AdminCaddyAppliedNonce) TableName() string { return "xd_admin_caddy_applied_nonces" }
