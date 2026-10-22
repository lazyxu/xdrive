package meta

import "time"

// BaiduJSAPIChildTicket is a one-use, short-lived cross-site map-only bootstrap.
// The opaque 256-bit ticket never enters logs, DB, the Baidu SDK or media URLs.
// Hash is the SHA-256 of the ticket, not its plaintext.
type BaiduJSAPIChildTicket struct {
	Hash                  string     `gorm:"size:64;primaryKey"`
	OwnerID               uint64     `gorm:"not null;index"`
	SessionVersion        uint64     `gorm:"not null"`
	ConfigurationRevision uint64     `gorm:"not null"`
	RevocationEpoch       uint64     `gorm:"not null"`
	ExpiresAt             time.Time  `gorm:"not null;index"`
	RedeemedAt            *time.Time `gorm:"index"`
	CreatedAt             time.Time
}

func (BaiduJSAPIChildTicket) TableName() string { return "xd_baidu_jsapi_child_tickets" }
