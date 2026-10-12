package meta

import "time"

// AdminPhotoHostApply is the one global cross-replica authorization gate for
// the fixed photo-intelligence host. It is never a Docker or task record.
// A pending row blocks further desired edits until exact Host Manager evidence
// safely closes the request. The immutable audit keeps authorization history.
type AdminPhotoHostApply struct {
	Name      string    `gorm:"size:48;primaryKey"`
	Revision  uint64    `gorm:"not null"`
	RequestID string    `gorm:"size:24;not null"`
	State     string    `gorm:"size:16;not null"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (AdminPhotoHostApply) TableName() string { return "xd_admin_photo_host_applies" }
