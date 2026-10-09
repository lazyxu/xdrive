package meta

import "time"

// AdminServiceSecret stores encrypted administrator-managed optional-service
// secrets. Rows override the corresponding deployment environment values,
// including when explicitly disabled or cleared. Ciphertext is never plaintext.
type AdminServiceSecret struct {
	Name       string `gorm:"primaryKey;size:64"`
	Enabled    bool   `gorm:"not null;default:false"`
	Ciphertext []byte `gorm:"type:bytea"`
	KeyVersion uint32 `gorm:"not null;default:0"`
	Revision   uint64 `gorm:"not null;default:1"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (AdminServiceSecret) TableName() string { return "xd_admin_service_secrets" }
