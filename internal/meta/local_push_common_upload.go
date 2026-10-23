package meta

import "time"

const (
	LocalPushCommonUploadReserved  = "reserved"
	LocalPushCommonUploadBound     = "bound"
	LocalPushCommonUploadCommitted = "committed"
)

// LocalPushCommonUploadOperation stores the immutable original file result
// independently of the generic 24-hour UploadSession and current mutable
// Node. Server-only admission must enforce owning Device/Root/Source; these
// identities are not an authorization credential on their own.
type LocalPushCommonUploadOperation struct {
	OperationID        string     `gorm:"size:36;primaryKey" json:"-"`
	OwnerID            uint64     `gorm:"not null;index" json:"-"`
	OwnerSession       uint64     `gorm:"not null" json:"-"`
	DeviceID           string     `gorm:"size:36;not null" json:"-"`
	RootID             string     `gorm:"size:36;not null" json:"-"`
	RootFingerprint    string     `gorm:"size:64;not null" json:"-"`
	SourceID           uint64     `gorm:"not null;index" json:"-"`
	SourceRevision     uint64     `gorm:"not null" json:"-"`
	SourceTargetID     uint64     `gorm:"not null" json:"-"`
	ResumeKey          string     `gorm:"size:68;not null;uniqueIndex:idx_xd_local_common_upload_resume" json:"-"`
	UploadSessionID    *string    `gorm:"size:36;uniqueIndex:idx_xd_local_common_upload_session" json:"-"`
	TargetParentID     *uint64    `json:"-"`
	TargetNodeID       *uint64    `json:"-"`
	ExpectedRevision   uint64     `gorm:"not null" json:"-"`
	TargetName         string     `gorm:"size:255" json:"-"`
	ContentSHA256      string     `gorm:"size:64;not null" json:"-"`
	TotalSize          int64      `gorm:"not null" json:"-"`
	State              string     `gorm:"size:16;not null;index" json:"-"`
	ResultNodeID       *uint64    `json:"-"`
	ResultNodeRevision uint64     `gorm:"not null;default:0" json:"-"`
	CommittedAt        *time.Time `json:"-"`
	CreatedAt          time.Time  `json:"-"`
	UpdatedAt          time.Time  `json:"-"`
}

func (LocalPushCommonUploadOperation) TableName() string {
	return "xd_local_push_common_upload_operations"
}
