package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	// These local ceilings only reduce risk; a genuine separately checked
	// operator account entitlement must impose any LOWER Baidu account limit.
	// No production Geoconv network caller is installed.
	baiduGeoconvOwnerSecondRequests int64 = 2
	baiduGeoconvFleetSecondRequests int64 = 2
	baiduGeoconvOwnerDayRequests    int64 = 200
	baiduGeoconvFleetDayRequests    int64 = 4000
)

type baiduGeoconvCadenceCaps struct {
	OwnerSecond int64
	FleetSecond int64
	OwnerDay    int64
	FleetDay    int64
}

var baiduGeoconvDefaultCadenceCaps = baiduGeoconvCadenceCaps{
	OwnerSecond: baiduGeoconvOwnerSecondRequests,
	FleetSecond: baiduGeoconvFleetSecondRequests,
	OwnerDay:    baiduGeoconvOwnerDayRequests,
	FleetDay:    baiduGeoconvFleetDayRequests,
}

// Called only from the existing private minute reservation's OUTER transaction.
// A single PostgreSQL clock sample governs BOTH scopes and BOTH new windows.
// Client clocks, payloads and account-provided limit increases are not trusted.
func reserveBaiduGeoconvCadenceTx(ctx context.Context, tx *gorm.DB, ownerID uint64) error {
	if ctx == nil || ctx.Err() != nil || tx == nil {
		return errBaiduGeoconvQuotaDenied
	}
	var clock struct {
		Second int64
		Day    int64
	}
	err := tx.WithContext(ctx).Raw(
		"SELECT FLOOR(EXTRACT(EPOCH FROM t.now_at))::bigint AS second, " +
			"FLOOR(EXTRACT(EPOCH FROM t.now_at) / 86400)::bigint AS day " +
			"FROM (SELECT clock_timestamp() AS now_at) t",
	).Scan(&clock).Error
	if err != nil || clock.Second <= 0 || clock.Day <= 0 {
		return errBaiduGeoconvQuotaDenied
	}
	return reserveBaiduGeoconvCadenceAt(ctx, tx, ownerID, clock.Second, clock.Day, baiduGeoconvDefaultCadenceCaps)
}

// A deterministic clock/cap seam exclusively for isolated PostgreSQL tests.
// This function is not a licence gate, a public route or a production time
// override. Its update is transactional even when invoked on a bare DB.
func reserveBaiduGeoconvCadenceAt(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	second, day int64, caps baiduGeoconvCadenceCaps,
) error {
	denied := errBaiduGeoconvQuotaDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		second <= 0 || day <= 0 || day != second/86400 ||
		caps.OwnerSecond < 1 || caps.OwnerSecond > baiduGeoconvOwnerSecondRequests ||
		caps.FleetSecond < caps.OwnerSecond || caps.FleetSecond > baiduGeoconvFleetSecondRequests ||
		caps.OwnerDay < 1 || caps.OwnerDay > baiduGeoconvOwnerDayRequests ||
		caps.FleetDay < caps.OwnerDay || caps.FleetDay > baiduGeoconvFleetDayRequests {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, scope := range []struct {
			id        int64
			perSecond int64
			perDay    int64
		}{
			{id: 0, perSecond: caps.FleetSecond, perDay: caps.FleetDay},
			{id: int64(ownerID), perSecond: caps.OwnerSecond, perDay: caps.OwnerDay},
		} {
			var row meta.BaiduGeoconvQuotaBucket
			result := tx.Raw(
				"UPDATE xd_baidu_geoconv_quota_buckets SET "+
					"window_second = ?, "+
					"second_requests = CASE WHEN window_second = ? "+
					"THEN second_requests + 1 ELSE 1 END, "+
					"window_day = ?, "+
					"day_requests = CASE WHEN window_day = ? "+
					"THEN day_requests + 1 ELSE 1 END, "+
					"updated_at = clock_timestamp() "+
					"WHERE scope_id = ? "+
					"AND window_second <= ? AND window_day <= ? "+
					"AND second_requests >= 0 AND day_requests >= 0 "+
					"AND (window_second < ? OR second_requests < ?) "+
					"AND (window_day < ? OR day_requests < ?) "+
					"RETURNING scope_id, window_second, second_requests, window_day, day_requests",
				second, second, day, day, scope.id,
				second, day, second, scope.perSecond, day, scope.perDay,
			).Scan(&row)
			if result.Error != nil || result.RowsAffected != 1 ||
				row.ScopeID != scope.id || row.WindowSecond != second ||
				row.WindowDay != day || row.SecondRequests < 1 ||
				row.SecondRequests > scope.perSecond || row.DayRequests < 1 ||
				row.DayRequests > scope.perDay {
				return denied
			}
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
