package meta

import "time"

// BaiduMapScopeHandoff is a private, one-use Owner PhotoScope bridge between
// whole-document map SDK runtimes. It is NEVER a Map-only Cookie ticket and
// grants no media bytes. Only a SHA-256 digest of the random nonce is stored.
// The original Gallery range and revocable Consent are always re-queried.
type BaiduMapScopeHandoff struct {
	Hash                  string     `gorm:"size:64;primaryKey"`
	OwnerID               uint64     `gorm:"not null;index"`
	SessionVersion        uint64     `gorm:"not null"`
	ConfigurationRevision uint64     `gorm:"not null"`
	RevocationEpoch       uint64     `gorm:"not null"`
	TargetMode            string     `gorm:"size:16;not null"`
	ScopeJSON             string     `gorm:"type:text;not null"`
	CameraJSON            string     `gorm:"type:text;not null;default:''"`
	AlbumRevision         uint64     `gorm:"not null;default:0"`
	ExpiresAt             time.Time  `gorm:"not null;index"`
	ConsumedAt            *time.Time `gorm:"index"`
	CreatedAt             time.Time
}

func (BaiduMapScopeHandoff) TableName() string { return "xd_baidu_map_scope_handoffs" }
