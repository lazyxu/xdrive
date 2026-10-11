package meta

import "time"

// LocalSourceItemEvidence is a PRIVATE, revision-scoped advisory relation
// between two complete Agent inventory generations and an EXISTING SourceItem.
// It is never consulted by the general Source planner or SourceItemAlias index.
// A caller's native-identity assertion is not independent Server attestation.
type LocalSourceItemEvidence struct {
	ID                     uint64 `gorm:"primaryKey;index:idx_xd_local_ev_page,priority:5"`
	SourceID               uint64 `gorm:"not null;index;uniqueIndex:idx_xd_local_ev_gen_item,priority:1;uniqueIndex:idx_xd_local_ev_gen_path,priority:1;index:idx_xd_local_ev_page,priority:1"`
	SourceRevision         uint64 `gorm:"not null;uniqueIndex:idx_xd_local_ev_gen_item,priority:2;uniqueIndex:idx_xd_local_ev_gen_path,priority:2;index:idx_xd_local_ev_page,priority:2"`
	CurrentSnapshotSHA256  string `gorm:"size:64;not null;uniqueIndex:idx_xd_local_ev_gen_item,priority:3;uniqueIndex:idx_xd_local_ev_gen_path,priority:3;index:idx_xd_local_ev_page,priority:4"`
	SourceItemID           uint64 `gorm:"not null;index;uniqueIndex:idx_xd_local_ev_gen_item,priority:4"`
	CurrentPathKey         string `gorm:"size:64;not null;uniqueIndex:idx_xd_local_ev_gen_path,priority:4"`
	PreviousSnapshotSHA256 string `gorm:"size:64;not null;index:idx_xd_local_ev_page,priority:3"`
	PreviousPathKey        string `gorm:"size:64;not null"`
	NativeIdentityKey      string `gorm:"size:64;not null"`
	DeviceID               string `gorm:"size:36;not null"`
	RootID                 string `gorm:"size:36;not null"`
	RootFingerprint        string `gorm:"size:64;not null"`
	CreatedAt              time.Time
	UpdatedAt              time.Time

	Source     Source     `gorm:"foreignKey:SourceID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	SourceItem SourceItem `gorm:"foreignKey:SourceItemID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (LocalSourceItemEvidence) TableName() string { return "xd_local_source_item_evidence" }
