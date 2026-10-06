package meta

import "time"

type BackgroundRuntimeCancelIntent struct {
	OwnerID             uint64     `gorm:"primaryKey;autoIncrement:false"`
	Kind                string     `gorm:"primaryKey;size:64"`
	RequestedEpoch      uint64     `gorm:"not null;default:0"`
	AppliedEpoch        uint64     `gorm:"not null;default:0"`
	PhotoReanalyzeEpoch uint64     `gorm:"not null;default:0"`
	Trigger             string     `gorm:"size:32;not null"`
	Initiator           string     `gorm:"size:16;not null"`
	InitiatorID         uint64     `gorm:"not null;default:0"`
	RequestedAt         time.Time  `gorm:"not null;index"`
	AppliedAt           *time.Time `gorm:"index"`
	CreatedAt           time.Time
	UpdatedAt           time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BackgroundRuntimeCancelIntent) TableName() string {
	return "xd_background_runtime_cancel_intents"
}
