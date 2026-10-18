package api

import (
	"context"
	"net/http"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

// baiduJSAPI4SignedLiveLoader is the REAL HTTP transport composition, distinct
// from the old offline injected-sender tests. It never treats a Browser AK,
// operator desired_enabled, test-only ReleaseGates booleans or a synthetic
// RuntimeAuthorized flag as authorization.
//
// Preconditions:
//   - Independently reviewed and source-pinned COMPLETE JSAPI4 child inventory.
//   - A trusted production Ed25519 operator root and fresh signed release,
//     bound to the current build/policy/trusted origin/AK revision/epoch.
//   - The caller independently derives the expected scope from CURRENT Server
//     state (not from HTTP arguments) and supplies an installation-persistent,
//     Server-only >=32 byte map Cookie key.
//   - All map resource paths are code-allowlisted and Owner/session/cookie
//     proofs are verified anew on every request.
//
// There is intentionally NO public Router binding or session issuer until
// those external authorizations and all child JS/tile/font/WASM shapes pass
// real Browser+upstream HAR and three-platform review. In the shipped build
// the pinned production key and reviewed child inventory remain EMPTY, so
// this method fails before any Browser AK access, network or quota charge.
func (s *Server) baiduJSAPI4SignedLiveLoader(
	ctx context.Context, request *http.Request, cookieKey []byte,
	release baidumapjsapi.JSAPI4ReleaseAttestation,
	currentScope baidumapjsapi.JSAPI4ReleaseScope,
) ([]byte, http.Header, error) {
	denied := errBaiduJSAPIResourceDenied
	if s == nil || ctx == nil || ctx.Err() != nil || request == nil ||
		request.Context().Err() != nil || len(cookieKey) < 32 {
		return nil, nil, denied
	}
	// The existing hard-closed legacy boolean guard is NOT release proof.
	// Only this scoped signed authority path can ever reach real transport.
	now := time.Now().UTC()
	if baidumapjsapi.VerifyPinnedJSAPI4ProductionRelease(
		release, currentScope, now) != nil {
		return nil, nil, denied
	}
	if _, err := baidumapjsapi.ReviewJSAPI4ResourceRequest(request); err != nil {
		return nil, nil, denied
	}
	state, err := s.baiduJSAPIResourceSnapshot(ctx, request,
		s.AllowedOrigin, cookieKey, now)
	if err != nil {
		return nil, nil, denied
	}
	cookie, err := request.Cookie(baidumapjsapi.MapCookieName)
	if err != nil || cookie == nil {
		return nil, nil, denied
	}
	// The snapshot authenticates the encrypted Cookie's Owner and rereads
	// CURRENT DB account/session/config/epoch, but deliberately cannot enable
	// runtime on its own. Promote only after the signed production release.
	state.RuntimeAuthorized = true
	if baidumapjsapi.VerifyMapSession(cookieKey, cookie.Value, state, now) != nil {
		return nil, nil, denied
	}
	// All five flags are derived here ONLY after the signed release, reviewed
	// route and fresh map-only cookie; none are caller-supplied. Any later
	// license/child/revocation rejection must keep the whole release disabled.
	reviewed := baidumapjsapi.ReleaseGates{
		Licensed: true, ObservedResourceInventory: true,
		RawLeakAudit: true, OwnerSessionAndFleetQuota: true,
		PlatformIsolation: true,
	}
	// Real network transport: strict fixed Baidu HTTPS Loader, Server-private
	// Browser AK injection, no env proxy, no redirect, bounded response,
	// cross-replica PostgreSQL owner/fleet quota/flight and ctx cancellation.
	// The private composition rechecks the CURRENT owner/epoch/AK revision
	// after the HTTP call before a single byte can be exposed downstream.
	client := baidumapjsapi.SafeHTTPClient()
	return s.baiduJSAPI4OfflineLoaderCandidate(
		ctx, request, state, reviewed, client.Do)
}
