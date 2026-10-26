package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// A saved, enabled Baidu Server/Web-Service AK and a live Owner account are
// sufficient to admit conversion. There is no extra photo grant, operator
// signature, manually reviewed licence file or separate runtime switch.
// The already existing fleet+Owner quota, lease, GPS provenance, cancellation
// and HTTPS provider transport remain mandatory for every conversion.
func (s *Server) configuredBaiduGeoconvAccountPermit(ctx context.Context, ownerID uint64) error {
	if s == nil || ctx == nil || ctx.Err() != nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID {
		return errBaiduGeoconvDispatchUnavailable
	}
	if _, err := s.currentBaiduGeoconvServerAK(ctx, ownerID); err != nil ||
		ctx.Err() != nil {
		return errBaiduGeoconvDispatchUnavailable
	}
	return nil
}

type baiduPhotoMapAutoExecuteOne func(context.Context, uint64, uint64) error

// consumeBaiduPhotoMapAutoOwnersOnce selects at most one current Owner and at
// most one existing ready/repairable durable intent per tick. It only reads
// private IDs before the downstream executor revalidates Owner and source,
// acquires fleet capacity and charges quota before official provider egress.
// Owner cursor rotation prevents one large photo library starving others.
// The executor argument exists only for isolated offline PostgreSQL tests.
func (s *Server) consumeBaiduPhotoMapAutoOwnersOnceWithExecutor(
	ctx context.Context, afterOwner *uint64, execute baiduPhotoMapAutoExecuteOne,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil ||
		afterOwner == nil || execute == nil {
		return denied
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduMapIndexOwnerDemandReadTimeout)
	defer cancel()
	db := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	var owners []uint64
	for pass := 0; pass < 2; pass++ {
		owners = nil
		err := db.WithContext(readCtx).Model(&meta.User{}).
			Where("id > ? AND disabled_at IS NULL AND must_change_password = ? AND session_version > 0", *afterOwner, false).
			Order("id ASC").Limit(1).Pluck("id", &owners).Error
		if err != nil || readCtx.Err() != nil {
			return denied
		}
		if len(owners) > 0 {
			break
		}
		if *afterOwner == 0 {
			return nil
		}
		*afterOwner = 0
	}
	if len(owners) != 1 || owners[0] == 0 {
		return nil
	}
	ownerID := owners[0]
	*afterOwner = ownerID
	assetID, err := selectBaiduPhotoMapIndexDemand(ctx, db, ownerID)
	if err != nil {
		// A PostgreSQL error is not an empty Owner queue. Propagate only
		// the generic private failure: the consumer backs off rather than
		// spinning against an unavailable database or logging photo IDs.
		return denied
	}
	if assetID == 0 {
		return nil // no ready demand: never open an AK or contact Baidu
	}
	if ctx.Err() != nil || execute(ctx, ownerID, assetID) != nil {
		return denied
	}
	return nil
}

// Production consumes only the already planned durable queue. The configured
// service permit is refreshed on each admission and before the actual HTTPS
// conversion; there is no standalone approval/review stage or new API route.
func (s *Server) consumeBaiduPhotoMapAutoOwnersOnce(
	ctx context.Context, afterOwner *uint64,
) error {
	if s == nil || s.DB == nil {
		return errBaiduGeoconvDispatchUnavailable
	}
	return s.consumeBaiduPhotoMapAutoOwnersOnceWithExecutor(
		ctx, afterOwner,
		func(runCtx context.Context, ownerID, assetID uint64) error {
			// Disabled/unconfigured service is an ordinary idle state.
			// Preserve the queued task; a future tick automatically retries
			// after Admin enables the Server AK, without photo re-consent.
			if s.configuredBaiduGeoconvAccountPermit(runCtx, ownerID) != nil {
				return nil
			}
			return executeBaiduPhotoMapIndexWithTrustedForward(
				runCtx, s.DB, ownerID, assetID,
				s.configuredBaiduGeoconvAccountPermit,
				s.currentBaiduGeoconvServerAK,
				baidumapjsapi.ForwardWGS84ToBD09,
			)
		},
	)
}
