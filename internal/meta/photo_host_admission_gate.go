package meta

import "time"

// PhotoHostAdmissionGate is a deliberately non-operational shared-maintenance
// intent until all Photo Intelligence and Creative entry points are fenced.
// An absent row allows legacy work; it is NEVER a safe-to-stop signal.
type PhotoHostAdmissionGate struct {
	Name      string    `gorm:"size:64;primaryKey"`
	Revision  uint64    `gorm:"not null"`
	Frozen    bool      `gorm:"not null;default:false"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (PhotoHostAdmissionGate) TableName() string {
	return "xd_photo_host_admission_gates"
}
