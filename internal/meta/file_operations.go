package meta

import "time"

const (
	FileOperationTypeCopy   = "copy"
	FileOperationTypeMove   = "move"
	FileOperationTypeDelete = "delete"
	FileOperationTypeUndo   = "undo"
	FileOperationTypeRedo   = "redo"

	FileOperationStatusQueued          = "queued"
	FileOperationStatusRunning         = "running"
	FileOperationStatusCancelRequested = "cancel_requested"
	FileOperationStatusCancelled       = "cancelled"
	FileOperationStatusCompleted       = "completed"
	FileOperationStatusFailed          = "failed"

	FileOperationConflictPolicyFail     = "fail"
	FileOperationConflictPolicySkip     = "skip"
	FileOperationConflictPolicyKeepBoth = "keep_both"
	FileOperationConflictPolicyReplace  = "replace"
)

type FileOperation struct {
	ID                string     `gorm:"size:36;primaryKey"`
	OwnerID           uint64     `gorm:"not null;index;index:idx_xd_file_operations_owner_created"`
	Type              string     `gorm:"size:16;not null;index"`
	Status            string     `gorm:"size:24;not null;default:queued;index"`
	ParentID          *uint64    `gorm:"index"`
	RetryOfID         *string    `gorm:"size:36;index"`
	UndoOfID          *string    `gorm:"size:36;index"`
	UndoneByID        *string    `gorm:"size:36;index"`
	RedoOfID          *string    `gorm:"size:36;index"`
	RedoneByID        *string    `gorm:"size:36;index"`
	ConflictPolicy    string     `gorm:"size:16;not null;default:''"`
	ItemsJSON         string     `gorm:"type:text;not null"`
	UndoPlanJSON      string     `gorm:"type:text;not null;default:''"`
	RedoPlanJSON      string     `gorm:"type:text;not null;default:''"`
	TotalItems        int64      `gorm:"not null;default:0"`
	ProcessedItems    int64      `gorm:"not null;default:0"`
	TotalBytes        int64      `gorm:"not null;default:0"`
	ProcessedBytes    int64      `gorm:"not null;default:0"`
	CurrentItem       string     `gorm:"size:255"`
	FailedItemID      uint64     `gorm:"not null;default:0"`
	FailureCode       string     `gorm:"size:64;index"`
	Error             string     `gorm:"type:text"`
	CancelRequestedAt *time.Time `gorm:"index"`
	StartedAt         *time.Time `gorm:"index"`
	FinishedAt        *time.Time `gorm:"index"`
	CreatedAt         time.Time  `gorm:"not null;index;index:idx_xd_file_operations_owner_created"`
	UpdatedAt         time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (FileOperation) TableName() string { return "xd_file_operations" }

func ValidFileOperationType(value string) bool {
	switch value {
	case FileOperationTypeCopy, FileOperationTypeMove, FileOperationTypeDelete, FileOperationTypeUndo, FileOperationTypeRedo:
		return true
	default:
		return false
	}
}

func FileOperationTerminal(status string) bool {
	switch status {
	case FileOperationStatusCancelled, FileOperationStatusCompleted, FileOperationStatusFailed:
		return true
	default:
		return false
	}
}

func DefaultFileOperationConflictPolicy(operationType string) string {
	return FileOperationConflictPolicyFail
}

func ValidFileOperationConflictPolicy(value string) bool {
	switch value {
	case FileOperationConflictPolicyFail, FileOperationConflictPolicySkip, FileOperationConflictPolicyKeepBoth, FileOperationConflictPolicyReplace:
		return true
	default:
		return false
	}
}

func NormalizeFileOperationConflictPolicy(operationType, value string) (string, bool) {
	if !ValidFileOperationType(operationType) {
		return "", false
	}
	if value == "" {
		value = DefaultFileOperationConflictPolicy(operationType)
	}
	if !ValidFileOperationConflictPolicy(value) {
		return "", false
	}
	if (operationType == FileOperationTypeDelete || operationType == FileOperationTypeUndo || operationType == FileOperationTypeRedo) && value != FileOperationConflictPolicyFail {
		return "", false
	}
	return value, true
}
