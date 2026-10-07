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
	StorageKey string `gorm:"size:1024;not null;index"`
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
	StorageKey string `gorm:"size:1024;not null;index"`
	SHA256     string `gorm:"size:64;index"`
	CreatedAt  time.Time
}

func (FileVersion) TableName() string { return "xd_file_versions" }

const (
	ContentBlobStateReady    = "ready"
	ContentBlobStateDeleting = "deleting"
)

type ContentBlob struct {
	SHA256     string `gorm:"size:64;primaryKey"`
	Size       int64  `gorm:"not null"`
	StorageKey string `gorm:"size:1024;not null;uniqueIndex"`
	RefCount   int64  `gorm:"not null"`
	State      string `gorm:"size:16;not null;default:ready;index"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (ContentBlob) TableName() string { return "xd_content_blobs" }

type StorageSample struct {
	ID                        uint64    `gorm:"primaryKey"`
	SlotAt                    time.Time `gorm:"not null;uniqueIndex"`
	CapturedAt                time.Time `gorm:"not null;index"`
	CASBlobCount              int64     `gorm:"not null"`
	CASPhysicalBytes          int64     `gorm:"not null"`
	CASLogicalReferencedBytes int64     `gorm:"not null"`
	CASDedupRatio             float64   `gorm:"not null"`
	CASSavingsRatio           float64   `gorm:"not null"`
	P50BlobSizeBytes          int64     `gorm:"not null"`
	P90BlobSizeBytes          int64     `gorm:"not null"`
	P99BlobSizeBytes          int64     `gorm:"not null"`
	BucketsJSON               string    `gorm:"type:text;not null"`
	CreatedAt                 time.Time
}

func (StorageSample) TableName() string { return "xd_storage_samples" }

type BackgroundOwnerCancellation struct {
	OwnerID        uint64     `gorm:"primaryKey;autoIncrement:false"`
	Kind           string     `gorm:"primaryKey;size:64"`
	RequestedEpoch uint64     `gorm:"not null;default:0"`
	AppliedEpoch   uint64     `gorm:"not null;default:0"`
	Initiator      string     `gorm:"size:16;not null"`
	InitiatorID    uint64     `gorm:"not null;default:0"`
	RequestedAt    time.Time  `gorm:"not null;index"`
	AppliedAt      *time.Time `gorm:"index"`
	CreatedAt      time.Time
	UpdatedAt      time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BackgroundOwnerCancellation) TableName() string {
	return "xd_background_owner_cancellations"
}

type BackgroundRuntimePresence struct {
	InstanceID      string     `gorm:"size:64;primaryKey"`
	TaskID          string     `gorm:"size:255;primaryKey"`
	Kind            string     `gorm:"size:64;not null;index"`
	Scope           string     `gorm:"size:16;not null;index:idx_xd_runtime_presence_scope_owner,priority:1"`
	OwnerID         uint64     `gorm:"not null;index:idx_xd_runtime_presence_scope_owner,priority:2"`
	State           string     `gorm:"size:24;not null;index"`
	Trigger         string     `gorm:"size:32;not null"`
	Initiator       string     `gorm:"size:16;not null"`
	Priority        uint8      `gorm:"not null"`
	Resource        string     `gorm:"size:32;not null;index"`
	ProgressPhase   string     `gorm:"size:64"`
	ProgressCurrent int64      `gorm:"not null;default:0"`
	ProgressTotal   int64      `gorm:"not null;default:0"`
	ProgressUnit    string     `gorm:"size:32"`
	ProgressMessage string     `gorm:"type:text"`
	ActiveCount     int        `gorm:"not null;default:0"`
	QueuedCount     int        `gorm:"not null;default:0"`
	RunningCount    int        `gorm:"not null;default:0"`
	StartedAt       *time.Time `gorm:"index"`
	TaskUpdatedAt   time.Time  `gorm:"not null;index"`
	ExpiresAt       time.Time  `gorm:"not null;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (BackgroundRuntimePresence) TableName() string {
	return "xd_background_runtime_presence"
}

const (
	SystemMaintenanceKindJanitor        = "janitor"
	SystemMaintenanceKindStorageSampler = "storage_sampler"
	SystemMaintenanceKindSourceVerify   = "source_verify"
	SystemMaintenanceKindSourceRepair   = "source_repair"
	SystemMaintenanceKindMediaVerify    = "media_verify"

	SystemMaintenanceStatusQueued          = "queued"
	SystemMaintenanceStatusRunning         = "running"
	SystemMaintenanceStatusCancelRequested = "cancel_requested"
	SystemMaintenanceStatusCancelled       = "cancelled"
	SystemMaintenanceStatusSuccess         = "success"
	SystemMaintenanceStatusIssues          = "issues"
	SystemMaintenanceStatusPartial         = "partial"
	SystemMaintenanceStatusFailed          = "failed"

	SystemMaintenancePhaseQueued                  = "queued"
	SystemMaintenancePhaseStarting                = "starting"
	SystemMaintenancePhaseStagingCleanup          = "staging_cleanup"
	SystemMaintenancePhaseContentBlobGC           = "content_blob_gc"
	SystemMaintenancePhaseSourceRunRetention      = "source_run_retention"
	SystemMaintenancePhaseCleanupHistoryRetention = "cleanup_history_retention"
	SystemMaintenancePhaseMaintenanceRunRetention = "maintenance_run_retention"
	SystemMaintenancePhaseStorageSample           = "storage_sample"
	SystemMaintenancePhaseSourceVerify            = "source_verify"
	SystemMaintenancePhaseSourceRepair            = "source_repair"
	SystemMaintenancePhaseMediaVerify             = "media_verify"
	SystemMaintenancePhaseFinished                = "finished"
)

