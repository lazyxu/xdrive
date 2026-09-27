package meta

import "time"

const (
	ContentDigestAliasStateReady     = "ready"
	ContentDigestAliasStateAmbiguous = "ambiguous"
)

// ContentDigestAlias records a digest-to-SHA256 mapping only after xDrive has
// verified the digest against bytes it actually assembled. OwnerID keeps the
// lookup proof-of-possession scoped to one account.
type ContentDigestAlias struct {
	OwnerID    uint64    `gorm:"primaryKey;not null"`
	Algorithm  string    `gorm:"size:16;primaryKey"`
	Digest     string    `gorm:"size:128;primaryKey"`
	Size       int64     `gorm:"primaryKey;not null"`
	SHA256     string    `gorm:"size:64;index"`
	State      string    `gorm:"size:16;not null;index"`
	VerifiedAt time.Time `gorm:"not null;index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (ContentDigestAlias) TableName() string { return "xd_content_digest_aliases" }
