package meta

import "time"

// BaiduServerAKProbe is one fixed, Server-only, fleet-wide row. It stores no AK,
// GPS, provider URL, response body, user record, or client-supplied input.
// SaltedTag binds a result to exactly the current enabled Server AK without
// making a saved credential revision or configured flag into provider proof.
type BaiduServerAKProbe struct {
	ID            uint8     `gorm:"primaryKey;autoIncrement:false"`
	Salt          []byte    `gorm:"type:bytea;not null"`
	SaltedTag     string    `gorm:"size:64;not null"`
	State         string    `gorm:"size:20;not null"`
	AttemptID     string    `gorm:"size:32;not null"`
	AttemptedAt   time.Time `gorm:"not null"`
	NextAttemptAt time.Time `gorm:"not null"`
	CheckedAt     *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (BaiduServerAKProbe) TableName() string { return "xd_baidu_server_ak_probes" }
