package api

import (
	"context"
	"math"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"gorm.io/gorm"
)

// These callbacks can only be supplied by trusted in-process Server code.
// They are NOT wired to a production resolver, Router or background worker.
// In particular, a configured Server AK is NOT proof of legal Geoconv rights.
type baiduGeoconvPrivateServerAK func(context.Context, uint64) (string, error)
type baiduGeoconvPrivateForwardSend func(
	context.Context, string, []baidumapjsapi.WGS84Coordinate,
) ([]baidumapjsapi.BD09Coordinate, error)

func validBaiduGeoconvPrivateAK(value string) bool {
	if len(value) == 0 || len(value) > 512 {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < '!' || value[i] > '~' {
			return false
		}
	}
	return true
}

func finiteBaiduGeoconvCoordinate(point baidumapjsapi.WGS84Coordinate) bool {
	return !math.IsNaN(point.Latitude) && !math.IsInf(point.Latitude, 0) &&
		!math.IsNaN(point.Longitude) && !math.IsInf(point.Longitude, 0) &&
		point.Latitude >= -90 && point.Latitude <= 90 &&
		point.Longitude >= -180 && point.Longitude <= 180
}

func finiteBaiduGeoconvResult(point baidumapjsapi.BD09Coordinate) bool {
	return !math.IsNaN(point.Latitude) && !math.IsInf(point.Latitude, 0) &&
		!math.IsNaN(point.Longitude) && !math.IsInf(point.Longitude, 0) &&
		point.Latitude >= -90 && point.Latitude <= 90 &&
		point.Longitude >= -180 && point.Longitude <= 180
}

// The resulting converter is only used INSIDE the existing account-first,
// capacity-fenced, source/consent/lease-checked single-photo Server executor.
// Recheck the real account entitlement a THIRD time immediately before
// reading the encrypted Server AK. The AK is never kept in a durable task,
// logged, passed via REST/Agent/IPC/JS, or returned in error text.
//
// forward is an OFFLINE TEST seam. The sole intended production implementation
// is baidumapjsapi.ForwardWGS84ToBD09 with pinned HTTPS/timeout/no redirect.
// A synthetic permit, fake AK source or mock sender is NOT an activation gate.
func baiduGeoconvPrivateForwardConverter(
	ownerID uint64,
	accountPermit baiduGeoconvAccountPermit,
	serverAK baiduGeoconvPrivateServerAK,
	forward baiduGeoconvPrivateForwardSend,
) (baiduMapIndexConverter, error) {
	denied := errBaiduGeoconvDispatchUnavailable
	if ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		accountPermit == nil || serverAK == nil || forward == nil {
		return nil, denied
	}
	return func(ctx context.Context, source baidumapjsapi.WGS84Coordinate) (
		baidumapjsapi.BD09Coordinate, error,
	) {
		var zero baidumapjsapi.BD09Coordinate
		if ctx == nil || ctx.Err() != nil || !finiteBaiduGeoconvCoordinate(source) {
			return zero, denied
		}
		if err := accountPermit(ctx, ownerID); err != nil || ctx.Err() != nil {
			return zero, denied
		}
		ak, err := serverAK(ctx, ownerID)
		if err != nil || !validBaiduGeoconvPrivateAK(ak) || ctx.Err() != nil {
			return zero, denied
		}
		// Exactly ONE original, current WGS84 photo pair may leave the Server.
		// No batch scanning, client coordinates, grid centres or inverse math.
		points, err := forward(ctx, ak, []baidumapjsapi.WGS84Coordinate{source})
		if err != nil || ctx.Err() != nil || len(points) != 1 ||
			!finiteBaiduGeoconvResult(points[0]) {
			return zero, denied
		}
		return points[0], nil
	}, nil
}

// ONE private, pre-admitted Server entry point. The trusted account permit,
// source-bound consent, cross-replica flight, exact task lease, PostgreSQL
// second/minute/day quota and 8-second Context are enforced by the existing
// executor BEFORE the credential callback and official forward conversion.
//
// There is NO production caller, Server-AK resolver, scheduler or HTTP route;
// nothing in Web/Mobile Web/PWA/Desktop can trigger this function.
func executeBaiduPhotoMapIndexOfficialForward(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
	accountPermit baiduGeoconvAccountPermit, serverAK baiduGeoconvPrivateServerAK,
) error {
	return executeBaiduPhotoMapIndexWithTrustedForward(ctx, db, ownerID, assetID,
		accountPermit, serverAK, baidumapjsapi.ForwardWGS84ToBD09)
}

// Test-only sender injection; never exposed through configuration or RPC.
func executeBaiduPhotoMapIndexWithTrustedForward(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
	accountPermit baiduGeoconvAccountPermit,
	serverAK baiduGeoconvPrivateServerAK,
	forward baiduGeoconvPrivateForwardSend,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil || assetID == 0 {
		return denied
	}
	converter, err := baiduGeoconvPrivateForwardConverter(ownerID, accountPermit, serverAK, forward)
	if err != nil {
		return denied
	}
	if err := executeBaiduPhotoMapIndexQuotaAdmitted(
		ctx, db, ownerID, assetID, accountPermit, converter,
	); err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
