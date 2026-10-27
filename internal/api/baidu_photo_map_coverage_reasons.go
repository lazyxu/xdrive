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
// Eligibility uses the same Owner/source-fenced predicate as signed map reads.
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
	// Compatibility-only fields may never revive per-photo authorization.
	if r.ConsentUnavailableAssets != 0 || r.ConsentSourceChangedAssets != 0 {
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
// snapshot. A changed GPS, missing derived row, stale source revision or
// invalid map latitude cannot be misreported as a displayable Owner GPS map
// member. Old photo-specific Consent/revocation no longer affect membership. The method has NO HTTP route or provider egress.
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

		// Lack of a map grant is never a reason to hide an Owner photo.
		const reason = `CASE
			WHEN eligible.asset_id IS NOT NULL THEN 'eligible'
			WHEN p.asset_id IS NULL THEN 'derived_missing'
			ELSE 'derived_invalid'
		END AS reason`
		candidates := tx.WithContext(readCtx).Table("(?) AS src", source).
			Joins("LEFT JOIN (?) AS eligible ON eligible.asset_id = src.asset_id", eligible).
			Joins("LEFT JOIN xd_baidu_photo_map_positions AS p ON p.asset_id = src.asset_id AND p.owner_id = src.owner_id").
			Select(reason)
		return tx.WithContext(readCtx).Table("(?) AS classified", candidates).Select(`
			COUNT(*) AS valid_gps_assets,
			COUNT(*) FILTER (WHERE classified.reason = 'eligible') AS eligible_bd09_assets,
			0::bigint AS consent_unavailable_assets,
			0::bigint AS consent_source_changed_assets,
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
