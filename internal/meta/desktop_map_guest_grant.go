package meta

import "time"

// DesktopMapGuestGrant is a one-use, 30-second native-Agent-to-browser bridge.
// Only its SHA-256 digest is persisted. The plaintext ticket never enters
// a URL, browser JavaScript, a log, or the third-party map SDK.
type DesktopMapGuestGrant struct {
	Hash            string     `gorm:"size:64;primaryKey"`
	OwnerID         uint64     `gorm:"not null;index"`
	SessionVersion  uint64     `gorm:"not null"`
	NativeRefreshID uint64     `gorm:"not null"`
	Host            string     `gorm:"size:253;not null"`
	ExpiresAt       time.Time  `gorm:"not null;index"`
	RedeemedAt      *time.Time `gorm:"index"`
	CreatedAt       time.Time
}

func (DesktopMapGuestGrant) TableName() string { return "xd_desktop_map_guest_grants" }
