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

// P0-01: mutually exclusive diagnostics only. No source coordinates, media
// identities, permits or provider responses leave the Server in this result.
// Eligible must use the original signed-map read predicate, not an optimistic
// client approximation of a consent or a derived position.
type baiduPhotoMapCoverageReasons struct {
	ValidGPSAssets             int64
	EligibleBD09Assets         int64
	ConsentUnavailableAssets   int64
	ConsentSourceChangedAssets int64
	DerivedMissingAssets       int64
	DerivedInvalidAssets       int64
}

func (r baiduPhotoMapCoverageReasons) valid() bool {
	if r.ValidGPSAssets < 0 || r.EligibleBD09Assets < 0 ||
		r.EligibleBD09Assets > r.ValidGPSAssets {
		return false
	}
	remaining := r.ValidGPSAssets - r.EligibleBD09Assets
	for _, n := range []int64{
		r.ConsentUnavailableAssets, r.ConsentSourceChangedAssets,
		r.DerivedMissingAssets, r.DerivedInvalidAssets,
	} {
		if n < 0 || n > remaining {
			return false
		}
		remaining -= n
	}
	return remaining == 0
}

// queryBaiduPhotoMapCoverageReasons classifies only the same ready, live,
// Owner-scoped PhotoAssets as the existing coverage endpoint. Both source and
// the exact BD09 eligible subset belong to one read-only REPEATABLE READ
// snapshot. A changed GPS, consent generation, expired grant, missing derived
// row, stale source revision or invalid map latitude cannot be misreported as
// an authorized map member. The method has NO HTTP route or provider egress.
func queryBaiduPhotoMapCoverageReasons(
	ctx context.Context, db *gorm.DB, ownerID uint64,
) (baiduPhotoMapCoverageReasons, error) {
	var empty baiduPhotoMapCoverageReasons
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 {
		return empty, fmt.Errorf("invalid map coverage reason caller")
	}
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(meta.BaiduPhotoMapSpaceBD09LL)
	if !ok {
		return empty, fmt.Errorf("invalid BD09 projection")
	}
	readCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var result baiduPhotoMapCoverageReasons
	err := db.WithContext(readCtx).Transaction(func(tx *gorm.DB) error {
		source := mediaPlacesBaseQuery(readCtx, tx, ownerID).
			Where("n.owner_id = ? AND n.type = ? AND xd_media_metadata.node_revision = n.revision",
				ownerID, meta.NodeTypeFile).
			Select("pa.id AS asset_id, pa.owner_id AS owner_id, " +
				"pa.primary_node_id AS node_id, n.revision AS node_revision, " +
				"xd_media_metadata.updated_at AS media_updated_at, " +
				"xd_media_metadata.latitude AS source_latitude, " +
				"xd_media_metadata.longitude AS source_longitude")
		world := baiduPhotoMapBounds{
			West: -180, South: -85, East: 180, North: 85,
			CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		}
		eligible := baiduPhotoMapOwnerEligibleQuery(readCtx, tx, ownerID, world, projection).
			Select("p.asset_id AS asset_id")

		// Each PhotoAsset, consent and BD09 derived row is unique by asset_id.
		// CASE order is authoritative: a no-consent row can never be counted
		// as a missing-index candidate simply because it has no position.
		const reason = `CASE
			WHEN eligible.asset_id IS NOT NULL THEN 'eligible'
			WHEN c.asset_id IS NULL OR c.revision <= 0 OR
				c.allow_index IS NOT TRUE OR c.allow_baidu_conversion IS NOT TRUE OR
				c.revoked_at IS NOT NULL OR c.expires_at <= clock_timestamp()
				THEN 'consent_unavailable'
			WHEN c.source_node_id IS DISTINCT FROM src.node_id OR
				c.source_node_revision IS DISTINCT FROM src.node_revision OR
				c.source_media_updated_at IS DISTINCT FROM src.media_updated_at OR
				c.source_latitude IS DISTINCT FROM src.source_latitude OR
				c.source_longitude IS DISTINCT FROM src.source_longitude
				THEN 'consent_source_changed'
			WHEN p.asset_id IS NULL THEN 'derived_missing'
			ELSE 'derived_invalid'
		END AS reason`
		candidates := tx.WithContext(readCtx).Table("(?) AS src", source).
			Joins("LEFT JOIN (?) AS eligible ON eligible.asset_id = src.asset_id", eligible).
			Joins("LEFT JOIN xd_baidu_photo_map_consents AS c ON c.asset_id = src.asset_id AND c.owner_id = src.owner_id").
			Joins("LEFT JOIN xd_baidu_photo_map_positions AS p ON p.asset_id = src.asset_id AND p.owner_id = src.owner_id").
			Select(reason)
		return tx.WithContext(readCtx).Table("(?) AS classified", candidates).Select(`
			COUNT(*) AS valid_gps_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'eligible') AS eligible_bd09_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'consent_unavailable') AS consent_unavailable_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'consent_source_changed') AS consent_source_changed_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'derived_missing') AS derived_missing_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'derived_invalid') AS derived_invalid_assets
		`).Scan(&result).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil || readCtx.Err() != nil || !result.valid() {
		return empty, fmt.Errorf("map coverage reasons unavailable")
	}
	return result, nil
}

// Owner-only read-only diagnostics endpoint. Clients must treat error and
// version mismatch as unavailable, never as an empty/fully indexed library.
// Raw source/derived GPS, photo identity and conversion authorization are
// intentionally NOT serialised.
func (s *Server) listBaiduPhotoMapCoverageReasons(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	if c.Request.URL.RawQuery != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_coverage_reasons_request"})
		return
	}
	counts, err := queryBaiduPhotoMapCoverageReasons(c.Request.Context(), s.DB, userID(c))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_coverage_reasons_unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scope":                         "indexed_ready_photoassets",
		"valid_gps_assets":              counts.ValidGPSAssets,
		"eligible_bd09_assets":          counts.EligibleBD09Assets,
		"not_eligible_bd09_assets":      counts.ValidGPSAssets - counts.EligibleBD09Assets,
		"consent_unavailable_assets":    counts.ConsentUnavailableAssets,
		"consent_source_changed_assets": counts.ConsentSourceChangedAssets,
		"derived_missing_assets":        counts.DerivedMissingAssets,
		"derived_invalid_assets":        counts.DerivedInvalidAssets,
		"map_runtime_verified":          false,
	})
}
