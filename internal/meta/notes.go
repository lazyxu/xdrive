package meta

import "time"

const (
	NoteSourceMine = "mine"
	NoteSourceIOS  = "ios_notes"
)

// Note is a metadata index for a real Owner-owned Markdown Node backed by CAS.
// Source and external identity are server-owned; null external IDs allow
// independent manual imports and ordinary user-created notes.
type Note struct {
	ID         string     `gorm:"size:36;primaryKey"`
	OwnerID    uint64     `gorm:"not null;uniqueIndex:idx_xd_notes_source_identity,priority:1;index"`
	Source     string     `gorm:"size:16;not null;uniqueIndex:idx_xd_notes_source_identity,priority:2"`
	ExternalID *string    `gorm:"size:255;uniqueIndex:idx_xd_notes_source_identity,priority:3"`
	NodeID     uint64     `gorm:"not null;uniqueIndex"`
	Title      string     `gorm:"size:255;not null"`
	SearchText string     `gorm:"type:text"` // Derived Owner-scoped search cache; canonical bytes remain in File/CAS
	DeletedAt  *time.Time `gorm:"index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (Note) TableName() string { return "xd_notes" }
