package meta

import "time"

// SourceCredential stores one encrypted connector-specific credential payload.
// Plaintext never resides in PostgreSQL. KeyVersion identifies the encryption
// key in the server-side connector keyring.
type SourceCredential struct {
	SourceID   uint64 `gorm:"primaryKey"`
	Ciphertext []byte `gorm:"type:bytea;not null"`
	KeyVersion uint32 `gorm:"not null;index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceCredential) TableName() string { return "xd_source_credentials" }
