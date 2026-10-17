package api

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const baiduMapIndexOwnerDemandReadTimeout = time.Second

// selectBaiduPhotoMapIndexDemand only reads the OWNER's existing explicit
// one-photo intent rows. It has no Gallery media query, GPS, secret or network
// capability, and never enumerates arbitrary PhotoAssets or all Owners.
// Two indexed, one-row probes prioritize repair of an expired lease before
// an eligible queued item. The actual executor MUST check the live Owner,
// Node, exact source WGS84, opt-in consent, lease and account permissions again.
func selectBaiduPhotoMapIndexDemand(
	ctx context.Context, db *gorm.DB, ownerID uint64,
) (uint64, error) {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID {
		return 0, denied
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduMapIndexOwnerDemandReadTimeout)
	defer cancel()
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).
		WithContext(readCtx)
	// Repair only: cannot be dispatched by this read and cannot skip
	// PostgreSQL-clock cooldown after claimBaiduPhotoMapIndexIntent repairs it.
	var expiredID uint64
	err := privateDB.Raw(
		"SELECT asset_id FROM xd_baidu_photo_map_index_intents "+
			"WHERE owner_id = ? AND status = ? AND attempts BETWEEN 1 AND ? "+
			"AND lease_until <= clock_timestamp() "+
			"ORDER BY asset_id LIMIT 1",
		ownerID, baiduMapIndexLeased, baiduMapIndexMaxClaims,
	).Row().Scan(&expiredID)
	if err == nil && expiredID != 0 && readCtx.Err() == nil {
		return expiredID, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, denied
	}
	if err == nil || readCtx.Err() != nil {
		return 0, denied
	}

	// Ready only: never select failed/cancelled/completed tasks, early retries,
	// or an active lease. A zero candidate means no explicit work to dispatch.
	var readyID uint64
	err = privateDB.Raw(
		"SELECT asset_id FROM xd_baidu_photo_map_index_intents "+
			"WHERE owner_id = ? AND status = ? AND attempts < ? "+
			"AND (retry_after IS NULL OR retry_after <= clock_timestamp()) "+
			"ORDER BY asset_id LIMIT 1",
		ownerID, baiduMapIndexQueued, baiduMapIndexMaxClaims,
	).Row().Scan(&readyID)
	if err != nil || readyID == 0 || readCtx.Err() != nil {
		return 0, denied
	}
	return readyID, nil
}

// This is an internal ONE-SHOT, demand-driven dispatcher building block,
// NOT a production scheduler. A future separately reviewed trusted Server
// caller must supply live account entitlement and a CURRENT Server-only AK;
// no such production caller exists. It never enables JSAPI4 or any URL route.
func executeOneBaiduPhotoMapIndexOwnerDemand(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	accountPermit baiduGeoconvAccountPermit, serverAK baiduGeoconvPrivateServerAK,
) error {
	return executeOneBaiduPhotoMapIndexWithTrustedForward(
		ctx, db, ownerID, accountPermit, serverAK, baidumapjsapi.ForwardWGS84ToBD09,
	)
}

// Offline injection is private to isolated tests, never administrative policy,
// a browser callback, an Agent IPC message, or a background startup hook.
// No pending intent, denied account, canceled request or expired/repaired
// lease is allowed to read AK or invoke the provider.
func executeOneBaiduPhotoMapIndexWithTrustedForward(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	accountPermit baiduGeoconvAccountPermit, serverAK baiduGeoconvPrivateServerAK,
	forward baiduGeoconvPrivateForwardSend,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		accountPermit == nil || serverAK == nil || forward == nil {
		return denied
	}
	runCtx, cancel := context.WithTimeout(ctx, baiduMapIndexExecutionTimeout)
	defer cancel()
	// Independent current account entitlement BEFORE even selecting the
	// Owner's queued IDs. The source/lease executor then checks it again.
	if err := accountPermit(runCtx, ownerID); err != nil || runCtx.Err() != nil {
		return denied
	}
	assetID, err := selectBaiduPhotoMapIndexDemand(runCtx, db, ownerID)
	if err != nil || runCtx.Err() != nil {
		return denied
	}
	if err := executeBaiduPhotoMapIndexWithTrustedForward(
		runCtx, db, ownerID, assetID, accountPermit, serverAK, forward,
	); err != nil || runCtx.Err() != nil {
		return denied
	}
	return nil
}
