package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	baiduPhotoMapAutoPlanMaxItems = 32
	baiduPhotoMapAutoPlanTimeout  = 8 * time.Second
	// Prevent provider outage storms while allowing automatic next-day recovery.
	baiduPhotoMapAutoFailedRetryCooldown = 24 * time.Hour
)

var errBaiduPhotoMapAutoPlanUnavailable = errors.New("owner photo map index planning unavailable")

type baiduPhotoMapAutoPlan struct {
	Queued    int
	NextAfter uint64
	HasMore   bool
}

// queryBaiduPhotoMapAutoCandidates reads ONLY Asset IDs. It neither grants
// per-photo permission nor forwards WGS84 to Baidu. Both SDK Hosts already
// consume the same Owner/source-fenced derived position predicate.
//
// Current derived points, actively queued/leased work, current-generation
// cancelled tasks and failures still in cooldown are excluded. Legacy
// nonzero-consent cancelled jobs are NOT a current photo-map opt-out: replan
// their still-Owner-valid GPS without new consent. Active leases, source
// revision checks, DB-clock retry and modern zero-revision cancellations
// remain binding. A cursor and hard limit bound scans.
func queryBaiduPhotoMapAutoCandidates(
	ctx context.Context, db *gorm.DB, ownerID, afterAssetID uint64, limit int,
) ([]uint64, bool, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		limit < 1 || limit > baiduPhotoMapAutoPlanMaxItems {
		return nil, false, errBaiduPhotoMapAutoPlanUnavailable
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduPhotoMapAutoPlanTimeout)
	defer cancel()

	type candidate struct {
		AssetID uint64 `gorm:"column:asset_id"`
	}
	var rows []candidate
	dbRead := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := mediaPlacesBaseQuery(readCtx, dbRead, ownerID).
		Joins("JOIN xd_users AS u ON u.id = pa.owner_id AND u.disabled_at IS NULL AND u.must_change_password = FALSE AND u.session_version > 0").
		Joins(`LEFT JOIN xd_baidu_photo_map_positions AS p ON
			p.asset_id = pa.id AND p.owner_id = pa.owner_id AND
			p.primary_node_id = n.id AND p.node_revision = n.revision AND
			p.media_updated_at = xd_media_metadata.updated_at AND
			p.source_latitude = xd_media_metadata.latitude AND
			p.source_longitude = xd_media_metadata.longitude AND
			p.coordinate_space = ? AND p.projection_version = ? AND
			p.latitude BETWEEN -85 AND 85 AND
			p.longitude BETWEEN -180 AND 180`,
			meta.BaiduPhotoMapSpaceBD09LL, meta.BaiduPhotoMapProjectionGeoconvV2).
		Joins(`LEFT JOIN xd_baidu_photo_map_index_intents AS i ON
			i.asset_id = pa.id AND i.owner_id = pa.owner_id AND
			i.primary_node_id = n.id AND i.node_revision = n.revision AND
			i.media_updated_at = xd_media_metadata.updated_at AND
			i.session_version = u.session_version AND (
				(i.consent_revision = 0 AND i.status <> ? AND (
					i.status <> ? OR
					i.updated_at + INTERVAL '24 hours' > clock_timestamp() OR
					(i.retry_after IS NOT NULL AND i.retry_after > clock_timestamp())
				)) OR
				(i.status = ? AND i.consent_revision <> 0 AND (
					i.updated_at + INTERVAL '24 hours' > clock_timestamp() OR
					(i.retry_after IS NOT NULL AND i.retry_after > clock_timestamp())
				)) OR
				(i.status = ? AND i.lease_until > clock_timestamp())
			)`, baiduMapIndexCompleted, baiduMapIndexFailed,
			baiduMapIndexFailed, baiduMapIndexLeased).
		Where("n.owner_id = ? AND n.type = ? AND n.revision > 0 AND xd_media_metadata.node_revision = n.revision",
			ownerID, meta.NodeTypeFile).
		Where("pa.kind IN ?", []string{
			meta.PhotoAssetKindImage, meta.PhotoAssetKindVideo,
			meta.PhotoAssetKindLivePhoto, meta.PhotoAssetKindRAWPair, meta.PhotoAssetKindBurst,
		}).
		Where("pa.id > ? AND xd_media_metadata.latitude BETWEEN -85 AND 85", afterAssetID).
		Where("p.asset_id IS NULL AND i.asset_id IS NULL").
		Select("pa.id AS asset_id").
		Order("pa.id ASC").
		Limit(limit + 1).
		Scan(&rows).Error
	if err != nil || readCtx.Err() != nil || len(rows) > limit+1 {
		return nil, false, errBaiduPhotoMapAutoPlanUnavailable
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		if row.AssetID == 0 || row.AssetID <= afterAssetID ||
			(len(ids) > 0 && row.AssetID <= ids[len(ids)-1]) {
			return nil, false, errBaiduPhotoMapAutoPlanUnavailable
		}
		ids = append(ids, row.AssetID)
	}
	return ids, hasMore, nil
}

// planBaiduPhotoMapOwnerBackfillBatch is a bounded, idempotent producer of
// existing durable IndexIntents; it never calls a provider or reads an AK.
// Each ID is independently revalidated under Owner/Asset/Node/Media locks by
// enqueueBaiduPhotoMapIndexIntent, so a concurrent GPS edit cannot slip in.
// Only successfully enqueued IDs advance the resumable cursor.
func planBaiduPhotoMapOwnerBackfillBatch(
	ctx context.Context, db *gorm.DB, ownerID, afterAssetID uint64, limit int,
) (baiduPhotoMapAutoPlan, error) {
	progress := baiduPhotoMapAutoPlan{NextAfter: afterAssetID}
	ids, more, err := queryBaiduPhotoMapAutoCandidates(ctx, db, ownerID, afterAssetID, limit)
	if err != nil {
		return progress, err
	}
	for _, assetID := range ids {
		if ctx.Err() != nil ||
			enqueueBaiduPhotoMapIndexIntent(ctx, db, ownerID, assetID, 0) != nil {
			return progress, errBaiduPhotoMapAutoPlanUnavailable
		}
		progress.Queued++
		progress.NextAfter = assetID
	}
	progress.HasMore = more
	return progress, nil
}
