package meta

import "time"

// ClipboardVault has only a random Owner-specific KDF salt. The Server never
// receives or stores the passphrase, derived key, or plaintext.
type ClipboardVault struct {
	OwnerID         uint64 `gorm:"primaryKey"`
	Salt            string `gorm:"size:24;not null"`
	CheckNonce      string `gorm:"size:24"`
	CheckCiphertext string `gorm:"size:256"`
	// First verified Browser's v1 AAD scope, bound once for LAN/public aliases.
	AADScope  string `gorm:"size:512;not null;default:''"`
	CreatedAt time.Time
}

func (ClipboardVault) TableName() string { return "xd_clipboard_vaults" }

// ClipboardItem stores end-to-end encrypted short-lived browser text.
// ClientEventID is the idempotency key scoped to this authenticated Owner.
type ClipboardItem struct {
	ID             uint64    `gorm:"primaryKey"`
	OwnerID        uint64    `gorm:"not null;index:idx_clipboard_owner_id,priority:1;uniqueIndex:idx_clipboard_event,priority:1"`
	ClientEventID  string    `gorm:"size:36;not null;uniqueIndex:idx_clipboard_event,priority:2"`
	Kind           string    `gorm:"size:48;not null"`
	TargetDeviceID string    `gorm:"size:36;not null;default:'';index"`
	EphemeralKey   string    `gorm:"size:44;not null;default:''"`
	WrappedKey     string    `gorm:"size:80;not null;default:''"`
	NodeID         *uint64   `gorm:"index"`
	Nonce          string    `gorm:"size:24;not null"`
	Ciphertext     string    `gorm:"type:text;not null"`
	ExpiresAt      time.Time `gorm:"not null;index"`
	CreatedAt      time.Time `gorm:"not null;index:idx_clipboard_owner_id,priority:2"`
}

func (ClipboardItem) TableName() string { return "xd_clipboard_items" }

// ClipboardChange is an Owner-only durable notification cursor. It deliberately
// contains no plaintext, key material, nonce or even encrypted payload; clients
// re-fetch the bounded mailbox through the existing revocable Owner API.
type ClipboardChange struct {
	ID             uint64    `gorm:"primaryKey"`
	OwnerID        uint64    `gorm:"not null;index:idx_clipboard_change_owner,priority:1"`
	Kind           string    `gorm:"size:12;not null"`
	TargetDeviceID string    `gorm:"size:36;not null;default:''"`
	CreatedAt      time.Time `gorm:"not null;index:idx_clipboard_change_owner,priority:2"`
}

func (ClipboardChange) TableName() string { return "xd_clipboard_changes" }

// Separate Owner/device Clipboard capability; not an arbitrary Source/Root
// entitlement. The Server stores public Curve25519 material only.
type ClipboardDeviceKey struct {
	OwnerID   uint64     `gorm:"primaryKey"`
	DeviceID  string     `gorm:"size:36;primaryKey"`
	PublicKey string     `gorm:"size:44;not null"`
	CreatedAt time.Time 
	UpdatedAt time.Time 
	RevokedAt *time.Time `gorm:"index"`
}

func (ClipboardDeviceKey) TableName() string { return "xd_clipboard_device_keys" }
