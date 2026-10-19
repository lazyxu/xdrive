package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
)

var errBaiduJSAPIResourceDenied = errors.New("map resource unavailable")

// baiduJSAPIResourceSnapshot is a private, read-only preflight for a future
// same-origin map resource proxy. It decrypts the narrowly-scoped cookie to
// identify the owner, then reloads trusted user, encrypted-config metadata and
// map-revocation state for every request. This NEVER authorizes runtime: the
// final release approval, strict upstream allowlist and per-owner fleet quota
// are unavailable, and RuntimeAuthorized is deliberately always false.
// No router invokes this helper in the current phase.
func (s *Server) baiduJSAPIResourceSnapshot(ctx context.Context, req *http.Request, origin string, cookieKey []byte, now time.Time) (baidumapjsapi.MapSessionState, error) {
	denied := errBaiduJSAPIResourceDenied
	if s == nil || s.DB == nil || ctx == nil || req == nil || now.IsZero() ||
		!baidumapjsapi.SessionResourceRequest(req, origin) {
		return baidumapjsapi.MapSessionState{}, denied
	}
	// A future source-reviewed child uses the SAME Owner Cookie and revision
	// fence as the Loader, never a route-specific bypass.
	if _, reviewErr := baidumapjsapi.ReviewJSAPI4ResourceRequest(req); reviewErr != nil {
		return baidumapjsapi.MapSessionState{}, denied
	}
	// Reject ambiguous Cookie headers; never select a "first" valid identity
	// while allowing an attacker to set a second cookie of the same name.
	count := 0
	var value string
	for _, cookie := range req.Cookies() {
		if cookie.Name == baidumapjsapi.MapCookieName {
			count++
			value = cookie.Value
		}
	}
	if count != 1 {
		return baidumapjsapi.MapSessionState{}, denied
	}
	owner, err := baidumapjsapi.InspectMapSessionOwner(cookieKey, value, now)
	if err != nil {
		return baidumapjsapi.MapSessionState{}, denied
	}
	var user meta.User
	if err := s.DB.WithContext(ctx).Select("id", "session_version", "disabled_at", "must_change_password").Where("id = ?", owner).Take(&user).Error; err != nil || user.ID != owner || user.SessionVersion == 0 || user.DisabledAt != nil || user.MustChangePassword {
		return baidumapjsapi.MapSessionState{}, denied
	}
	epoch, err := loadBaiduMapEpoch(ctx, s.DB, owner)
	if err != nil {
		return baidumapjsapi.MapSessionState{}, denied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured || cfg.Revision == 0 {
		return baidumapjsapi.MapSessionState{}, denied
	}
	// Only metadata and a denial-state are returned. No key plaintext, bearer,
	// filename, GPS or external upstream request is ever accessed here.
	return baidumapjsapi.MapSessionState{
		OwnerID:               owner,
		SessionVersion:        user.SessionVersion,
		ConfigurationRevision: cfg.Revision,
		RevocationEpoch:       epoch.Epoch,
		AccountActive:         true,
		RuntimeAuthorized:     false,
	}, nil
}
