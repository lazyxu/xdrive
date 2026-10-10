package meta

import (
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// SourceKindLocalFolder is a regular device-authorized local directory push,
	// not the xDrive CfAPI/FUSE mount or the Synology NAS Photos push connector.
	SourceKindLocalFolder = "local_folder"

	SourceDirectionPush = "push"
	SourceDirectionPull = "pull"

	SourceSyncModeBackup = "backup"
	SourceSyncModeMirror = "mirror"

	SourceRunModeSync = "sync"
	SourceRunModeScan = "scan"

	SourceStatusActive = "active"
	SourceStatusPaused = "paused"

	SourceItemKindFile      = "file"
	SourceItemKindDirectory = "directory"

	SourceItemStatePending = "pending"
	SourceItemStateSynced  = "synced"
	SourceItemStateMissing = "missing"
	SourceItemStateIgnored = "ignored"
	SourceItemStateError   = "error"

	SyncRunTriggerManual    = "manual"
	SyncRunTriggerScheduled = "scheduled"
	SyncRunTriggerEvent     = "event"
	SyncRunTriggerReconcile = "reconcile"

	SyncRunStatusRunning   = "running"
	SyncRunStatusCompleted = "completed"
	SyncRunStatusPartial   = "partial"
	SyncRunStatusFailed    = "failed"
	SyncRunStatusCancelled = "cancelled"
)

// Source is a vendor-neutral external ingestion source. Connector-specific
// credentials and configuration intentionally live outside this foundation.
type Source struct {
	ID                 uint64     `gorm:"primaryKey"`
	OwnerID            uint64     `gorm:"not null;index"`
	Name               string     `gorm:"size:128;not null"`
	Kind               string     `gorm:"size:64;not null;index"`
	Direction          string     `gorm:"size:16;not null;index"`
	SyncMode           string     `gorm:"size:16;not null;index"`
	RunMode            string     `gorm:"size:16;not null;default:sync;index"`
	Status             string     `gorm:"size:16;not null;default:active;index"`
	ScheduleType       string     `gorm:"size:16;index"`
	ScheduleExpression string     `gorm:"size:128"`
	ScheduleTimezone   string     `gorm:"size:64"`
	Revision           uint64     `gorm:"not null;default:1"`
	TargetNodeID       *uint64    `gorm:"index"`
	IgnoreRules        string     `gorm:"type:text"`
	Checkpoint         string     `gorm:"type:text"`
	LastRunAt          *time.Time `gorm:"index"`
	LastSuccessAt      *time.Time `gorm:"index"`
	LastError          string     `gorm:"type:text"`
	RetryAttempt       int        `gorm:"not null;default:0"`
	RetryAt            *time.Time `gorm:"index"`
	RetryClass         string     `gorm:"size:32;index"`
	RunRequestedAt     *time.Time `gorm:"index"`
	CreatedAt          time.Time
	UpdatedAt          time.Time

	// The enrolled creating device may first bind this paused local Source.
	// Nil is an unclaimed legacy record, not a remotely transferrable grant.
	LocalCreatorDeviceID *string `json:"-" gorm:"size:36;index"`

	Owner      User  `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	TargetNode *Node `gorm:"foreignKey:TargetNodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
}

func (Source) TableName() string { return "xd_sources" }

