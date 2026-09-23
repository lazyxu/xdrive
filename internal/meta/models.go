package meta

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	NodeTypeDir  = "dir"
	NodeTypeFile = "file"
)

type User struct {
	ID           uint64 `gorm:"primaryKey"`
	Username     string `gorm:"size:64;uniqueIndex;not null"`
	PasswordHash string `gorm:"size:255;not null"`
	CreatedAt    time.Time
}

func (User) TableName() string { return "xd_users" }

type RefreshToken struct {
	ID           uint64 `gorm:"primaryKey"`
	UserID       uint64 `gorm:"not null;index"`
	TokenHash    string `gorm:"size:64;not null;uniqueIndex"`
	CreatedAt    time.Time
	ExpiresAt    time.Time `gorm:"not null;index"`
	RevokedAt    *time.Time `gorm:"index"`
	ReplacedByID *uint64
}

func (RefreshToken) TableName() string { return "xd_refresh_tokens" }

type Node struct {
	ID        uint64  `gorm:"primaryKey"`
	ParentID  *uint64 `gorm:"index"`
	Name      string  `gorm:"size:255;not null"`
	Type      string  `gorm:"size:8;not null;index"`
	OwnerID   uint64  `gorm:"not null;index"`
	CreatedAt time.Time
	UpdatedAt time.Time
	File      *File `gorm:"foreignKey:NodeID;references:ID"`
}

func (Node) TableName() string { return "xd_nodes" }

type File struct {
	NodeID     uint64 `gorm:"primaryKey"`
	Size       int64  `gorm:"not null"`
	StorageKey string `gorm:"size:1024;not null;uniqueIndex"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (File) TableName() string { return "xd_files" }

var reservedWindowsNames = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// ValidateName intentionally uses the Windows-compatible subset because the
// same namespace must be representable through CfAPI and Linux FUSE.
func ValidateName(name string) error {
	if name == "" || name == "." || name == ".." {
		return errors.New("name is empty or reserved")
	}
	if !utf8.ValidString(name) || len([]byte(name)) > 255 {
		return errors.New("name is not valid UTF-8 or is too long")
	}
	if strings.HasSuffix(name, " ") || strings.HasSuffix(name, ".") {
		return errors.New("name cannot end with space or dot")
	}
	if strings.ContainsAny(name, `<>:"/\\|?*`) {
		return errors.New("name contains a reserved character")
	}
	for _, r := range name {
		if r < 32 {
			return errors.New("name contains a control character")
		}
	}
	base := name
	if i := strings.IndexByte(base, '.'); i >= 0 {
		base = base[:i]
	}
	if _, ok := reservedWindowsNames[strings.ToUpper(base)]; ok {
		return errors.New("name is reserved on Windows")
	}
	return nil
}
