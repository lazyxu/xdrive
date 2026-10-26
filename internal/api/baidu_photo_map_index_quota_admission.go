package api

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// This private callback is implemented by the Server's live Owner and current
// enabled Server/Web-Service AK check. There is no separately reviewed licence
// file, pinned operator signer, per-photo opt-in or external manual gate.
// A browser flag, raw client AK or synthetic test ReleaseGates cannot satisfy
// this callback. The existing quotas, cancellation and source locks are always
// enforced before provider egress.
type baiduGeoconvAccountPermit func(context.Context, uint64) error

var errBaiduGeoconvDispatchUnavailable = errors.New("baidu coordinate index dispatch unavailable")

// executeBaiduPhotoMapIndexQuotaAdmitted composes the trusted active-Owner +
// configured Server AK permit, PostgreSQL fleet+Owner flight/quota admission,
// the existing source/lease-fenced executor and official HTTPS converter.
// No independent manual licence/signature check or extra per-photo consent.
// Synthetic callbacks remain offline test seams, never an HTTP/IPC switch.
//
// Two account checks are intentional. The first prevents claim/attempt changes
// on a denied account; the second runs AFTER the exact source-bound DB claim,
// immediately BEFORE the independent DB-clock fleet+Owner quota charge. The
// executor itself checks the live lease AGAIN before passing WGS84 to converter.
// A consumed quota is conservatively never refunded on timeout or cancellation.
func executeBaiduPhotoMapIndexQuotaAdmitted(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
	accountPermit baiduGeoconvAccountPermit, converter baiduMapIndexConverter,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || assetID == 0 || accountPermit == nil || converter == nil {
		return denied
	}
	dispatchCtx, cancel := context.WithTimeout(ctx, baiduMapIndexExecutionTimeout)
	defer cancel()

	// Source-WGS84 predicates used by nested consent/lease validation must
	// never appear in GORM's verbose SQL logs even on a failed transaction.
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := accountPermit(dispatchCtx, ownerID); err != nil || dispatchCtx.Err() != nil {
		return denied
	}
	// An independent, short-lived fleet+Owner capacity lease is required
	// BEFORE any source/consent job claim can consume an attempt. The
	// request Context is bounded by the existing eight-second timeout.
	flight, err := acquireBaiduGeoconvFlight(dispatchCtx, privateDB, ownerID)
	if err != nil {
		return denied
	}
	// Register cleanup immediately after a successful claim: even a
	// cancellation arriving before the next line must release this slot.
	defer func() {
		// Cleanup must work even if another Server revoked the request Context.
		// Any DB outage leaves an expiring lease, never an immortal reservation.
		releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer releaseCancel()
		_ = releaseBaiduGeoconvFlight(releaseCtx, privateDB, flight)
	}()
	if dispatchCtx.Err() != nil {
		return denied
	}
	err = executeBaiduPhotoMapIndexIntent(dispatchCtx, privateDB, ownerID, assetID,
		func(workCtx context.Context, actualOwner uint64) error {
			if workCtx == nil || workCtx.Err() != nil || actualOwner != ownerID {
				return denied
			}
			if err := accountPermit(workCtx, actualOwner); err != nil || workCtx.Err() != nil {
				return denied
			}
			// One photo => exactly ONE quota point. The quota row stores no
			// coordinates, secrets or photo identities and serializes the
			// fleet before this Owner across independent PostgreSQL pools.
			if err := reserveBaiduGeoconvQuota(workCtx, privateDB, actualOwner, 1); err != nil {
				// This capacity pause must not burn the photo's attempts.
				return errBaiduGeoconvQuotaDenied
			}
			return nil
		},
		converter)
	if err != nil || dispatchCtx.Err() != nil {
		return denied
	}
	return nil
}
