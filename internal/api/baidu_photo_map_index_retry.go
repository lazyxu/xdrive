package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// A durable bounded retry clock is only evaluated by PostgreSQL.
// The first failure cools for 15 seconds, the second for 60 seconds;
// the third exhausts this explicit photo+consent generation permanently.
func baiduMapIndexNextRetry(attempt uint32, now time.Time) (string, *time.Time) {
	if attempt >= baiduMapIndexMaxClaims || attempt == 0 {
		return baiduMapIndexFailed, nil
	}
	delay := 15 * time.Second
	if attempt == 2 {
		delay = time.Minute
	}
	next := now.Add(delay)
	return baiduMapIndexQueued, &next
}

// Complete a FAILED, specifically leased single-photo attempt. This private
// receipt is NOT an HTTP endpoint or a worker. Retry is only possible for
// the same still-valid Owner, source GPS, consent and exact lease generation.
// A cancelled/completed/replaced/stale job is never resurrected. No provider
// error, AK, raw GPS, URL or file name is persisted or returned.
func settleFailedBaiduPhotoMapIndexAttempt(
	ctx context.Context, db *gorm.DB, lease baiduMapIndexLease,
) error {
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		lease.source.ownerID == 0 || lease.source.assetID == 0 ||
		lease.token == "" || lease.attempt == 0 || lease.attempt > baiduMapIndexMaxClaims {
		return denied
	}
	// Read-time original GPS checks can occur in SQL; do not emit any of them
	// into verbose GORM output, including on transaction failure.
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := privateDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		source, err := lockBaiduMapIndexSourceTx(ctx, tx, lease.source.ownerID, lease.source.assetID)
		if err != nil || !baiduMapIndexSourcesEqual(source, lease.source) {
			return denied
		}
		var row meta.BaiduPhotoMapIndexIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND asset_id = ?", source.ownerID, source.assetID).
			Take(&row).Error; err != nil ||
			row.Status != baiduMapIndexLeased ||
			!baiduMapIndexIntentMatches(row, source) ||
			row.Attempts != lease.attempt || row.LeaseToken != lease.token ||
			row.LeaseUntil == nil || !row.LeaseUntil.Equal(lease.until) {
			return denied
		}
		now, err := baiduMapIndexClockTx(tx)
		if err != nil || !row.LeaseUntil.After(now) || ctx.Err() != nil {
			return denied // expired claims require separate safe repair
		}
		status, retryAfter := baiduMapIndexNextRetry(row.Attempts, now)
		updated := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("owner_id = ? AND asset_id = ? AND status = ? AND lease_token = ? AND attempts = ?",
				source.ownerID, source.assetID, baiduMapIndexLeased, lease.token, lease.attempt).
			Updates(map[string]any{
				"status": status, "retry_after": retryAfter,
				"lease_token": "", "lease_until": nil,
			})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
