package meta

import "time"

// BaiduPhotoMapIndexIntent is a PRIVATE durable, per-PhotoAsset dispatch
// intent. It is never serialized through Gallery, Web, Desktop or Agent IPC.
// Source coordinates and both Baidu AKs are deliberately NOT stored here.
// Claiming an intent is not permission to contact Baidu: a future dispatcher
// must independently recheck privacy, licence, provider quota and cancellation.
type BaiduPhotoMapIndexIntent struct {
	AssetID           uint64    `gorm:"primaryKey;autoIncrement:false"`
	OwnerID           uint64    `gorm:"not null;index:idx_xd_baidu_map_intent_owner_state,priority:1"`
	PrimaryNodeID     uint64    `gorm:"not null"`
	NodeRevision      uint64    `gorm:"not null"`
	MediaUpdatedAt    time.Time `gorm:"not null"`
	ConsentRevision   uint64    `gorm:"not null"`
	SessionVersion    uint64    `gorm:"not null"`
	Status            string    `gorm:"size:16;not null;index:idx_xd_baidu_map_intent_owner_state,priority:2;index:idx_xd_baidu_map_intent_status_updated,priority:1"`
	Attempts          uint32    `gorm:"not null;default:0"`
	LeaseToken        string    `gorm:"size:36;not null;default:''"`
	LeaseUntil        *time.Time
	RetryAfter        *time.Time `gorm:"index"`
	CancelRequestedAt *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time `gorm:"index:idx_xd_baidu_map_intent_status_updated,priority:2"`

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Owner User       `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BaiduPhotoMapIndexIntent) TableName() string { return "xd_baidu_photo_map_index_intents" }
