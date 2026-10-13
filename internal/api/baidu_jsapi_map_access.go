package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
)

var errBaiduMapBootstrapDenied = errors.New("map session bootstrap unavailable")

// verifiedMapBootstrapIdentity is an INTERNAL authenticated prerequisite for
// future map-only cookie issuance. It does not assert entitlement, live JSAPI
// runtime, safe upstream proxy, per-user quota or map-client isolation.
// There is deliberately no public Session or JSAPI resource route in this phase.
func (s *Server) verifiedMapBootstrapIdentity(ctx context.Context, bearer string, now time.Time) (auth.MapAccess, meta.BaiduJSAPIMapEpoch, error) {
	denied := errBaiduMapBootstrapDenied
	if s == nil || s.DB == nil || ctx == nil || now.IsZero() {
		return auth.MapAccess{}, meta.BaiduJSAPIMapEpoch{}, denied
	}
	access, err := s.Auth.ParseMapAccess(bearer, now)
	if err != nil {
		return auth.MapAccess{}, meta.BaiduJSAPIMapEpoch{}, denied
	}
	var user meta.User
	err = s.DB.WithContext(ctx).Select("id", "session_version", "disabled_at", "must_change_password").
		Where("id = ?", access.UserID).Take(&user).Error
	if err != nil || user.ID != access.UserID || user.DisabledAt != nil || user.MustChangePassword ||
		user.SessionVersion == 0 || user.SessionVersion != access.SessionVersion {
		return auth.MapAccess{}, meta.BaiduJSAPIMapEpoch{}, denied
	}
	epoch, err := loadBaiduMapEpoch(ctx, s.DB, access.UserID)
	if err != nil || !baidumapjsapi.AccessAfterRevocation(access.IssuedAt, now, epoch.RevokedAfter) {
		return auth.MapAccess{}, meta.BaiduJSAPIMapEpoch{}, denied
	}
	return access, epoch, nil
}