type SystemMaintenanceRun struct {
	ID                uint64     `gorm:"primaryKey"`
	Kind              string     `gorm:"size:32;not null;index"`
	Status            string     `gorm:"size:24;not null;index"`
	Phase             string     `gorm:"size:64;not null"`
	Trigger           string     `gorm:"size:32;not null;default:schedule;index"`
	Initiator         string     `gorm:"size:16;not null;default:system"`
	InitiatorID       uint64     `gorm:"not null;default:0"`
	CompletedSteps    int        `gorm:"not null;default:0"`
	TotalSteps        int        `gorm:"not null;default:0"`
	Summary           string     `gorm:"type:text"`
	Error             string     `gorm:"type:text"`
	CancelRequestedAt *time.Time `gorm:"index"`
	StartedAt         time.Time  `gorm:"not null;index"`
	FinishedAt        *time.Time `gorm:"index"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (SystemMaintenanceRun) TableName() string {
	return "xd_system_maintenance_runs"
}

type Share struct {
	ID            uint64     `gorm:"primaryKey"`
	OwnerID       uint64     `gorm:"not null;index;index:idx_xd_shares_owner_node"`
	NodeID        uint64     `gorm:"not null;index;index:idx_xd_shares_owner_node"`
	TokenHash     string     `gorm:"size:64;not null;uniqueIndex"`
	PasswordHash  string     `gorm:"size:255"`
	ExpiresAt     *time.Time `gorm:"index"`
	MaxDownloads  int64      `gorm:"not null;default:0"`
	DownloadCount int64      `gorm:"not null;default:0"`
	RevokedAt     *time.Time `gorm:"index"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (Share) TableName() string { return "xd_shares" }

type AuditEvent struct {
	ID            uint64    `gorm:"primaryKey"`
	ActorUserID   *uint64   `gorm:"index"`
	ActorUsername string    `gorm:"size:64;index"`
	ActorRole     string    `gorm:"size:16"`
	Action        string    `gorm:"size:80;not null;index"`
	TargetType    string    `gorm:"size:32;index"`
	TargetID      string    `gorm:"size:128;index"`
	TargetLabel   string    `gorm:"size:255"`
	Result        string    `gorm:"size:16;not null;index"`
	RequestID     string    `gorm:"size:64;index"`
	IPAddress     string    `gorm:"size:64"`
	Metadata      string    `gorm:"type:text"`
	CreatedAt     time.Time `gorm:"not null;index"`
}

func (AuditEvent) TableName() string { return "xd_audit_events" }

const (
	UploadStatusActive    = "active"
	UploadStatusFinalized = "finalized"
	UploadStatusSkipped   = "skipped"

	UploadConflictPolicyFail      = "fail"
	UploadConflictPolicySkip      = "skip"
	UploadConflictPolicyKeepBoth  = "keep_both"
	UploadConflictPolicyOverwrite = "overwrite"
)

func NormalizeUploadConflictPolicy(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return UploadConflictPolicyFail, true
	}
	switch value {
	case UploadConflictPolicyFail, UploadConflictPolicySkip, UploadConflictPolicyKeepBoth, UploadConflictPolicyOverwrite:
		return value, true
	default:
		return "", false
	}
}

type UploadSession struct {
	ID                 string  `gorm:"size:36;primaryKey"`
	OwnerID            uint64  `gorm:"not null;index"`
	ParentID           *uint64 `gorm:"index"`
	NodeID             *uint64 `gorm:"index"`
	Name               string  `gorm:"size:255"`
	RequestedName      string  `gorm:"size:255"`
	ConflictPolicy     string  `gorm:"size:16;not null;default:'';index"`
	ExpectedRevision   uint64
	TotalSize          int64  `gorm:"not null"`
	ChunkSize          int64  `gorm:"not null"`
	ChunkCount         int    `gorm:"not null"`
	SHA256             string `gorm:"size:64;index"`
	ExpectedMD5        string `gorm:"size:32;index"`
	ResumeKey          string `gorm:"size:128;index"`
	Status             string `gorm:"size:16;not null;index"`
	ReservedBytes      int64  `gorm:"not null;default:0"`
	QuotaReservedBytes int64  `gorm:"not null;default:0"`
	ResultNodeID       *uint64
	ExpiresAt          time.Time `gorm:"not null;index"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
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

const (
	StagingCleanupTriggerManual  = "manual"
	StagingCleanupTriggerJanitor = "janitor"

	StagingCleanupStatusSuccess = "success"
	StagingCleanupStatusPartial = "partial"
	StagingCleanupStatusFailed  = "failed"
)

type StagingCleanupRun struct {
	ID           uint64     `gorm:"primaryKey"`
	Trigger      string     `gorm:"size:16;not null;index"`
	Status       string     `gorm:"size:16;not null;index"`
	DeletedFiles int64      `gorm:"not null;default:0"`
	DeletedBytes int64      `gorm:"not null;default:0"`
	FailedFiles  int64      `gorm:"not null;default:0"`
	Error        string     `gorm:"type:text"`
	StartedAt    time.Time  `gorm:"not null;index"`
	FinishedAt   *time.Time `gorm:"index"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (StagingCleanupRun) TableName() string { return "xd_staging_cleanup_runs" }

type StagingCleanupFailure struct {
	ID         uint64    `gorm:"primaryKey"`
	RunID      uint64    `gorm:"not null;index"`
	StorageKey string    `gorm:"size:1024;not null"`
	Size       int64     `gorm:"not null;default:0"`
	Error      string    `gorm:"type:text;not null"`
	FailedAt   time.Time `gorm:"not null;index"`
	CreatedAt  time.Time

	Run StagingCleanupRun `gorm:"foreignKey:RunID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (StagingCleanupFailure) TableName() string { return "xd_staging_cleanup_failures" }

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
