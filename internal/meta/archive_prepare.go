package meta

import "time"

const (
	ArchivePrepareStatusQueued          = "queued"
	ArchivePrepareStatusRunning         = "running"
	ArchivePrepareStatusCancelRequested = "cancel_requested"
	ArchivePrepareStatusCancelled       = "cancelled"
	ArchivePrepareStatusCompleted       = "completed"
	ArchivePrepareStatusFailed          = "failed"
)

type ArchivePrepareRun struct {
	ID                string     `gorm:"size:36;primaryKey"`
	OwnerID           uint64     `gorm:"not null;index;index:idx_xd_archive_prepare_owner_created"`
	RequestedIDsJSON  string     `gorm:"type:text;not null"`
	Status            string     `gorm:"size:24;not null;index"`
	Filename          string     `gorm:"size:255"`
	TotalBytes        int64      `gorm:"not null;default:0"`
	ManifestJSON      string     `gorm:"type:text"`
	Error             string     `gorm:"type:text"`
	CancelRequestedAt *time.Time `gorm:"index"`
	StartedAt         *time.Time `gorm:"index"`
	FinishedAt        *time.Time `gorm:"index"`
	ExpiresAt         time.Time  `gorm:"not null;index"`
	CreatedAt         time.Time  `gorm:"not null;index;index:idx_xd_archive_prepare_owner_created"`
	UpdatedAt         time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (ArchivePrepareRun) TableName() string { return "xd_archive_prepare_runs" }

func ArchivePrepareTerminal(status string) bool {
	switch status {
	case ArchivePrepareStatusCancelled, ArchivePrepareStatusCompleted, ArchivePrepareStatusFailed:
		return true
	default:
		return false
	}
}