// SourceItem preserves the stable identity of one external item independently
// from its path or content. NodeID is deliberately nullable: deleting an xDrive
// node must not erase the external identity needed for a later reconciliation.
type SourceItem struct {
	ID                     uint64     `gorm:"primaryKey"`
	SourceID               uint64     `gorm:"not null;index;uniqueIndex:idx_xd_source_items_source_external"`
	ExternalID             string     `gorm:"size:512;not null;uniqueIndex:idx_xd_source_items_source_external"`
	NodeID                 *uint64    `gorm:"index"`
	NodeRevision           uint64     `gorm:"not null;default:0"`
	Kind                   string     `gorm:"size:16;not null;default:file;index"`
	Path                   string     `gorm:"size:2048"`
	Size                   int64      `gorm:"not null;default:0"`
	ModifiedAt             *time.Time `gorm:"index"`
	SHA256                 string     `gorm:"size:64;index"`
	RemoteRevision         string     `gorm:"size:255"`
	State                  string     `gorm:"size:16;not null;default:pending;index"`
	LastSeenRunID          string     `gorm:"size:36;index"`
	LastSeenAt             time.Time  `gorm:"not null;index"`
	MirrorMissingFullScans int        `gorm:"not null;default:0"`
	MirrorMissingSince     *time.Time `gorm:"index"`
	LastSyncedRunID        string     `gorm:"size:36;index"`
	LastSyncedAt           *time.Time `gorm:"index"`
	LastError              string     `gorm:"type:text"`
	CreatedAt              time.Time
	UpdatedAt              time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node   *Node  `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
}

func (SourceItem) TableName() string { return "xd_source_items" }

// SyncRun records one connector-agnostic synchronization attempt. Checkpoints
// are opaque to xDrive core so pull cursors and push reconciliation tokens can
// evolve independently of the shared schema.
type SyncRun struct {
	ID                     string     `gorm:"size:36;primaryKey"`
	SourceID               uint64     `gorm:"not null;index;index:idx_xd_sync_runs_source_started"`
	RunNumber              int64      `gorm:"not null;default:0"`
	SourceRevision         uint64     `gorm:"not null;default:1"`
	SyncMode               string     `gorm:"size:16;not null;default:backup"`
	TargetNodeID           *uint64    `gorm:"index"`
	IgnoreRules            string     `gorm:"type:text"`
	Mode                   string     `gorm:"size:16;not null;default:sync;index"`
	Trigger                string     `gorm:"size:16;not null;index"`
	Status                 string     `gorm:"size:16;not null;default:running;index"`
	CheckpointBefore       string     `gorm:"type:text"`
	CheckpointAfter        string     `gorm:"type:text"`
	ScannedItems           int64      `gorm:"not null;default:0"`
	ScannedBytes           int64      `gorm:"not null;default:0"`
	ScannedFileItems       int64      `gorm:"not null;default:0"`
	ScannedDirectoryItems  int64      `gorm:"not null;default:0"`
	IgnoredItems           int64      `gorm:"not null;default:0"`
	IgnoredBytes           int64      `gorm:"not null;default:0"`
	NewItems               int64      `gorm:"not null;default:0"`
	NewBytes               int64      `gorm:"not null;default:0"`
	ChangedItems           int64      `gorm:"not null;default:0"`
	ChangedBytes           int64      `gorm:"not null;default:0"`
	MovedItems             int64      `gorm:"not null;default:0"`
	UnchangedItems         int64      `gorm:"not null;default:0"`
	UnchangedBytes         int64      `gorm:"not null;default:0"`
	MissingItems           int64      `gorm:"not null;default:0"`
	MissingBytes           int64      `gorm:"not null;default:0"`
	PlannedTransferItems   int64      `gorm:"not null;default:0"`
	PlannedTransferBytes   int64      `gorm:"not null;default:0"`
	ProcessedTransferItems int64      `gorm:"not null;default:0"`
	ProcessedTransferBytes int64      `gorm:"not null;default:0"`
	SyncedFileItems        int64      `gorm:"not null;default:0"`
	SyncedDirectoryItems   int64      `gorm:"not null;default:0"`
	SyncedBytes            int64      `gorm:"not null;default:0"`
	CreatedItems           int64      `gorm:"not null;default:0"`
	UpdatedItems           int64      `gorm:"not null;default:0"`
	SkippedItems           int64      `gorm:"not null;default:0"`
	DeletedItems           int64      `gorm:"not null;default:0"`
	TransferredItems       int64      `gorm:"not null;default:0"`
	TransferredBytes       int64      `gorm:"not null;default:0"`
	FailedItems            int64      `gorm:"not null;default:0"`
	ActiveTransferPath     string     `gorm:"size:2048"`
	ActiveTransferBytes    int64      `gorm:"not null;default:0"`
	ActiveTransferTotal    int64      `gorm:"not null;default:0"`
	CancelRequestedAt      *time.Time `gorm:"index"`
	Error                  string     `gorm:"type:text"`
	StartedAt              time.Time  `gorm:"not null;index;index:idx_xd_sync_runs_source_started"`
	FinishedAt             *time.Time `gorm:"index"`
	CreatedAt              time.Time
	UpdatedAt              time.Time

	Source Source `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SyncRun) TableName() string { return "xd_sync_runs" }

