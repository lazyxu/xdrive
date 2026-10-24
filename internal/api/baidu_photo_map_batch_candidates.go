package api

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const baiduPhotoMapGrantBatchMaxItems = 32

var errBaiduPhotoMapGrantBatchUnavailable = errors.New("private map grant batch unavailable")

// This is a *private server-side* candidate, not a UI/API DTO.
// All provenance, identities and original WGS84 values are non-serializable.
// The current consent is ALWAYS checked again under the grant transaction's
// Owner -> Asset -> Node -> Media -> Consent locks before any write.
type baiduPhotoMapGrantBatchCandidate struct {
	AssetID         uint64    `gorm:"column:asset_id" json:"-"`
	PrimaryNodeID   uint64    `gorm:"column:primary_node_id" json:"-"`
	NodeRevision    uint64    `gorm:"column:node_revision" json:"-"`
	MediaUpdatedAt  time.Time `gorm:"column:media_updated_at" json:"-"`
	SourceLatitude  float64   `gorm:"column:source_latitude" json:"-"`
	SourceLongitude float64   `gorm:"column:source_longitude" json:"-"`
	ConsentRevision uint64    `gorm:"column:consent_revision" json:"-"`
}

// Deliberately reject accidental generic JSON serialization of a private GPS
// candidate, rather than leaking it through a debug handler/log on a future
// HTTP/API implementation.
func (baiduPhotoMapGrantBatchCandidate) MarshalJSON() ([]byte, error) {
	return nil, errBaiduPhotoMapGrantBatchUnavailable
}

func validBaiduPhotoMapGrantBatchLimit(limit int) bool {
	return limit >= 1 && limit <= baiduPhotoMapGrantBatchMaxItems
}

func validBaiduPhotoMapGrantBatchCandidate(c baiduPhotoMapGrantBatchCandidate) bool {
	return c.AssetID > 0 && c.PrimaryNodeID > 0 && c.NodeRevision > 0 &&
		!c.MediaUpdatedAt.IsZero() && c.ConsentRevision != ^uint64(0) &&
		!math.IsNaN(c.SourceLatitude) && !math.IsInf(c.SourceLatitude, 0) &&
		!math.IsNaN(c.SourceLongitude) && !math.IsInf(c.SourceLongitude, 0) &&
		c.SourceLatitude >= -90 && c.SourceLatitude <= 90 &&
		c.SourceLongitude >= -180 && c.SourceLongitude <= 180
}

// queryBaiduPhotoMapGrantBatchCandidates is NOT an API endpoint or an
// authorization decision. It returns a bounded, deterministic prefix of the
// current Owner's indexed-ready, live, valid-WGS84 PhotoAssets for which
// explicit authorization has not yet been granted, has expired/revoked, or
// no longer matches the original source. There is NO client cursor/offset,
// and no one may use the returned original GPS without calling the existing
// grantBaiduPhotoMapConsent with a freshly authenticated Owner decision.
//
// After a successfully committed grant, the updated row stops matching; the
// next invocation selects the following prefix, without leaking Asset IDs.
// A conflict or source edit is NOT silently skipped: the caller must re-read
// and verify under the existing transaction before committing each grant.
// No implicit consent, persistent queue, conversion or network egress here.
func queryBaiduPhotoMapGrantBatchCandidates(
	ctx context.Context, db *gorm.DB, ownerID uint64, limit int,
) ([]baiduPhotoMapGrantBatchCandidate, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		!validBaiduPhotoMapGrantBatchLimit(limit) {
		return nil, errBaiduPhotoMapGrantBatchUnavailable
	}
	readCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	var results []baiduPhotoMapGrantBatchCandidate
	// The shared Places predicate validates the source WGS84 and joins the
	// logical PhotoAsset, live Node and ready MediaMetadata. Require the same
	// Node revision/owner as consent and Map coverage before selecting rows.
	source := mediaPlacesBaseQuery(readCtx, db, ownerID).
		Joins("LEFT JOIN xd_baidu_photo_map_consents AS c ON c.owner_id = pa.owner_id AND c.asset_id = pa.id").
		Where("n.owner_id = ? AND n.type = ? AND n.revision > 0 AND xd_media_metadata.node_revision = n.revision",
			ownerID, meta.NodeTypeFile).
		Where(`c.asset_id IS NULL OR c.revision <= 0 OR
			c.allow_index IS NOT TRUE OR c.allow_baidu_conversion IS NOT TRUE OR
			c.revoked_at IS NOT NULL OR c.expires_at IS NULL OR
			c.expires_at <= clock_timestamp() OR
			c.source_node_id IS DISTINCT FROM n.id OR
			c.source_node_revision IS DISTINCT FROM n.revision OR
			c.source_media_updated_at IS DISTINCT FROM xd_media_metadata.updated_at OR
			c.source_latitude IS DISTINCT FROM xd_media_metadata.latitude OR
			c.source_longitude IS DISTINCT FROM xd_media_metadata.longitude`)

	err := source.Select(`pa.id AS asset_id, pa.primary_node_id AS primary_node_id,
		n.revision AS node_revision, xd_media_metadata.updated_at AS media_updated_at,
		xd_media_metadata.latitude AS source_latitude,
		xd_media_metadata.longitude AS source_longitude,
		COALESCE(c.revision, 0) AS consent_revision`).
		Order("pa.id ASC").Limit(limit).Scan(&results).Error
	if err != nil || readCtx.Err() != nil || len(results) > limit {
		return nil, errBaiduPhotoMapGrantBatchUnavailable
	}
	for _, candidate := range results {
		if !validBaiduPhotoMapGrantBatchCandidate(candidate) {
			return nil, errBaiduPhotoMapGrantBatchUnavailable
		}
	}
	return results, nil
}

// Keep the JSON interface closed even if future code directly references
// the private object through an interface.
var _ json.Marshaler = baiduPhotoMapGrantBatchCandidate{}
