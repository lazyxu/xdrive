package api

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errBaiduJSAPIQuotaDenied = errors.New("map resource quota unavailable")

const (
	baiduJSAPIOwnerLoaderRequestsPerMinute int64 = 12
	baiduJSAPIFleetLoaderRequestsPerMinute int64 = 240
	baiduJSAPIQuotaMaxOwnerID                    = uint64(1<<63 - 1)
)

type baiduJSAPILoaderQuotaLimits struct {
	OwnerRequests int64
	FleetRequests int64
}

// reserveBaiduJSAPILoaderQuota is a PRIVATE future-proxy building block.
// OwnerID MUST come from fresh, trusted Server map-session authorization,
// never request/query/headers. There are no routes or production callers.
func reserveBaiduJSAPILoaderQuota(ctx context.Context, db *gorm.DB, ownerID uint64) error {
	return reserveBaiduJSAPILoaderQuotaWithLimits(ctx, db, ownerID, baiduJSAPILoaderQuotaLimits{
		OwnerRequests: baiduJSAPIOwnerLoaderRequestsPerMinute,
		FleetRequests: baiduJSAPIFleetLoaderRequestsPerMinute,
	})
}

// The lower-limit variant is only for isolated tests; runtime ceilings are
// hard-coded above. It reserves the strict maximum 2MiB loader response
// per admission, even when a request aborts or returns fewer bytes.
// A single SQL transaction rolls back the fleet charge if the owner rejects.
func reserveBaiduJSAPILoaderQuotaWithLimits(ctx context.Context, db *gorm.DB, ownerID uint64, caps baiduJSAPILoaderQuotaLimits) error {
	if ctx == nil || db == nil || ctx.Err() != nil || ownerID == 0 || ownerID > baiduJSAPIQuotaMaxOwnerID ||
		caps.OwnerRequests <= 0 || caps.OwnerRequests > baiduJSAPIOwnerLoaderRequestsPerMinute ||
		caps.FleetRequests < caps.OwnerRequests || caps.FleetRequests > baiduJSAPIFleetLoaderRequestsPerMinute {
		return errBaiduJSAPIQuotaDenied
	}
	const reservationBytes = int64(baidumapjsapi.MaxLoaderBytes)
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The database, not independently drifting Server clocks, decides the
		// one-minute window for both fleet and owner in this transaction.
		var minute int64
		if err := tx.Raw("SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / 60)::bigint").Row().Scan(&minute); err != nil || minute <= 0 {
			return errBaiduJSAPIQuotaDenied
		}
		for _, scope := range []struct {
			id       int64
			requests int64
		}{
			{id: 0, requests: caps.FleetRequests},
			{id: int64(ownerID), requests: caps.OwnerRequests},
		} {
			var row meta.BaiduJSAPIQuotaBucket
			result := tx.Raw(`
INSERT INTO xd_baidu_jsapi_quota_buckets
  (scope_id, window_minute, requests, reserved_bytes, created_at, updated_at)
VALUES (?, ?, 1, ?, clock_timestamp(), clock_timestamp())
ON CONFLICT (scope_id) DO UPDATE SET
  window_minute = EXCLUDED.window_minute,
  requests = CASE
    WHEN xd_baidu_jsapi_quota_buckets.window_minute = EXCLUDED.window_minute
    THEN xd_baidu_jsapi_quota_buckets.requests + 1 ELSE 1 END,
  reserved_bytes = CASE
    WHEN xd_baidu_jsapi_quota_buckets.window_minute = EXCLUDED.window_minute
    THEN xd_baidu_jsapi_quota_buckets.reserved_bytes + EXCLUDED.reserved_bytes
    ELSE EXCLUDED.reserved_bytes END,
  updated_at = clock_timestamp()
WHERE xd_baidu_jsapi_quota_buckets.window_minute <= EXCLUDED.window_minute
  AND xd_baidu_jsapi_quota_buckets.requests >= 0
  AND xd_baidu_jsapi_quota_buckets.reserved_bytes >= 0
  AND (
    xd_baidu_jsapi_quota_buckets.window_minute < EXCLUDED.window_minute
    OR (
      xd_baidu_jsapi_quota_buckets.requests < ?
      AND xd_baidu_jsapi_quota_buckets.reserved_bytes <= ? - EXCLUDED.reserved_bytes
    )
  )
RETURNING scope_id, window_minute, requests, reserved_bytes
`, scope.id, minute, reservationBytes, scope.requests, scope.requests*reservationBytes).Scan(&row)
			if result.Error != nil || result.RowsAffected != 1 || row.ScopeID != scope.id ||
				row.WindowMinute != minute || row.Requests < 1 || row.Requests > scope.requests ||
				row.ReservedBytes != row.Requests*reservationBytes {
				return errBaiduJSAPIQuotaDenied
			}
		}
		return nil
	}); err != nil {
		// Fail closed without returning SQL, OwnerID or future credentials.
		return errBaiduJSAPIQuotaDenied
	}
	return nil
}
