package meta

import "time"

// AdminCaddyHostApplyReservation is a single durable, sticky DB-side
// *unapplied* operation fence. It is NOT an operator approval, Host Manager
// command, deployment state or applied receipt.
type AdminCaddyHostApplyReservation struct {
	Name                       string    `gorm:"size:48;primaryKey"`
	HTTPSRevision              uint64    `gorm:"not null"`
	CredentialRevision         uint64    `gorm:"not null"`
	OperationSHA256            string    `gorm:"size:64;not null"`
	NonceSHA256                string    `gorm:"size:64;not null"`
	IntentSHA256               string    `gorm:"size:64;not null"`
	PlanSHA256                 string    `gorm:"size:64;not null"`
	CandidateEnvironmentSHA256 string    `gorm:"size:64;not null"`
	State                      string    `gorm:"size:32;not null"`
	CreatedAt                  time.Time `gorm:"not null"`
}

func (AdminCaddyHostApplyReservation) TableName() string {
	return "xd_admin_caddy_host_apply_reservations"
}
