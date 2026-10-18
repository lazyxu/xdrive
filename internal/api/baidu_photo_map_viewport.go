package api

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A3: BD-09 map bounds are NOT original WGS84 photo bounds. This is an
// internal, owner-scoped derived-coordinate query only; it has no HTTP route,
// never receives an untrusted BMap.getBounds() as a claimed WGS84 range, and
// cannot be used to fetch media bytes outside existing Gallery authorization.
const (
	baiduPhotoMapViewportMaxLimit  = 100
	baiduPhotoMapViewportMaxOffset = 10_000_000
	baiduPhotoMapQueryTimeout      = 3 * time.Second
)

type baiduPhotoMapBounds struct {
	West, South, East, North float64
	CoordinateSpace          string
}

func (b baiduPhotoMapBounds) valid() bool {
	if _, ok := meta.BaiduPhotoMapProjectionForSpace(b.CoordinateSpace); !ok {
		return false
	}
	for _, value := range []float64{b.West, b.South, b.East, b.North} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return b.West >= -180 && b.West <= 180 &&
		b.East >= -180 && b.East <= 180 &&
		b.South >= -90 && b.North <= 90 &&
		b.South < b.North && b.West != b.East &&
		!(b.West == 180 && b.East == -180)
}

type baiduPhotoMapPoint struct {
	// Only the derived BD-09 point, no original WGS84/GPS provenance.
	AssetID   uint64  `json:"asset_id"`
	NodeID    uint64  `json:"node_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type baiduPhotoMapPage struct {
	Items      []baiduPhotoMapPoint
	TotalCount int64
	Offset     int
	Limit      int
	HasMore    bool
}

// queryBaiduPhotoMapViewport returns only CURRENT, OWNER-VALIDATED positions.
// Every persisted point is version-fenced at read time against the real
// PhotoAsset, live Node and complete original WGS84 GPS from the shared
// MediaMetadata index. Stale points cannot reappear after GPS edits, deletion,
// owner changes or indexing revisions; a later cleanup worker may delete them.
// A paged window never masquerades as an exhaustive cluster view.
func queryBaiduPhotoMapViewport(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds baiduPhotoMapBounds, limit, offset int,
) (baiduPhotoMapPage, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		!bounds.valid() || limit < 1 || limit > baiduPhotoMapViewportMaxLimit ||
		offset < 0 || offset > baiduPhotoMapViewportMaxOffset {
		return baiduPhotoMapPage{}, fmt.Errorf("invalid baidu photo map viewport")
	}
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(bounds.CoordinateSpace)
	if !ok {
		return baiduPhotoMapPage{}, fmt.Errorf("invalid map coordinate space")
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduPhotoMapQueryTimeout)
	defer cancel()
	query := db.WithContext(readCtx).
		Table("xd_baidu_photo_map_positions AS p").
		Joins("JOIN xd_users AS u ON u.id = p.owner_id AND u.disabled_at IS NULL AND u.must_change_password = FALSE").
		Joins("JOIN xd_photo_assets AS pa ON pa.id = p.asset_id AND pa.owner_id = p.owner_id AND pa.primary_node_id = p.primary_node_id").
		Joins("JOIN xd_baidu_photo_map_consents AS c ON c.asset_id = p.asset_id AND c.owner_id = p.owner_id AND c.revision = p.consent_revision AND c.revision > 0 AND c.allow_index = TRUE AND c.allow_baidu_conversion = TRUE AND c.revoked_at IS NULL AND c.expires_at > clock_timestamp() AND c.source_node_id = p.primary_node_id AND c.source_node_revision = p.node_revision AND c.source_media_updated_at = p.media_updated_at AND c.source_latitude = p.source_latitude AND c.source_longitude = p.source_longitude").
		Joins("JOIN xd_nodes AS n ON n.id = p.primary_node_id AND n.owner_id = p.owner_id AND n.deleted_at IS NULL AND n.revision = p.node_revision AND n.type = ?", meta.NodeTypeFile).
		Joins("JOIN xd_media_metadata AS m ON m.node_id = n.id AND m.owner_id = p.owner_id AND m.node_revision = n.revision AND m.updated_at = p.media_updated_at").
		Where(
			"p.owner_id = ? AND p.coordinate_space = ? AND p.projection_version = ? AND "+
				"m.index_state = ? AND m.media_kind IN ? AND "+
				"m.latitude BETWEEN -90 AND 90 AND m.longitude BETWEEN -180 AND 180 AND "+
				"p.source_latitude = m.latitude AND p.source_longitude = m.longitude AND "+
				"p.latitude BETWEEN -90 AND 90 AND p.longitude BETWEEN -180 AND 180 AND "+
				"p.latitude >= ? AND p.latitude <= ?",
			ownerID, bounds.CoordinateSpace, projection,
			meta.MediaIndexStateReady, []string{meta.MediaKindImage, meta.MediaKindVideo},
			bounds.South, bounds.North,
		)
	if bounds.West < bounds.East {
		query = query.Where("p.longitude >= ? AND p.longitude <= ?", bounds.West, bounds.East)
	} else {
		query = query.Where("(p.longitude >= ? OR p.longitude <= ?)", bounds.West, bounds.East)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return baiduPhotoMapPage{}, fmt.Errorf("baidu map viewport count unavailable")
	}
	if err := readCtx.Err(); err != nil {
		return baiduPhotoMapPage{}, fmt.Errorf("baidu map viewport cancelled")
	}
	var items []baiduPhotoMapPoint
	if err := query.Select("p.asset_id AS asset_id, p.primary_node_id AS node_id, p.latitude AS latitude, p.longitude AS longitude").
		Order("p.asset_id ASC").Limit(limit).Offset(offset).Scan(&items).Error; err != nil {
		return baiduPhotoMapPage{}, fmt.Errorf("baidu map viewport page unavailable")
	}
	if items == nil {
		items = []baiduPhotoMapPoint{}
	}
	return baiduPhotoMapPage{
		Items: items, TotalCount: total,
		Offset: offset, Limit: limit, HasMore: total > int64(offset)+int64(len(items)),
	}, nil
}
