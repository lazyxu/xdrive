package meta

import "time"

// DownloadProgress is a short-lived observation of native HTTP response writes,
// not a durable background task or proof that a browser saved a file.
type DownloadProgress struct {
	ID             string    `gorm:"size:36;primaryKey"`
	OwnerID        uint64    `gorm:"not null;index"`
	SessionVersion uint64    `gorm:"not null"`
	ResourceKind   string    `gorm:"size:16;not null"`
	State          string    `gorm:"size:16;not null"`
	BytesSent      int64     `gorm:"not null;default:0"`
	BytesTotal     int64     `gorm:"not null;default:0"`
	ActiveRequests int64     `gorm:"not null;default:0"`
	RunID          string    `gorm:"size:36"`
	RequestReports string    `gorm:"type:jsonb;not null;default:'{}'"`
	FailureState   string    `gorm:"size:16"`
	Error          string    `gorm:"type:text"`
	UpdatedAt      time.Time `gorm:"not null"`
	ExpiresAt      time.Time `gorm:"not null;index"`

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (DownloadProgress) TableName() string { return "xd_download_progress" }
