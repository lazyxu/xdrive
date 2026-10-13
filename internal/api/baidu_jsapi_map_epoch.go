package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errBaiduMapEpochUnavailable = errors.New("map revocation state unavailable")

// loadBaiduMapEpoch must be called with the authenticated owner ID from
// trusted Server context; callers must separately enforce the live user,
// credential revision and JSAPI release gates on every resource request.
// A missing row NEVER authorizes a map-only cookie.
func loadBaiduMapEpoch(ctx context.Context, db *gorm.DB, ownerID uint64) (meta.BaiduJSAPIMapEpoch, error) {
	if ctx == nil || db == nil || ownerID == 0 {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	var state meta.BaiduJSAPIMapEpoch
	if err := db.WithContext(ctx).Where("owner_id = ?", ownerID).Take(&state).Error; err != nil {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	if state.OwnerID != ownerID || state.Epoch == 0 {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	return state, nil
}

// ensureBaiduMapEpochTx creates the initial nonzero epoch without resetting
// an existing version or revocation cutoff. Only trusted, active users may
// initialize this record. This is infrastructure, NOT map session issuance.
func ensureBaiduMapEpochTx(ctx context.Context, tx *gorm.DB, ownerID uint64) (meta.BaiduJSAPIMapEpoch, error) {
	if ctx == nil || tx == nil || ownerID == 0 {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	var user meta.User
	if err := tx.WithContext(ctx).Select("id").
		Where("id = ? AND disabled_at IS NULL AND must_change_password = ?", ownerID, false).
		Take(&user).Error; err != nil {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	row := meta.BaiduJSAPIMapEpoch{OwnerID: user.ID, Epoch: 1}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "owner_id"}}, DoNothing: true,
	}).Create(&row).Error; err != nil {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	return loadBaiduMapEpoch(ctx, tx, ownerID)
}

// advanceBaiduMapEpochTx atomically invalidates every map-only cookie issued
// before this transaction, across all Server replicas. It does NOT revoke
// general-purpose access JWTs or durable upload/download/sync tasks.
// The trusted caller must supply a transactional *gorm.DB and independently
// commit a redacted audit event; an invalid/expired refresh token cannot call
// this from the future logout handler. This function is NOT yet routed.
func advanceBaiduMapEpochTx(ctx context.Context, tx *gorm.DB, ownerID uint64, now time.Time) (meta.BaiduJSAPIMapEpoch, error) {
	if ctx == nil || tx == nil || ownerID == 0 || now.IsZero() || now.UnixNano() <= 0 {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	stamp := now.UTC()
	var next meta.BaiduJSAPIMapEpoch
	err := tx.WithContext(ctx).Raw(`
INSERT INTO xd_baidu_jsapi_map_epochs (owner_id, epoch, revoked_after, created_at, updated_at)
VALUES (?, 2, ?, ?, ?)
ON CONFLICT (owner_id) DO UPDATE SET
  epoch = xd_baidu_jsapi_map_epochs.epoch + 1,
  revoked_after = GREATEST(
    COALESCE(xd_baidu_jsapi_map_epochs.revoked_after, EXCLUDED.revoked_after),
    EXCLUDED.revoked_after
  ),
  updated_at = EXCLUDED.updated_at
WHERE xd_baidu_jsapi_map_epochs.epoch > 0
  AND xd_baidu_jsapi_map_epochs.epoch < 9223372036854775807
RETURNING owner_id, epoch, revoked_after, created_at, updated_at`,
		ownerID, stamp, stamp, stamp).Scan(&next).Error
	if err != nil || next.OwnerID != ownerID || next.Epoch < 2 || next.RevokedAfter == nil {
		return meta.BaiduJSAPIMapEpoch{}, errBaiduMapEpochUnavailable
	}
	return next, nil
}
