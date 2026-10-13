package meta

import "time"

// BaiduJSAPIMapEpoch is the durable per-owner revocation fence shared by all
// Server replicas. No map runtime is enabled by creating this row.
// Missing rows and zero epochs must be rejected by cookie verification.
type BaiduJSAPIMapEpoch struct {
	OwnerID      uint64     `gorm:"primaryKey;autoIncrement:false;not null"`
	Epoch        uint64     `gorm:"not null;default:1"`
	RevokedAfter *time.Time `gorm:"index"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Owner        User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BaiduJSAPIMapEpoch) TableName() string { return "xd_baidu_jsapi_map_epochs" }
