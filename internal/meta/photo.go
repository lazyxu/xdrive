package meta

import "time"

const (
	PhotoAssetKindImage     = MediaKindImage
	PhotoAssetKindVideo     = MediaKindVideo
	PhotoAssetKindLivePhoto = MediaGroupKindLivePhoto
	PhotoAssetKindRAWPair   = MediaGroupKindRAWPair
	PhotoAssetKindSidecar   = MediaGroupKindSidecar
	PhotoAssetKindBurst     = MediaGroupKindBurst

	PhotoResourceKindNode    = "node"
	PhotoResourceKindDerived = "derived"

	PhotoResourceRolePrimary   = "primary"
	PhotoResourceRoleContainer = MediaGroupRoleContainer

	PhotoCollectionKindFolder = "folder"
	PhotoCollectionKindSource = "source"
	PhotoCollectionKindManual = "manual"
	PhotoCollectionKindSmart  = "smart"

	PhotoCollectionStateActive  = "active"
	PhotoCollectionStateMissing = "missing"
)

type PhotoAsset struct {
	ID            uint64 `gorm:"primaryKey"`
	OwnerID       uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_assets_owner_evidence,priority:1;uniqueIndex:idx_xd_photo_assets_owner_primary,priority:1"`
	PrimaryNodeID uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_assets_owner_primary,priority:2"`
	Kind          string `gorm:"size:32;not null;index"`
	EvidenceKey   string `gorm:"size:512;not null;uniqueIndex:idx_xd_photo_assets_owner_evidence,priority:2"`
	CreatedAt     time.Time
	UpdatedAt     time.Time

	Owner       User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	PrimaryNode Node `gorm:"foreignKey:PrimaryNodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoAsset) TableName() string { return "xd_photo_assets" }

type PhotoResource struct {
	ID           uint64 `gorm:"primaryKey"`
	AssetID      uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_resources_asset_kind_node_role,priority:1"`
	ResourceKind string `gorm:"size:16;not null;index;uniqueIndex:idx_xd_photo_resources_asset_kind_node_role,priority:2"`
	NodeID       uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_resources_asset_kind_node_role,priority:3"`
	Role         string `gorm:"size:32;not null;index;uniqueIndex:idx_xd_photo_resources_asset_kind_node_role,priority:4"`
	Ordinal      int    `gorm:"not null;default:0;index"`
	Name         string `gorm:"size:512;not null"`
	MediaKind    string `gorm:"size:16;not null;index"`
	MIMEType     string `gorm:"size:128"`
	Size         int64  `gorm:"not null;default:0"`
	SHA256       string `gorm:"size:64;index"`
	ByteOffset   int64  `gorm:"not null;default:0"`
	CreatedAt    time.Time
	UpdatedAt    time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Node  Node       `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoResource) TableName() string { return "xd_photo_resources" }

type PhotoMetadata struct {
	AssetID     uint64     `gorm:"primaryKey"`
	MediaKind   string     `gorm:"size:16;not null;index"`
	MIMEType    string     `gorm:"size:128;index"`
	Width       int        `gorm:"not null;default:0"`
	Height      int        `gorm:"not null;default:0"`
	DurationMS  int64      `gorm:"not null;default:0"`
	CapturedAt  *time.Time `gorm:"index"`
	Latitude    *float64
	Longitude   *float64
	AltitudeM   *float64
	Favorite    bool   `gorm:"not null;default:false;index"`
	Description string `gorm:"type:text"`
	EXIFJSON    string `gorm:"type:text"`
	VideoJSON   string `gorm:"type:text"`
	TagsJSON    string `gorm:"type:text"`
	PeopleJSON  string `gorm:"type:text"`
	VendorJSON  string `gorm:"type:text"`
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoMetadata) TableName() string { return "xd_photo_metadata" }

type PhotoCollection struct {
	ID          uint64 `gorm:"primaryKey"`
	OwnerID     uint64 `gorm:"not null;index;uniqueIndex:idx_xd_photo_collections_owner_key,priority:1"`
	ExternalKey string `gorm:"size:512;not null;uniqueIndex:idx_xd_photo_collections_owner_key,priority:2"`
	Kind        string `gorm:"size:32;not null;index"`
	Name        string `gorm:"size:512;not null"`
	State       string `gorm:"size:16;not null;default:active;index"`
	Revision    uint64 `gorm:"not null;default:1"`
	QueryJSON   string `gorm:"type:text"`
	CreatedAt   time.Time
	UpdatedAt   time.Time

	Owner User `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoCollection) TableName() string { return "xd_photo_collections" }

type PhotoCollectionAsset struct {
	CollectionID uint64 `gorm:"primaryKey;autoIncrement:false;index;uniqueIndex:idx_xd_photo_collection_assets_collection_position,priority:1"`
	AssetID      uint64 `gorm:"primaryKey;autoIncrement:false;index"`
	Position     int64  `gorm:"not null;default:0;uniqueIndex:idx_xd_photo_collection_assets_collection_position,priority:2"`
	CreatedAt    time.Time
	UpdatedAt    time.Time

	Collection PhotoCollection `gorm:"foreignKey:CollectionID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Asset      PhotoAsset      `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (PhotoCollectionAsset) TableName() string { return "xd_photo_collection_assets" }

func ValidPhotoAssetKind(kind string) bool {
	switch kind {
	case PhotoAssetKindImage, PhotoAssetKindVideo, PhotoAssetKindLivePhoto,
		PhotoAssetKindRAWPair, PhotoAssetKindSidecar, PhotoAssetKindBurst:
		return true
	default:
		return false
	}
}

func ValidPhotoResourceKind(kind string) bool {
	return kind == PhotoResourceKindNode || kind == PhotoResourceKindDerived
}

func ValidPhotoCollectionKind(kind string) bool {
	switch kind {
	case PhotoCollectionKindFolder, PhotoCollectionKindSource,
		PhotoCollectionKindManual, PhotoCollectionKindSmart:
		return true
	default:
		return false
	}
}

func ValidPhotoCollectionState(state string) bool {
	return state == PhotoCollectionStateActive || state == PhotoCollectionStateMissing
}
