package api

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errBaiduGeoconvQuotaDenied = errors.New("baidu coordinate conversion quota unavailable")

const (
	// Conservative engineering ceilings; operator/provider account licensing
	// must independently verify that production limits are no less strict.
	baiduGeoconvOwnerRequestsPerMinute int64 = 2
	baiduGeoconvFleetRequestsPerMinute int64 = 20
	baiduGeoconvOwnerPointsPerMinute   int64 = 20
	baiduGeoconvFleetPointsPerMinute   int64 = 200
	baiduGeoconvBatchMaxPoints               = 20
	baiduGeoconvQuotaMaxOwnerID              = uint64(1<<63 - 1)
)

type baiduGeoconvQuotaLimits struct {
	OwnerRequests int64
	FleetRequests int64
	OwnerPoints   int64
	FleetPoints   int64
}

// PRIVATE prerequisite for a future trusted, cancellable Server indexer:
// no API route, no production caller and no outgoing Baidu network traffic.
// The future caller MUST re-check Owner, PhotoAsset, source WGS84 pair and
// current explicit, unexpired consent generation before making any request.
// A successful quota reservation is not authorization to transmit GPS.
func reserveBaiduGeoconvQuota(
	ctx context.Context, db *gorm.DB, ownerID uint64, pointCount int,
) error {
	return reserveBaiduGeoconvQuotaWithLowerAccountCaps(ctx, db, ownerID, pointCount,
		baiduGeoconvQuotaLimits{
			OwnerRequests: baiduGeoconvOwnerRequestsPerMinute,
			FleetRequests: baiduGeoconvFleetRequestsPerMinute,
			OwnerPoints:   baiduGeoconvOwnerPointsPerMinute,
			FleetPoints:   baiduGeoconvFleetPointsPerMinute,
		}, baiduGeoconvDefaultCadenceCaps)
}

// A PRIVATE quota primitive for future independently verified, signed LOWER
// Baidu account limits. No current production caller passes account-specific
// caps; the existing default reservation always uses local conservative caps.
// Caller MUST separately verify the live Owner/session/AK revision, licensed
// evidence and consent before any GPS egress. A successful reservation alone
// never authorizes a network call, and this function does not call Baidu.
//
// Minute requests/points and second/UTC-day requests share ONE outer
// PostgreSQL transaction; rejection in any dimension rolls back ALL fleet
// and Owner charges, including rows created by an earlier dimension.
// Existing lower counters cannot be reset or refunded to fit new caps.
func reserveBaiduGeoconvQuotaWithLowerAccountCaps(
	ctx context.Context, db *gorm.DB, ownerID uint64, pointCount int,
	minuteCaps baiduGeoconvQuotaLimits, cadenceCaps baiduGeoconvCadenceCaps,
) error {
	if ctx == nil || db == nil || ctx.Err() != nil {
		return errBaiduGeoconvQuotaDenied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := reserveBaiduGeoconvQuotaWithLimits(ctx, tx, ownerID, pointCount, minuteCaps); err != nil {
			return errBaiduGeoconvQuotaDenied
		}
		return reserveBaiduGeoconvCadenceTxWithCaps(ctx, tx, ownerID, cadenceCaps)
	})
	if err != nil || ctx.Err() != nil {
		// Never echo PostgreSQL internals, Owner, AK or account evidence.
		return errBaiduGeoconvQuotaDenied
	}
	return nil
}

// Test-only lower caps can never increase production maxima. All Server
// replicas share PostgreSQL-minute fleet+Owner rows in ONE transaction,
// acquired fleet first. A denied owner charge rolls back its fleet charge.
// No budget refunds on abort/retry; this prevents request amplification.
func reserveBaiduGeoconvQuotaWithLimits(
	ctx context.Context, db *gorm.DB, ownerID uint64, pointCount int,
	caps baiduGeoconvQuotaLimits,
) error {
	if ctx == nil || db == nil || ctx.Err() != nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		pointCount < 1 || pointCount > baiduGeoconvBatchMaxPoints ||
		caps.OwnerRequests < 1 || caps.OwnerRequests > baiduGeoconvOwnerRequestsPerMinute ||
		caps.FleetRequests < caps.OwnerRequests ||
		caps.FleetRequests > baiduGeoconvFleetRequestsPerMinute ||
		caps.OwnerPoints < int64(pointCount) ||
		caps.OwnerPoints > baiduGeoconvOwnerPointsPerMinute ||
		caps.FleetPoints < caps.OwnerPoints ||
		caps.FleetPoints > baiduGeoconvFleetPointsPerMinute {
		return errBaiduGeoconvQuotaDenied
	}
	denied := errBaiduGeoconvQuotaDenied
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var minute int64
		if err := tx.Raw("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / 60)::bigint").
			Row().Scan(&minute); err != nil || minute <= 0 {
			return denied
		}
		for _, scope := range []struct {
			id       int64
			requests int64
			points   int64
		}{
			{id: 0, requests: caps.FleetRequests, points: caps.FleetPoints},
			{id: int64(ownerID), requests: caps.OwnerRequests, points: caps.OwnerPoints},
		} {
			var row meta.BaiduGeoconvQuotaBucket
			result := tx.Raw(`
INSERT INTO xd_baidu_geoconv_quota_buckets
  (scope_id, window_minute, requests, points, created_at, updated_at)
VALUES (?, ?, 1, ?, clock_timestamp(), clock_timestamp())
ON CONFLICT (scope_id) DO UPDATE SET
  window_minute = EXCLUDED.window_minute,
  requests = CASE
    WHEN xd_baidu_geoconv_quota_buckets.window_minute = EXCLUDED.window_minute
    THEN xd_baidu_geoconv_quota_buckets.requests + 1 ELSE 1 END,
  points = CASE
    WHEN xd_baidu_geoconv_quota_buckets.window_minute = EXCLUDED.window_minute
    THEN xd_baidu_geoconv_quota_buckets.points + EXCLUDED.points
    ELSE EXCLUDED.points END,
  updated_at = clock_timestamp()
WHERE xd_baidu_geoconv_quota_buckets.window_minute <= EXCLUDED.window_minute
  AND xd_baidu_geoconv_quota_buckets.requests >= 0
  AND xd_baidu_geoconv_quota_buckets.points >= 0
  AND (
    xd_baidu_geoconv_quota_buckets.window_minute < EXCLUDED.window_minute
    OR (
      xd_baidu_geoconv_quota_buckets.requests < ?
      AND xd_baidu_geoconv_quota_buckets.points <= ? - EXCLUDED.points
    )
  )
RETURNING scope_id, window_minute, requests, points
`, scope.id, minute, pointCount, scope.requests, scope.points).Scan(&row)
			if result.Error != nil || result.RowsAffected != 1 ||
				row.ScopeID != scope.id || row.WindowMinute != minute ||
				row.Requests < 1 || row.Requests > scope.requests ||
				row.Points < int64(pointCount) || row.Points > scope.points {
				return denied
			}
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		// Never echo Owner, SQL, AK or provider response.
		return denied
	}
	return nil
}
