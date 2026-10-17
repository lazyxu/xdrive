package api

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// This private predicate must eventually be backed by independently checked,
// current Baidu account entitlement and permitted self-host/Electron/PWA usage.
// It is NEVER a browser flag, stored AK-present bit, synthetic ReleaseGates
// boolean, successful static-map request or administrative "enable" switch.
//
// No production implementation or caller exists in this phase; therefore no
// external conversion can be triggered by queues, REST, Agent IPC or startup.
type baiduGeoconvAccountPermit func(context.Context, uint64) error

var errBaiduGeoconvDispatchUnavailable = errors.New("baidu coordinate index dispatch unavailable")

// executeBaiduPhotoMapIndexQuotaAdmitted is a PRIVATE, single-photo boundary
// between a trusted provider-account permit, PostgreSQL-wide quota reservation,
// the existing source/consent/lease-fenced executor, and a trusted converter.
//
// Do not add a background scan, HTTP/IPC route, Server AK accessor or real
// provider callback until licence, account quota and operational release proof
// exist. Synthetic account/converter callbacks in tests do not establish them.
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
				return denied
			}
			return nil
		},
		converter)
	if err != nil || dispatchCtx.Err() != nil {
		return denied
	}
	return nil
}
