package meta

import "time"

// NotesNamespace binds an Owner's managed in-Files tree to immutable Node IDs.
// A matching directory name is NOT authority: manually existing folders are
// not silently adopted and callers cannot claim an iOS-backup scope by name.
type NotesNamespace struct {
	OwnerID       uint64 `gorm:"primaryKey"`
	SystemNodeID  uint64 `gorm:"not null;uniqueIndex"`
	NotesNodeID   uint64 `gorm:"not null;uniqueIndex"`
	IOSNodeID     uint64 `gorm:"not null;uniqueIndex"`
	MineNodeID    uint64 `gorm:"not null;uniqueIndex"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (NotesNamespace) TableName() string { return "xd_notes_namespaces" }
