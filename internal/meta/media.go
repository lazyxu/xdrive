package meta

import "time"

const (
	MediaKindImage = "image"
	MediaKindVideo = "video"
	MediaKindOther = "other"

	MediaIndexStateReady       = "ready"
	MediaIndexStateUnsupported = "unsupported"
	MediaIndexStateError       = "error"
)

// MediaMetadata is the canonical, connector-neutral media index for an xDrive
// file node. Source metadata may be used as a hint by future indexers, but is
// never required for a file to participate in Gallery.
type MediaMetadata struct {
	NodeID                   uint64 `gorm:"primaryKey"`
	OwnerID                  uint64 `gorm:"not null;index;index:idx_xd_media_owner_kind_time,priority:1;index:idx_xd_media_owner_live_asset,priority:1"`
	NodeRevision             uint64 `gorm:"not null;default:0"`
	SHA256                   string `gorm:"size:64;index"`
	MediaKind                string `gorm:"size:16;not null;default:other;index;index:idx_xd_media_owner_kind_time,priority:2"`
	MIMEType                 string `gorm:"size:128;index"`
	ContainerKind            string `gorm:"size:32;not null;default:'';index"`
	ContainerJSON            string `gorm:"type:text"`
	LivePhotoAssetIdentifier string `gorm:"size:128;index;index:idx_xd_media_owner_live_asset,priority:2"`
	DerivedResourceVersion   int    `gorm:"not null;default:0"`

	Width       int `gorm:"not null;default:0"`
	Height      int `gorm:"not null;default:0"`
	Orientation int `gorm:"not null;default:1"`

	RotationDegrees int     `gorm:"not null;default:0"`
	DurationMS      int64   `gorm:"not null;default:0"`
	FrameRate       float64 `gorm:"not null;default:0"`
	BitRate         int64   `gorm:"not null;default:0"`
	VideoCodec      string  `gorm:"size:64"`
	AudioCodec      string  `gorm:"size:64"`

	CapturedAt *time.Time `gorm:"index;index:idx_xd_media_owner_kind_time,priority:3"`
	Latitude   *float64
	Longitude  *float64
	AltitudeM  *float64

	CameraMake  string `gorm:"size:255"`
	CameraModel string `gorm:"size:255"`
	LensModel   string `gorm:"size:255"`

	EXIFJSON  string `gorm:"type:text"`
	VideoJSON string `gorm:"type:text"`

	ThumbnailKey      string `gorm:"size:1024"`
	ThumbnailMIMEType string `gorm:"size:128"`
	ThumbnailWidth    int    `gorm:"not null;default:0"`
	ThumbnailHeight   int    `gorm:"not null;default:0"`

	IndexState string `gorm:"size:16;not null;default:ready;index"`
	IndexError string `gorm:"type:text"`

	CreatedAt time.Time
	UpdatedAt time.Time

	Node Node `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (MediaMetadata) TableName() string { return "xd_media_metadata" }

func ValidMediaKind(kind string) bool {
	switch kind {
	case MediaKindImage, MediaKindVideo, MediaKindOther:
		return true
	default:
		return false
	}
}

func ValidMediaIndexState(state string) bool {
	switch state {
	case MediaIndexStateReady, MediaIndexStateUnsupported, MediaIndexStateError:
		return true
	default:
		return false
	}
}

// MediaDerivedResource is a read-only byte-range view derived from one original
// xDrive Node. It never owns content, creates a Node, or participates in Source
// identity. NodeRevision+SHA256 bind the range to the exact parent bytes.
type MediaDerivedResource struct {
	NodeID          uint64 `gorm:"primaryKey;autoIncrement:false;index"`
	Role            string `gorm:"primaryKey;size:32;autoIncrement:false"`
	OwnerID         uint64 `gorm:"not null;index"`
	NodeRevision    uint64 `gorm:"not null;default:0"`
	SHA256          string `gorm:"size:64;index"`
	Name            string `gorm:"size:512;not null"`
	MediaKind       string `gorm:"size:16;not null;index"`
	MIMEType        string `gorm:"size:128;not null"`
	ByteOffset      int64  `gorm:"not null"`
	ByteSize        int64  `gorm:"not null"`
	AssetIdentifier string `gorm:"size:128;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time

	Node Node `gorm:"foreignKey:NodeID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;"`
}

func (MediaDerivedResource) TableName() string { return "xd_media_derived_resources" }

const (
	MediaDerivedResourceRoleStill  = "still"
	MediaDerivedResourceRoleMotion = "motion"
)

func ValidMediaDerivedResourceRole(role string) bool {
	switch role {
	case MediaDerivedResourceRoleStill, MediaDerivedResourceRoleMotion:
		return true
	default:
		return false
	}
}
