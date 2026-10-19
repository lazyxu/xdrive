package api

import (
	"context"
	"crypto/subtle"
	"mime"
	"net/http"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// baiduJSAPI4OfflineLoaderSend is an OFFLINE TEST seam. The sole future
// production transport must be independently reviewed and use the pinned
// upstream, no-redirect/no-env-proxy client after an actual signed release.
// No current Server router, startup task, Agent IPC or Renderer invokes it.
type baiduJSAPI4OfflineLoaderSend func(*http.Request) (*http.Response, error)

// baiduJSAPI4OfflineLoaderCandidate composes the existing STRICT Loader
// envelope, CURRENT encrypted Browser AK, PostgreSQL Fleet+Owner quota and
// flight capacity, fixed upstream plan and bounded AK-safe response checks.
//
// This is NOT a production JSAPI4 Loader handler. A trusted state and gate
// booleans can be supplied only by isolated tests today. Real bootstrap
// and resource snapshots ALWAYS set RuntimeAuthorized=false, and the actual
// code-owned JSAPI4ProductionResourceGate denies unconditionally until a
// reviewed complete child-resource inventory and trusted release exist.
// Neither an administrative desired-enable nor a synthetic all-true fixture
// can activate a route or send any real Baidu request.
func (s *Server) baiduJSAPI4OfflineLoaderCandidate(
	ctx context.Context, inbound *http.Request,
	state baidumapjsapi.MapSessionState, gates baidumapjsapi.ReleaseGates,
	send baiduJSAPI4OfflineLoaderSend,
) ([]byte, http.Header, error) {
	denied := errBaiduJSAPIResourceDenied
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil ||
		ctx == nil || ctx.Err() != nil || inbound == nil ||
		inbound.Context().Err() != nil || send == nil ||
		!gates.Ready() || !state.RuntimeAuthorized || !state.AccountActive ||
		state.OwnerID == 0 || state.OwnerID > baiduJSAPIQuotaMaxOwnerID ||
		!baidumapjsapi.SessionResourceRequest(inbound, s.AllowedOrigin) {
		return nil, nil, denied
	}
	review, err := baidumapjsapi.ReviewJSAPI4ResourceRequest(inbound)
	if err != nil {
		return nil, nil, denied
	}
	// The Server-configured HTTPS origin is the only source for the provider
	// required BMAP_PROXY_URL. Never consult Host, Origin or Forwarded input.
	if _, err := baidumapjsapi.TrustedProxyBase(s.AllowedOrigin); err != nil {
		return nil, nil, denied
	}
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	privateDB := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})

	// Cross-replica in-flight slots are taken BEFORE decrypted AK access or
	// any future upstream work and held through complete response validation.
	lease, err := acquireBaiduJSAPILoaderFlight(runCtx, privateDB, state.OwnerID)
	if err != nil {
		return nil, nil, denied
	}
	defer func() {
		// The caller's Context may already be canceled. The digest is
		// owner-bound; a stale release cannot free a different request.
		cleanupCtx, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = releaseBaiduJSAPILoaderFlight(cleanupCtx, privateDB, lease)
	}()
	if runCtx.Err() != nil || inbound.Context().Err() != nil {
		return nil, nil, denied
	}
	ak, err := s.currentBaiduJSAPIBrowserAKCandidate(runCtx, state)
	if err != nil || ak == "" || runCtx.Err() != nil {
		return nil, nil, denied
	}
	// Reserve the full 2 MiB response budget even when validation rejects
	// or the client cancels. Never refund a potentially sent request.
	if reserveBaiduJSAPILoaderQuota(runCtx, privateDB, state.OwnerID) != nil {
		return nil, nil, denied
	}
	var outbound *http.Request
	if review.Kind == baidumapjsapi.JSAPI4ResourceChild {
		outbound, err = baidumapjsapi.NewApprovedJSAPI4ChildRequest(
			runCtx, s.AllowedOrigin, ak, inbound, gates)
	} else if review.Kind == baidumapjsapi.JSAPI4ResourceLoader {
		outbound, err = baidumapjsapi.NewLoaderRequest(
			runCtx, s.AllowedOrigin, ak, gates)
	} else {
		return nil, nil, denied
	}
	if err != nil || runCtx.Err() != nil || inbound.Context().Err() != nil {
		return nil, nil, denied
	}
	// Only the immutable pinned Baidu HTTPS Loader URL, not a client URL,
	// enters this synthetic sender. No AK, Cookie or upstream URL leaves
	// this Server-private function in any returned error or headers.
	response, sendErr := send(outbound)
	if response != nil && response.Body != nil {
		defer response.Body.Close()
	}
	if sendErr != nil || response == nil || runCtx.Err() != nil ||
		inbound.Context().Err() != nil {
		return nil, nil, denied
	}
	var body []byte
	if review.Kind == baidumapjsapi.JSAPI4ResourceChild {
		// The provider returns different, strictly allowed JS/CSS/tile/font/
		// binary media from the same serviceHost family. Normalize MIME in
		// trusted Server memory; never forward the raw upstream Content-Type.
		if review.MediaType == "" {
			mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
			if parseErr != nil || !baidumapjsapi.JSAPI4AllowedProviderMediaType(mediaType) {
				return nil, nil, denied
			}
			review.MediaType = mediaType
		}
		body, err = baidumapjsapi.CheckApprovedJSAPI4ChildResponse(response, ak, review)
	} else {
		body, err = baidumapjsapi.CheckLoaderResponse(response, ak)
	}
	if err != nil {
		return nil, nil, denied
	}
	// A second CURRENT cross-replica Owner/session/map-epoch/Browser AK read
	// catches revocation or credential rotation during upstream work. A
	// late rejection must not return even the already checked JS bytes.
	latestAK, err := s.currentBaiduJSAPIBrowserAKCandidate(runCtx, state)
	if err != nil || subtle.ConstantTimeCompare([]byte(ak), []byte(latestAK)) != 1 ||
		runCtx.Err() != nil || inbound.Context().Err() != nil {
		clear(body)
		return nil, nil, denied
	}
	headers := baidumapjsapi.LoaderResponseHeaders()
	if review.Kind == baidumapjsapi.JSAPI4ResourceChild {
		headers = baidumapjsapi.ApprovedJSAPI4ChildResponseHeaders(review)
	}
	if headers == nil {
		clear(body)
		return nil, nil, denied
	}
	return body, headers, nil
}
