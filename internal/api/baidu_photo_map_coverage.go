package api

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A privacy-preserving, read-only comparison. Values are logical PhotoAssets,
// not Places grid-cell counts or the 64 representative covers of one viewport.
// The source set is current, indexed-ready, genuinely valid WGS84 provenance;
// BD09 eligibility requires live Owner/source revision fences used by signed
// map Cells and Gallery Range; never per-photo map grants.
type baiduPhotoMapCoverage struct {
	ValidGPSAssets                 int64
	EligibleBD09Assets             int64
	OutsideSourceMapLatitudeAssets int64
}

func queryBaiduPhotoMapCoverage(
	ctx context.Context, db *gorm.DB, ownerID uint64,
) (baiduPhotoMapCoverage, error) {
	empty := baiduPhotoMapCoverage{}
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 {
		return empty, fmt.Errorf("invalid map coverage caller")
	}
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(meta.BaiduPhotoMapSpaceBD09LL)
	if !ok {
		return empty, fmt.Errorf("BD09 projection unavailable")
	}
	readCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var result baiduPhotoMapCoverage
	// Both distinct COUNTs and the camera capability diagnostic belong to ONE
	// consistent database snapshot. Edits, revocation and account changes must
	// not produce a fabricated negative coverage gap between separate reads.
	err := db.WithContext(readCtx).Transaction(func(tx *gorm.DB) error {
		source := func() *gorm.DB {
			return mediaPlacesBaseQuery(readCtx, tx, ownerID).
				Where("n.owner_id = ? AND n.type = ? AND xd_media_metadata.node_revision = n.revision",
					ownerID, meta.NodeTypeFile)
		}
		if err := source().Distinct("pa.id").Count(&result.ValidGPSAssets).Error; err != nil {
			return err
		}
		// This count is diagnostic only. Source WGS84 latitude must never be
		// silently clamped or inverse-transformed to a fake BD09 location.
		if err := source().Where(
			"xd_media_metadata.latitude < ? OR xd_media_metadata.latitude > ?", -85, 85,
		).Distinct("pa.id").Count(&result.OutsideSourceMapLatitudeAssets).Error; err != nil {
			return err
		}
		world := baiduPhotoMapBounds{
			West: -180, South: -85, East: 180, North: 85,
			CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		}
		if err := baiduPhotoMapOwnerEligibleQuery(readCtx, tx, ownerID, world, projection).
			Distinct("p.asset_id").Count(&result.EligibleBD09Assets).Error; err != nil {
			return err
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil || readCtx.Err() != nil ||
		result.ValidGPSAssets < 0 || result.EligibleBD09Assets < 0 ||
		result.EligibleBD09Assets > result.ValidGPSAssets ||
		result.OutsideSourceMapLatitudeAssets < 0 ||
		result.OutsideSourceMapLatitudeAssets > result.ValidGPSAssets {
		return empty, fmt.Errorf("map coverage unavailable")
	}
	return result, nil
}

// No raw WGS84, BD09 position, Node/Asset ID, consent record, Browser AK or
// media URL is returned. This endpoint does not initiate any coordinate
// conversion, change consent, or claim the JSAPI release is enabled.
func (s *Server) listBaiduPhotoMapCoverage(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	if c.Request.URL.RawQuery != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_coverage_request"})
		return
	}
	counts, err := queryBaiduPhotoMapCoverage(c.Request.Context(), s.DB, userID(c))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_coverage_unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scope":                                 "indexed_ready_photoassets",
		"valid_gps_assets":                      counts.ValidGPSAssets,
		"eligible_bd09_assets":                  counts.EligibleBD09Assets,
		"not_eligible_bd09_assets":              counts.ValidGPSAssets - counts.EligibleBD09Assets,
		"source_outside_camera_latitude_assets": counts.OutsideSourceMapLatitudeAssets,
		"map_runtime_verified":                  false,
	})
}
