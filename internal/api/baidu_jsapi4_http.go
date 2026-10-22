package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

// baiduJSAPI4LiveAuthority holds a short release signed by the durable
// encrypted xDrive installation identity, not a separately configured
// production public key. An incomplete source-reviewed resource inventory
// or disabled Browser AK STILL denies runtime and all map resources.
//
// The cookie key MUST be a separately generated 32-byte secret, persistent
// across authorized Server replicas and never exposed to JSAPI, IPC or logs.
// Revocation is immediate on all requests via ClearBaiduJSAPI4OperatorRelease,
// the signed short TTL and live User/AK/map-epoch validation.
type baiduJSAPI4LiveAuthority struct {
	cookieKey   [32]byte
	attestation atomic.Pointer[baidumapjsapi.JSAPI4ReleaseAttestation]
	scope       baidumapjsapi.JSAPI4ReleaseScope
}

func (s *Server) ClearBaiduJSAPI4OperatorRelease() {
	if s != nil {
		s.baiduJSAPI4Authority.Store(nil)
	}
}

// This Server-only installation boundary verifies the persisted encrypted
// instance identity, cookie key and independently reconstructed current
// build/policy/origin/AK-revision/epoch. Admin/HTTP cannot supply trust.
func (s *Server) InstallBaiduJSAPI4OperatorRelease(
	ctx context.Context, cookieKey []byte,
	attestation baidumapjsapi.JSAPI4ReleaseAttestation,
	expected baidumapjsapi.JSAPI4ReleaseScope,
) error {
	if s == nil || ctx == nil || ctx.Err() != nil || len(cookieKey) != 32 ||
		s.DB == nil || s.ConnectorSecrets == nil {
		return errBaiduJSAPIResourceDenied
	}
	var empty [32]byte
	if bytes.Equal(cookieKey, empty[:]) ||
		sha256.Sum256([]byte(s.AllowedOrigin)) != expected.TrustedOriginSHA256 ||
		s.verifyBaiduJSAPI4ManagedRelease(ctx, attestation, expected, cookieKey) != nil {
		return errBaiduJSAPIResourceDenied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured ||
		cfg.Revision == 0 || cfg.Revision != expected.BrowserAKRevision {
		return errBaiduJSAPIResourceDenied
	}
	// Renewals for an unchanged scope keep the authority pointer stable,
	// avoiding arbitrary cancellations and map frame jitter on each renewal.
	previous := s.baiduJSAPI4Authority.Load()
	if previous != nil && previous.scope == expected && bytes.Equal(previous.cookieKey[:], cookieKey) {
		previous.attestation.Store(&attestation)
		return nil
	}
	next := &baiduJSAPI4LiveAuthority{scope: expected}
	copy(next.cookieKey[:], cookieKey)
	next.attestation.Store(&attestation)
	s.baiduJSAPI4Authority.Store(next)
	return nil
}

// Every resource and session request reloads the desired encrypted AK's
// revision, trusts ONLY the configured HTTPS Server origin, and verifies the
// current signed release. Old proofs and rotated AKs stop working instantly.
// This deliberately does not accept proof/scope/key from a request.
func (s *Server) currentBaiduJSAPI4OperatorRelease(
	ctx context.Context,
) (*baiduJSAPI4LiveAuthority, error) {
	if s == nil || ctx == nil || ctx.Err() != nil ||
		s.DB == nil || s.ConnectorSecrets == nil {
		return nil, errBaiduJSAPIResourceDenied
	}
	p := s.baiduJSAPI4Authority.Load()
	if p == nil || sha256.Sum256([]byte(s.AllowedOrigin)) != p.scope.TrustedOriginSHA256 {
		return nil, errBaiduJSAPIResourceDenied
	}
	proof := p.attestation.Load()
	if proof == nil || s.verifyBaiduJSAPI4ManagedRelease(
		ctx, *proof, p.scope, p.cookieKey[:]) != nil {
		return nil, errBaiduJSAPIResourceDenied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured ||
		cfg.Revision != p.scope.BrowserAKRevision {
		return nil, errBaiduJSAPIResourceDenied
	}
	return p, nil
}

func baiduJSAPI4NoStore(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
}

// Legacy Gallery-origin map Cookie mint is permanently denied. A trusted
// Gallery document may mint only a single-use, short-lived MAP-ONLY ticket.
// The separately hosted HTTPS Child redeems it; no same-document provider
// JavaScript, Gallery Cookie or parent JWT can acquire a map session here.
// Keep this route for explicit fail-closed responses to older clients.
func (s *Server) baiduJSAPI4SessionHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_required"})
}

// Every JSAPI4 provider serviceHost request is dispatched to its independently
// checked Loader or bounded child handler. The catch-all route itself grants
// NO authority, no new provider Host and no unchecked response passthrough.
func (s *Server) baiduJSAPI4RuntimeResourceHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	child := s.approvedBaiduIsolatedChildOrigin()
	if child == "" || c.Request.Host != strings.TrimPrefix(child, "https://") {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	if c.Request.URL.Path == baidumapjsapi.LoaderPath {
		s.baiduJSAPI4LoaderHTTP(c)
		return
	}
	s.baiduJSAPI4ChildHTTP(c)
}

// Map JS/tiles cannot supply a Bearer header. This exact Loader GET uses
// ONLY the encrypted, host-only HttpOnly map Cookie and rechecks the same
// trusted signed release, current Owner/session/epoch/AK revision, quotas,
// fixed Baidu TLS upstream and raw response limits. Unknown child paths have
// NO Gin route and Caddy must never proxy them straight to Baidu.
func (s *Server) baiduJSAPI4LoaderHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	proof := authority.attestation.Load()
	if proof == nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	body, headers, err := s.baiduJSAPI4SignedLiveLoader(c.Request.Context(),
		c.Request, authority.cookieKey[:], *proof, authority.scope)
	if err != nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	defer clear(body)
	// Kill-switch, AK rotation or signed-release expiry during the upstream
	// request must discard the otherwise valid JS bytes before writing.
	if s.baiduJSAPI4Authority.Load() != authority {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	if current, checkErr := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context()); checkErr != nil || current != authority {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	for name, values := range headers {
		for _, value := range values {
			c.Writer.Header().Add(name, value)
		}
	}
	c.Data(http.StatusOK, "application/javascript; charset=utf-8", body)
}

// This handler can be registered ONLY at a source-approved, exact child path.
// There is no /_BMapService/* catch-all: until private entitlement/HAR review
// establishes the immutable manifest the real Router registers ZERO children.
// Cookie, release, quota, Browser AK revision and Owner are all rechecked
// before returning any bytes, using the same Server transport as the Loader.
func (s *Server) baiduJSAPI4ChildHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	review, err := baidumapjsapi.ReviewJSAPI4ResourceRequest(c.Request)
	if err != nil || review.Kind != baidumapjsapi.JSAPI4ResourceChild {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	proof := authority.attestation.Load()
	if proof == nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	body, headers, err := s.baiduJSAPI4SignedLiveLoader(c.Request.Context(),
		c.Request, authority.cookieKey[:], *proof, authority.scope)
	if err != nil {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	defer clear(body)
	if s.baiduJSAPI4Authority.Load() != authority {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	if current, checkErr := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context()); checkErr != nil || current != authority {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	if headers == nil || !baidumapjsapi.JSAPI4AllowedProviderMediaType(headers.Get("Content-Type")) ||
		(review.MediaType != "" && headers.Get("Content-Type") != review.MediaType) {
		c.String(http.StatusServiceUnavailable, "map resource unavailable")
		return
	}
	for name, values := range headers {
		for _, value := range values {
			c.Writer.Header().Add(name, value)
		}
	}
	c.Data(http.StatusOK, review.MediaType, body)
}
