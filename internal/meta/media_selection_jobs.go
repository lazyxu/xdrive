package meta

import "time"

// MediaSelectionJob persists a frozen, owner-scoped set of Node revisions.
// Jobs never contain original bytes or a 100k-element JSON field.
type MediaSelectionJob struct {
	ID                string     `gorm:"size:36;primaryKey" json:"id"`
	OwnerID           uint64     `gorm:"not null;index:idx_xd_media_jobs_owner_created" json:"-"`
	Action            string     `gorm:"size:24;not null" json:"action"`
	Favorite          bool       `gorm:"not null;default:false" json:"favorite"`
	Status            string     `gorm:"size:24;not null;index:idx_xd_media_jobs_status_created" json:"status"`
	RetryOfID         string     `gorm:"size:36" json:"retry_of_id,omitempty"`
	TotalItems        int64      `gorm:"not null" json:"total_items"`
	ProcessedItems    int64      `gorm:"not null;default:0" json:"processed_items"`
	SucceededItems    int64      `gorm:"not null;default:0" json:"succeeded_items"`
	FailedItems       int64      `gorm:"not null;default:0" json:"failed_items"`
	CancelledItems    int64      `gorm:"not null;default:0" json:"cancelled_items"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	FinishedAt        *time.Time `json:"finished_at,omitempty"`
	CreatedAt         time.Time  `gorm:"index:idx_xd_media_jobs_owner_created;index:idx_xd_media_jobs_status_created" json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (MediaSelectionJob) TableName() string { return "xd_media_selection_jobs" }

// MediaSelectionJobItem is a durable per-item outcome, never a client-side
// selection cache. A retry creates a distinct job and preserves old evidence.
type MediaSelectionJobItem struct {
	ID          uint64    `gorm:"primaryKey" json:"-"`
	JobID       string    `gorm:"size:36;not null;uniqueIndex:idx_xd_media_job_node,priority:1;index:idx_xd_media_job_state,priority:1" json:"-"`
	OwnerID     uint64    `gorm:"not null;index" json:"-"`
	NodeID      uint64    `gorm:"not null;uniqueIndex:idx_xd_media_job_node,priority:2" json:"node_id"`
	Revision    uint64    `gorm:"not null" json:"revision"`
	Status      string    `gorm:"size:24;not null;index:idx_xd_media_job_state,priority:2" json:"status"`
	FailureCode string    `gorm:"size:48" json:"failure_code,omitempty"`
	CreatedAt   time.Time `json:"-"`
	UpdatedAt   time.Time `json:"-"`

	Job MediaSelectionJob `gorm:"foreignKey:JobID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (MediaSelectionJobItem) TableName() string { return "xd_media_selection_job_items" }
