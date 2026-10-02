package meta

import "time"

const (
	FileOperationTypeCopy   = "copy"
	FileOperationTypeMove   = "move"
	FileOperationTypeDelete = "delete"

	FileOperationStatusQueued          = "queued"
	FileOperationStatusRunning         = "running"
	FileOperationStatusCancelRequested = "cancel_requested"
	FileOperationStatusCancelled       = "cancelled"
	FileOperationStatusCompleted       = "completed"
	FileOperationStatusFailed          = "failed"
)

type FileOperation struct {
	ID                string     `gorm:"size:36;primaryKey"`
	OwnerID           uint64     `gorm:"not null;index;index:idx_xd_file_operations_owner_created"`
	Type              string     `gorm:"size:16;not null;index"`
	Status            string     `gorm:"size:24;not null;default:queued;index"`
	ParentID          *uint64    `gorm:"index"`
	RetryOfID         *string    `gorm:"size:36;index"`
	ItemsJSON         string     `gorm:"type:text;not null"`
	TotalItems        int64      `gorm:"not null;default:0"`
	ProcessedItems    int64      `gorm:"not null;default:0"`
	TotalBytes        int64      `gorm:"not null;default:0"`
	ProcessedBytes    int64      `gorm:"not null;default:0"`
	CurrentItem       string     `gorm:"size:255"`
	FailedItemID      uint64     `gorm:"not null;default:0"`
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
	case FileOperationTypeCopy, FileOperationTypeMove, FileOperationTypeDelete:
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
