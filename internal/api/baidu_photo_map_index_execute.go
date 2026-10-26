package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	baiduMapIndexCompleted        = "completed"
	baiduMapIndexExecutionTimeout = 8 * time.Second
	baiduMapIndexCancelPoll       = 250 * time.Millisecond
)

var errBaiduMapIndexExecutionDenied = errors.New("baidu photo map index execution unavailable")

// Only trusted in-process Server callbacks can trigger the executor.
// Real runtime callers require live Owner/session and an enabled, current
// Server AK, with genuine quota/lease/cancellation checks; a callback from
// an offline fixture is never an HTTP/browser authority.
type baiduMapIndexDispatchPermit func(context.Context, uint64) error
type baiduMapIndexConverter func(
	context.Context, baidumapjsapi.WGS84Coordinate,
) (baidumapjsapi.BD09Coordinate, error)

// completeBaiduPhotoMapIndexIntent atomically commits a verified BD-09 point
// and a terminal job receipt, or rolls both back. The existing photo-map sink
// independently locks current Owner, Asset, Node and Ready Media source;
// this outer transaction additionally fences the exact
// lease token/attempt/DB-clock expiry, so cancellation cannot resurrect GPS.
func completeBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB,
	lease baiduMapIndexLease, converted baidumapjsapi.BD09Coordinate,
) error {
	denied := errBaiduMapIndexExecutionDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		lease.token == "" || lease.source.ownerID == 0 ||
		lease.source.assetID == 0 || lease.attempt == 0 {
		return denied
	}
	source := lease.source
	candidate := baiduPhotoMapWriteCandidate{
		OwnerID: source.ownerID, AssetID: source.assetID,
		PrimaryNodeID: source.nodeID, NodeRevision: source.nodeRevision,
		MediaUpdatedAt: source.mediaUpdatedAt,
		SourceLatitude: source.latitude, SourceLongitude: source.longitude,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		DerivedLatitude: converted.Latitude, DerivedLongitude: converted.Longitude,
	}
	if _, valid := validBaiduPhotoMapWriteCandidate(candidate); !valid {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := validateBaiduPhotoMapIndexLease(ctx, tx, lease); err != nil {
			return denied
		}
		// The private sink requires a second independent current-source and
		// task-lease proof. This callback checks that the lease is live in
		// the transaction performing the actual index upsert.
		privacy := func(proofCtx context.Context, locked *gorm.DB, ownerID, assetID uint64) error {
			if proofCtx == nil || proofCtx.Err() != nil || locked == nil ||
				ownerID != source.ownerID || assetID != source.assetID {
				return denied
			}
			var current meta.BaiduPhotoMapIndexIntent
			if err := locked.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("owner_id = ? AND asset_id = ? AND status = ? AND lease_token = ? AND attempts = ?",
					ownerID, assetID, baiduMapIndexLeased, lease.token, lease.attempt).
				Take(&current).Error; err != nil ||
				!baiduMapIndexIntentMatches(current, source) ||
				current.LeaseUntil == nil || !current.LeaseUntil.Equal(lease.until) {
				return denied
			}
			now, err := baiduMapIndexClockTx(locked)
			if err != nil || !current.LeaseUntil.After(now) {
				return denied
			}
			return nil
		}
		if err := upsertBaiduPhotoMapPosition(ctx, tx, candidate, privacy); err != nil {
			return denied
		}
		updated := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("owner_id = ? AND asset_id = ? AND status = ? AND lease_token = ? AND attempts = ?",
				source.ownerID, source.assetID, baiduMapIndexLeased, lease.token, lease.attempt).
			Updates(map[string]any{
				"status":      baiduMapIndexCompleted,
				"lease_token": "", "lease_until": nil,
			})
		if updated.Error != nil || updated.RowsAffected != 1 || ctx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil {
		return denied
	}
	return nil
}

// executeBaiduPhotoMapIndexIntent is a single source-fenced Server execution
// used by the existing Owner background consumer. The caller requires an
// enabled, current Server AK and active Owner; no extra photo grant or
// separately audited manual licence/proof switch exists. Nil callbacks deny.
//
// A bounded Go Context is passed directly to the official HTTPS converter.
// Short cross-replica lease/source polls cancel it if the task is cancelled
// or the original GPS becomes stale.
// Completion rechecks everything in one transaction; a callback that ignores
// cancellation can never commit an obsolete derived coordinate.
func executeBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
	permit baiduMapIndexDispatchPermit, converter baiduMapIndexConverter,
) error {
	denied := errBaiduMapIndexExecutionDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || assetID == 0 || permit == nil || converter == nil {
		return denied
	}
	lease, err := claimBaiduPhotoMapIndexIntent(ctx, db, ownerID, assetID)
	if err != nil {
		return denied
	}
	workCtx, cancel := context.WithTimeout(ctx, baiduMapIndexExecutionTimeout)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(baiduMapIndexCancelPoll)
		defer ticker.Stop()
		for {
			select {
			case <-workCtx.Done():
				return
			case <-ticker.C:
				if validateBaiduPhotoMapIndexLease(workCtx, db, lease) != nil {
					cancel()
					return
				}
			}
		}
	}()
	completed := false
	quotaDeferred := false
	defer func() {
		cancel()
		<-done
		if completed {
			return
		}
		// A canceled request Context cannot release a durable job receipt.
		// Use short independent cleanup, but NEVER overwrite Owner revocation,
		// a replaced lease, or an already completed photo index.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		if quotaDeferred && deferBaiduPhotoMapIndexQuotaAttempt(cleanupCtx, db, lease) == nil {
			return
		}
		_ = settleFailedBaiduPhotoMapIndexAttempt(cleanupCtx, db, lease)
	}()

	if validateBaiduPhotoMapIndexLease(workCtx, db, lease) != nil {
		return denied
	}
	if err := permit(workCtx, ownerID); err != nil || workCtx.Err() != nil {
		quotaDeferred = workCtx.Err() == nil && errors.Is(err, errBaiduGeoconvQuotaDenied)
		return denied
	}
	// Quota or account admission alone does not authorize an egress.
	// Recheck the exact lease and source immediately before conversion.
	if validateBaiduPhotoMapIndexLease(workCtx, db, lease) != nil {
		return denied
	}
	converted, err := converter(workCtx, baidumapjsapi.WGS84Coordinate{
		Longitude: lease.source.longitude,
		Latitude:  lease.source.latitude,
	})
	if err != nil || workCtx.Err() != nil {
		return denied
	}
	if err := completeBaiduPhotoMapIndexIntent(workCtx, db, lease, converted); err != nil {
		return denied
	}
	completed = true
	return nil
}
