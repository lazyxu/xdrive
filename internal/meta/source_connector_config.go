package meta

import "time"

// SourceConnectorConfig stores non-secret connector-specific settings.
// Credentials remain encrypted separately in SourceCredential.
type SourceConnectorConfig struct {
	SourceID  uint64 `gorm:"primaryKey"`
	Payload   string `gorm:"type:text;not null"`
	Revision  uint64 `gorm:"not null;default:1"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceConnectorConfig) TableName() string { return "xd_source_connector_configs" }
