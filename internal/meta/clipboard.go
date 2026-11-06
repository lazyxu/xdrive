package meta

import "time"

// ClipboardVault has only a random Owner-specific KDF salt. The Server never
// receives or stores the passphrase, derived key, or plaintext.
type ClipboardVault struct {
	OwnerID   uint64    `gorm:"primaryKey"`
	Salt      string    `gorm:"size:24;not null"`
	CheckNonce string `gorm:"size:24"`
	CheckCiphertext string `gorm:"size:256"`
	CreatedAt time.Time
}

func (ClipboardVault) TableName() string { return "xd_clipboard_vaults" }

// ClipboardItem stores end-to-end encrypted short-lived browser text.
// ClientEventID is the idempotency key scoped to this authenticated Owner.
type ClipboardItem struct {
	ID            uint64    `gorm:"primaryKey"`
	OwnerID       uint64    `gorm:"not null;index:idx_clipboard_owner_id,priority:1;uniqueIndex:idx_clipboard_event,priority:1"`
	ClientEventID string    `gorm:"size:36;not null;uniqueIndex:idx_clipboard_event,priority:2"`
	Kind          string    `gorm:"size:20;not null"`
	Nonce         string    `gorm:"size:24;not null"`
	Ciphertext    string    `gorm:"type:text;not null"`
	ExpiresAt     time.Time `gorm:"not null;index"`
	CreatedAt     time.Time `gorm:"not null;index:idx_clipboard_owner_id,priority:2"`
}

func (ClipboardItem) TableName() string { return "xd_clipboard_items" }
