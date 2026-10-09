package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This is coverage of *known, active logical PhotoAssets*, not evidence that
// every file has been examined. The current indexer may still discover assets.
type mediaGalleryIndexStatusDTO struct {
	KnownAssets           int64     `json:"known_assets"`
	ReadyAssets           int64     `json:"ready_assets"`
	FailedAssets          int64     `json:"failed_assets"`
	UnsupportedAssets     int64     `json:"unsupported_assets"`
	MissingMetadataAssets int64     `json:"missing_metadata_assets"`
	OtherUnreadyAssets    int64     `json:"other_unready_assets"`
	Scope                 string    `json:"scope"`
	CheckedAt             time.Time `json:"checked_at"`
}

func (s *Server) queryMediaGalleryIndexStatus(
	ctx context.Context,
	ownerID uint64,
) (mediaGalleryIndexStatusDTO, error) {
	type row struct {
		KnownAssets           int64 `gorm:"column:known_assets"`
		ReadyAssets           int64 `gorm:"column:ready_assets"`
		FailedAssets          int64 `gorm:"column:failed_assets"`
		UnsupportedAssets     int64 `gorm:"column:unsupported_assets"`
		MissingMetadataAssets int64 `gorm:"column:missing_metadata_assets"`
		OtherUnreadyAssets    int64 `gorm:"column:other_unready_assets"`
	}
	var summary row
	err := s.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
		Select(
			"COUNT(*) AS known_assets, "+
				"COALESCE(SUM(CASE WHEN mm.index_state = ? THEN 1 ELSE 0 END), 0) AS ready_assets, "+
				"COALESCE(SUM(CASE WHEN mm.index_state = ? THEN 1 ELSE 0 END), 0) AS failed_assets, "+
				"COALESCE(SUM(CASE WHEN mm.index_state = ? THEN 1 ELSE 0 END), 0) AS unsupported_assets, "+
				"COALESCE(SUM(CASE WHEN mm.node_id IS NULL THEN 1 ELSE 0 END), 0) AS missing_metadata_assets, "+
				"COALESCE(SUM(CASE WHEN mm.index_state NOT IN (?, ?, ?) THEN 1 ELSE 0 END), 0) AS other_unready_assets",
			meta.MediaIndexStateReady, meta.MediaIndexStateError,
			meta.MediaIndexStateUnsupported,
			meta.MediaIndexStateReady, meta.MediaIndexStateError,
			meta.MediaIndexStateUnsupported,
		).
		Joins("JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.owner_id = pa.owner_id AND n.deleted_at IS NULL").
		Joins("LEFT JOIN xd_media_metadata AS mm ON mm.node_id = pa.primary_node_id AND mm.owner_id = pa.owner_id").
		Where("pa.owner_id = ?", ownerID).
		Scan(&summary).Error
	if err != nil {
		return mediaGalleryIndexStatusDTO{}, err
	}
	return mediaGalleryIndexStatusDTO{
		KnownAssets:           summary.KnownAssets,
		ReadyAssets:           summary.ReadyAssets,
		FailedAssets:          summary.FailedAssets,
		UnsupportedAssets:     summary.UnsupportedAssets,
		MissingMetadataAssets: summary.MissingMetadataAssets,
		OtherUnreadyAssets:    summary.OtherUnreadyAssets,
		Scope:                 "known_photo_assets",
		CheckedAt:             time.Now().UTC(),
	}, nil
}

// Explicit opt-in only: never put this aggregation on the first-image path.
func (s *Server) listMediaIndexStatus(c *gin.Context) {
	status, err := s.queryMediaGalleryIndexStatus(c.Request.Context(), userID(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, "query media index status failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, status)
}
