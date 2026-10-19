package meta

import "time"

// InternalServiceKeyAnchor records the non-secret identity of an installation
// key set independently from encrypted AdminServiceSecret rows. Losing any
// ciphertext while this anchor remains is a recovery failure, not first boot.
type InternalServiceKeyAnchor struct {
	Name        string `gorm:"primaryKey;size:64"`
	Fingerprint []byte `gorm:"type:bytea;not null"`
	Revision    uint64 `gorm:"not null;default:1"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (InternalServiceKeyAnchor) TableName() string { return "xd_internal_service_key_anchors" }
