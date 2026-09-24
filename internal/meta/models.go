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

	UserRoleUser  = "user"
	UserRoleAdmin = "admin"
)

type User struct {
	ID                 uint64     `gorm:"primaryKey"`
	Username           string     `gorm:"size:64;uniqueIndex;not null"`
	PasswordHash       string     `gorm:"size:255;not null"`
	Role               string     `gorm:"size:16;not null;default:user;index"`
	MustChangePassword bool       `gorm:"not null;default:false"`
	SessionVersion     uint64     `gorm:"not null;default:1"`
	QuotaBytes         int64      `gorm:"not null;default:0"`
	DisabledAt         *time.Time `gorm:"index"`
	LastLoginAt        *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (User) TableName() string { return "xd_users" }

type RefreshToken struct {
	ID           uint64 `gorm:"primaryKey"`
	UserID       uint64 `gorm:"not null;index"`
	TokenHash    string `gorm:"size:64;not null;uniqueIndex"`
	CreatedAt    time.Time
	ExpiresAt    time.Time  `gorm:"not null;index"`
	RevokedAt    *time.Time `gorm:"index"`
	ReplacedByID *uint64
}

func (RefreshToken) TableName() string { return "xd_refresh_tokens" }

type Node struct {
	ID          uint64     `gorm:"primaryKey"`
	ParentID    *uint64    `gorm:"index"`
	Name        string     `gorm:"size:255;not null"`
	Type        string     `gorm:"size:8;not null;index"`
	OwnerID     uint64     `gorm:"not null;index"`
	Revision    uint64     `gorm:"not null;default:1"`
	DeletedAt   *time.Time `gorm:"index"`
	TrashRootID *uint64    `gorm:"index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
	File        *File `gorm:"foreignKey:NodeID;references:ID"`
}

func (Node) TableName() string { return "xd_nodes" }

type File struct {
	NodeID     uint64 `gorm:"primaryKey"`
	Size       int64  `gorm:"not null"`
	StorageKey string `gorm:"size:1024;not null;uniqueIndex"`
	SHA256     string `gorm:"size:64;index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (File) TableName() string { return "xd_files" }

type FileVersion struct {
	ID         uint64 `gorm:"primaryKey"`
	NodeID     uint64 `gorm:"not null;index;uniqueIndex:idx_xd_file_versions_node_revision"`
	Revision   uint64 `gorm:"not null;uniqueIndex:idx_xd_file_versions_node_revision"`
	Size       int64  `gorm:"not null"`
	StorageKey string `gorm:"size:1024;not null;uniqueIndex"`
	SHA256     string `gorm:"size:64;index"`
	CreatedAt  time.Time
}

func (FileVersion) TableName() string { return "xd_file_versions" }

const (
	UploadStatusActive    = "active"
	UploadStatusFinalized = "finalized"
)

type UploadSession struct {
	ID               string  `gorm:"size:36;primaryKey"`
	OwnerID          uint64  `gorm:"not null;index"`
	ParentID         *uint64 `gorm:"index"`
	NodeID           *uint64 `gorm:"index"`
	Name             string  `gorm:"size:255"`
	ExpectedRevision uint64
	TotalSize        int64  `gorm:"not null"`
	ChunkSize        int64  `gorm:"not null"`
	ChunkCount       int    `gorm:"not null"`
	SHA256           string `gorm:"size:64;index"`
	ResumeKey        string `gorm:"size:128;index"`
	Status           string `gorm:"size:16;not null;index"`
	ResultNodeID     *uint64
	ExpiresAt        time.Time `gorm:"not null;index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (UploadSession) TableName() string { return "xd_upload_sessions" }

type UploadPart struct {
	SessionID        string `gorm:"size:36;primaryKey"`
	PartIndex        int    `gorm:"primaryKey"`
	Size             int64  `gorm:"not null"`
	SHA256           string `gorm:"size:64;not null"`
	StorageKey       string `gorm:"size:1024;not null;uniqueIndex"`
	Reused           bool   `gorm:"not null;default:false;index"`
	SourceStorageKey string `gorm:"size:1024"`
	SourceOffset     int64
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (UploadPart) TableName() string { return "xd_upload_parts" }

var reservedWindowsNames = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

func ValidUserRole(role string) bool {
	return role == UserRoleUser || role == UserRoleAdmin
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
	if strings.ContainsAny(name, `<>:"/\|?*`) {
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
