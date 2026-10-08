package meta

import "time"

const (
	DownloadTransferStatusQueued    = "queued"
	DownloadTransferStatusRunning   = "running"
	DownloadTransferStatusCompleted = "completed"
	DownloadTransferStatusCancelled = "cancelled"
	DownloadTransferStatusFailed    = "failed"
)

type DownloadTransfer struct {
	ID           string     `gorm:"size:36;primaryKey" json:"id"`
	OwnerID      uint64     `gorm:"not null;index:idx_xd_download_transfers_owner_updated,priority:1" json:"owner_id"`
	ResourceKind string     `gorm:"size:32;not null" json:"resource_kind"`
	ResourceID   string     `gorm:"size:160;not null" json:"resource_id"`
	FileName     string     `gorm:"size:255;not null" json:"file_name"`
	BytesTotal   int64      `gorm:"not null;default:0" json:"bytes_total"`
	BytesSent    int64      `gorm:"not null;default:0" json:"bytes_sent"`
	Status       string     `gorm:"size:32;not null;index" json:"status"`
	Error        string     `gorm:"type:text" json:"error,omitempty"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	ExpiresAt    time.Time  `gorm:"not null;index" json:"expires_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `gorm:"index:idx_xd_download_transfers_owner_updated,priority:2" json:"updated_at"`
}

func (DownloadTransfer) TableName() string {
	return "xd_download_transfers"
}
