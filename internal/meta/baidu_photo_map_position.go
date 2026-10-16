package meta

import "time"

// BaiduPhotoMapPosition is a derived, disposable spatial INDEX for a single
// current logical PhotoAsset. It never overrides its original WGS84 GPS and
// does not own any media bytes. No production writer exists in this phase.
//
// Read-time joins MUST verify OwnerID, PrimaryNodeID, NodeRevision,
// MediaUpdatedAt and both original GPS coordinates against the current
// xd_photo_assets / xd_nodes / xd_media_metadata rows. When GPS is removed,
// edited, the primary node changes, an asset is deleted, or a source index
// becomes stale, the derived point must become invisible immediately.
// A future writer must also obey the Owner's map/privacy and retention policy.
const (
	BaiduPhotoMapSpaceBD09LL  = "bd09ll"
	BaiduPhotoMapSpaceWGS84LL = "wgs84ll"

	BaiduPhotoMapProjectionGeoconvV2 = "geoconv-v2-model2"
	BaiduPhotoMapProjectionNativeGPS = "native-wgs84-v1"
)

func BaiduPhotoMapProjectionForSpace(space string) (string, bool) {
	switch space {
	case BaiduPhotoMapSpaceBD09LL:
		return BaiduPhotoMapProjectionGeoconvV2, true
	case BaiduPhotoMapSpaceWGS84LL:
		return BaiduPhotoMapProjectionNativeGPS, true
	default:
		return "", false
	}
}

type BaiduPhotoMapPosition struct {
	AssetID           uint64    `gorm:"primaryKey;autoIncrement:false"`
	OwnerID           uint64    `gorm:"not null;index:idx_xd_baidu_photo_positions_owner_space_lat_lon,priority:1"`
	PrimaryNodeID     uint64    `gorm:"not null"`
	NodeRevision      uint64    `gorm:"not null"`
	MediaUpdatedAt    time.Time `gorm:"not null"`
	SourceLatitude    float64   `gorm:"not null"`
	SourceLongitude   float64   `gorm:"not null"`
	CoordinateSpace   string    `gorm:"size:16;not null;index:idx_xd_baidu_photo_positions_owner_space_lat_lon,priority:2"`
	ProjectionVersion string    `gorm:"size:32;not null"`
	Latitude          float64   `gorm:"not null;index:idx_xd_baidu_photo_positions_owner_space_lat_lon,priority:3"`
	Longitude         float64   `gorm:"not null;index:idx_xd_baidu_photo_positions_owner_space_lat_lon,priority:4"`
	CreatedAt         time.Time
	UpdatedAt         time.Time

	Asset PhotoAsset `gorm:"foreignKey:AssetID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
	Owner User       `gorm:"foreignKey:OwnerID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (BaiduPhotoMapPosition) TableName() string { return "xd_baidu_photo_map_positions" }
