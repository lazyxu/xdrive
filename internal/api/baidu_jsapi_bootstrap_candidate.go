package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

var errBaiduJSAPIBootstrapCandidateDenied = errors.New("map bootstrap candidate unavailable")

// baiduJSAPIBootstrapCandidate verifies the REAL, current Server-side identity,
// independent Browser AK desired-config revision, and durable map revocation
// epoch for a future map-only POST. It NEVER mints a Cookie, decrypts AK,
// enables JSAPI4, makes a network call, or authenticates map resource traffic.
//
// An authenticated *candidate* is NOT an approved JSAPI4 runtime. The current
// pinned release root, licensed complete child inventory, origin isolation,
// fleet quota and upstream/browser HAR proofs are not available. Consequently,
// RuntimeAuthorized is ALWAYS false and IssueMapSession MUST refuse this state.
//
// The only permitted trusted origin is the Server's own configured HTTPS
// origin; never an Origin, Host, X-Forwarded-Host, or caller-supplied fallback.
func (s *Server) baiduJSAPIBootstrapCandidate(
	ctx context.Context, req *http.Request, now time.Time,
) (baidumapjsapi.MapSessionState, error) {
	denied := errBaiduJSAPIBootstrapCandidateDenied
	var empty baidumapjsapi.MapSessionState
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil ||
		ctx == nil || ctx.Err() != nil || req == nil || req.Context().Err() != nil ||
		req.URL == nil || req.URL.IsAbs() || req.URL.Host != "" ||
		req.URL.RawPath != "" || req.URL.Opaque != "" || req.URL.User != nil ||
		req.URL.EscapedPath() != "/api/v1/media/places/baidu-jsapi/session" ||
		req.URL.ForceQuery || req.URL.Fragment != "" ||
		now.IsZero() || now.UnixNano() <= 0 ||
		!baidumapjsapi.SessionBootstrapSameOrigin(req, s.AllowedOrigin) ||
		req.ContentLength != 0 || len(req.TransferEncoding) != 0 {
		return empty, denied
	}

	// Require a single real login Bearer. This is the POST access token, not
	// a map-only Cookie or credential supplied in URL/query/request body.
	authorizations := req.Header.Values("Authorization")
	if len(authorizations) != 1 || !strings.HasPrefix(authorizations[0], "Bearer ") {
		return empty, denied
	}
	bearer := strings.TrimPrefix(authorizations[0], "Bearer ")
	if bearer == "" || len(bearer) > 4096 ||
		strings.ContainsAny(bearer, " \t\r\n,") {
		return empty, denied
	}
	access, epoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, now)
	if err != nil || access.UserID == 0 || access.SessionVersion == 0 || epoch.Epoch == 0 {
		return empty, denied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured || cfg.Revision == 0 {
		return empty, denied
	}
	return baidumapjsapi.MapSessionState{
		OwnerID:               access.UserID,
		SessionVersion:        access.SessionVersion,
		ConfigurationRevision: cfg.Revision,
		RevocationEpoch:       epoch.Epoch,
		AccountActive:         true,
		RuntimeAuthorized:     false, // Hard NO-GO until real signed release review.
	}, nil
}
