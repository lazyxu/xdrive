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
	NodeID       uint64 `gorm:"primaryKey"`
	OwnerID      uint64 `gorm:"not null;index;index:idx_xd_media_owner_kind_time,priority:1"`
	NodeRevision uint64 `gorm:"not null;default:0"`
	SHA256       string `gorm:"size:64;index"`
	MediaKind    string `gorm:"size:16;not null;default:other;index;index:idx_xd_media_owner_kind_time,priority:2"`
	MIMEType     string `gorm:"size:128;index"`

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