// SourceRunFailure is an immutable per-run snapshot of one failed source item.
// It preserves the file path and error that belonged to the run even if the
// SourceItem later succeeds and clears its current LastError.
type SourceRunFailure struct {
	ID           uint64    `gorm:"primaryKey"`
	RunID        string    `gorm:"size:36;not null;index;uniqueIndex:idx_xd_source_run_failures_run_item"`
	SourceID     uint64    `gorm:"not null;index"`
	SourceItemID uint64    `gorm:"not null;index;uniqueIndex:idx_xd_source_run_failures_run_item"`
	ExternalID   string    `gorm:"size:512;not null"`
	Kind         string    `gorm:"size:16;not null"`
	Path         string    `gorm:"size:2048"`
	Size         int64     `gorm:"not null;default:0"`
	Error        string    `gorm:"type:text;not null"`
	FailedAt     time.Time `gorm:"not null;index"`
	CreatedAt    time.Time
	UpdatedAt    time.Time

	Run        SyncRun    `gorm:"foreignKey:RunID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Source     Source     `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceItem SourceItem `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (SourceRunFailure) TableName() string { return "xd_source_run_failures" }

func ValidSourceName(name string) bool {
	if name == "" || name != strings.TrimSpace(name) || len([]byte(name)) > 128 || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if r < 32 {
			return false
		}
	}
	return true
}

func ValidSourceKind(kind string) bool {
	if len(kind) == 0 || len(kind) > 64 {
		return false
	}
	for i, r := range kind {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			continue
		}
		if i > 0 && (r == '-' || r == '_' || r == '.') {
			continue
		}
		return false
	}
	return true
}

func ValidSourceDirection(direction string) bool {
	return direction == SourceDirectionPush || direction == SourceDirectionPull
}

func ValidSourceSyncMode(mode string) bool {
	return mode == SourceSyncModeBackup || mode == SourceSyncModeMirror
}

func ValidSourceRunMode(mode string) bool {
	return mode == SourceRunModeSync || mode == SourceRunModeScan
}

func ValidSourceStatus(status string) bool {
	return status == SourceStatusActive || status == SourceStatusPaused
}

func ValidSourceItemKind(kind string) bool {
	return kind == SourceItemKindFile || kind == SourceItemKindDirectory
}

func ValidSourceItemState(state string) bool {
	switch state {
	case SourceItemStatePending, SourceItemStateSynced, SourceItemStateMissing, SourceItemStateIgnored, SourceItemStateError:
		return true
	default:
		return false
	}
}

func ValidSyncRunTrigger(trigger string) bool {
	switch trigger {
	case SyncRunTriggerManual, SyncRunTriggerScheduled, SyncRunTriggerEvent, SyncRunTriggerReconcile:
		return true
	default:
		return false
	}
}

func ValidSyncRunStatus(status string) bool {
	switch status {
	case SyncRunStatusRunning, SyncRunStatusCompleted, SyncRunStatusPartial, SyncRunStatusFailed, SyncRunStatusCancelled:
		return true
	default:
		return false
	}
}

func SyncRunTerminal(status string) bool {
	switch status {
	case SyncRunStatusCompleted, SyncRunStatusPartial, SyncRunStatusFailed, SyncRunStatusCancelled:
		return true
	default:
		return false
	}
}
