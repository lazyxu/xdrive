package meta

import "time"

// IOSPhotoOriginalHold is a permanent, owner-scoped promise that a *physically
// verified* managed original stays available after the user removes their
// iPhone copy. No ordinary API can release or replace it. App-level deletion,
// version replacement, trash cleanup and CAS GC are separately fenced by
// PostgreSQL triggers installed at server migration.
type IOSPhotoOriginalHold struct {
    ID string `gorm:"size:36;primaryKey"`
    OwnerID uint64 `gorm:"not null;index"`
    DeviceID string `gorm:"size:36;not null"`
    SourceID uint64 `gorm:"not null;index"`
    SourceRevision uint64 `gorm:"not null"`
    TargetNodeID uint64 `gorm:"not null"`
    NodeID uint64 `gorm:"not null;uniqueIndex"`
    NodeRevision uint64 `gorm:"not null"`
    SessionID string `gorm:"size:36;not null"`
    Kind string `gorm:"size:8;not null"`
    SHA256 string `gorm:"size:64;not null;index"`
    ByteSize int64 `gorm:"not null"`
    StorageKey string `gorm:"size:1024;not null;index"`
    CreatedAt time.Time `gorm:"not null"`
}

func (IOSPhotoOriginalHold) TableName() string {
    return "xd_ios_photo_original_holds"
}

// An indexed reverse ancestor guard protects the verified original, managed
// target and every ancestor through the Owner root even if a future writer
// bypasses the ordinary Source API. This set is immutable with its Hold.
type IOSPhotoOriginalHoldAncestor struct {
    HoldID string `gorm:"size:36;primaryKey"`
    NodeID uint64 `gorm:"primaryKey;index"`
    OwnerID uint64 `gorm:"not null"`
}

func (IOSPhotoOriginalHoldAncestor) TableName() string {
    return "xd_ios_photo_original_hold_ancestors"
}
