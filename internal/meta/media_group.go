package meta

import "time"

const (
	MediaGroupKindLivePhoto = "live_photo"
	MediaGroupKindRAWPair   = "raw_pair"
	MediaGroupKindSidecar   = "sidecar"
	MediaGroupKindBurst     = "burst"

	MediaGroupRoleStill     = "still"
	MediaGroupRoleMotion    = "motion"
	MediaGroupRoleContainer = "container"
	MediaGroupRolePrimary   = "primary"
	MediaGroupRoleAuxiliary = "auxiliary"
	MediaGroupRoleRAW       = "raw"
	MediaGroupRoleRendered  = "rendered"
	MediaGroupRoleSidecar   = "sidecar"
)

// MediaGroup is a connector-neutral relationship derived only from originals
// already stored in xDrive. EvidenceKey must describe deterministic local
// evidence (for example a validated embedded asset identifier or container
// identity), never a provider/source semantic identity.
type MediaGroup struct {
	ID          uint64 `gorm:"primaryKey"`
	OwnerID     uint64 `gorm:"not null;index;uniqueIndex:idx_xd_media_groups_owner_kind_evidence,priority:1"`
	Kind        string `gorm:"size:32;not null;index;uniqueIndex:idx_xd_media_groups_owner_kind_evidence,priority:2"`
	EvidenceKey string `gorm:"size:512;not null;uniqueIndex:idx_xd_media_groups_owner_kind_evidence,priority:3"`
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (MediaGroup) TableName() string { return "xd_media_groups" }

// MediaGroupItem preserves every original Node independently while projecting a
// logical media relationship above the filesystem/CAS layer.
type MediaGroupItem struct {
	GroupID   uint64 `gorm:"primaryKey;autoIncrement:false;uniqueIndex:idx_xd_media_group_items_group_ordinal,priority:1"`
	NodeID    uint64 `gorm:"primaryKey;autoIncrement:false;index"`
	Role      string `gorm:"size:32;not null;index"`
	Ordinal   int    `gorm:"not null;default:0;uniqueIndex:idx_xd_media_group_items_group_ordinal,priority:2"`
	CreatedAt time.Time
	UpdatedAt time.Time

	Group MediaGroup `gorm:"foreignKey:GroupID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node  Node       `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (MediaGroupItem) TableName() string { return "xd_media_group_items" }

func ValidMediaGroupKind(kind string) bool {
	switch kind {
	case MediaGroupKindLivePhoto, MediaGroupKindRAWPair, MediaGroupKindSidecar, MediaGroupKindBurst:
		return true
	default:
		return false
	}
}
