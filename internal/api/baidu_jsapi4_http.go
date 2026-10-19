package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

// baiduJSAPI4LiveAuthority is process-private runtime trust provisioned ONLY
// from an independently reviewed deployment release. No Admin/HTTP/Renderer
// input, desired_enabled or Browser AK can create it. The empty source-pinned
// production signer/child inventory in this build keeps it impossible to
// install, even for an administrator with a configured Browser AK.
//
// The cookie key MUST be a separately generated 32-byte secret, persistent
// across authorized Server replicas and never exposed to JSAPI, IPC or logs.
// Revocation is immediate on all requests via ClearBaiduJSAPI4OperatorRelease,
// the signed short TTL and live User/AK/map-epoch validation.
type baiduJSAPI4LiveAuthority struct {
	cookieKey   [32]byte
	attestation baidumapjsapi.JSAPI4ReleaseAttestation
	scope       baidumapjsapi.JSAPI4ReleaseScope
}

func (s *Server) ClearBaiduJSAPI4OperatorRelease() {
	if s != nil {
		s.baiduJSAPI4Authority.Store(nil)
	}
}

// InstallBaiduJSAPI4OperatorRelease is a Server-process provisioning boundary;
// it is NOT a route and there is no caller in the shipped deployment. A future
// trusted operator workflow must independently prove licensed entitlement,
// audited full immutable child graph, CSP/Caddy/Electron/PWA isolation, release
// build/policy scope and real paired Browser+upstream HAR before invoking it.
// The pinned release verifier, not a boolean or desired setting, is decisive.
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
		baidumapjsapi.VerifyPinnedJSAPI4ProductionRelease(
			attestation, expected, time.Now().UTC()) != nil {
		return errBaiduJSAPIResourceDenied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured ||
		cfg.Revision == 0 || cfg.Revision != expected.BrowserAKRevision {
		return errBaiduJSAPIResourceDenied
	}
	next := &baiduJSAPI4LiveAuthority{attestation: attestation, scope: expected}
	copy(next.cookieKey[:], cookieKey)
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
	if p == nil || sha256.Sum256([]byte(s.AllowedOrigin)) != p.scope.TrustedOriginSHA256 ||
		baidumapjsapi.VerifyPinnedJSAPI4ProductionRelease(
			p.attestation, p.scope, time.Now().UTC()) != nil {
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

// Authenticated Owner POST; same-origin Origin + Bearer + current JWT issued-at
// /DB map epoch are independently checked by baiduJSAPIBootstrapCandidate.
// No body, AK or GPS is accepted. Only a source-pinned signed runtime can mint.
func (s *Server) baiduJSAPI4SessionHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	now := time.Now().UTC()
	state, err := s.baiduJSAPIBootstrapCandidate(c.Request.Context(), c.Request, now)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_session_denied"})
		return
	}
	// Only a pinned, verified release and fresh authenticated Owner snapshot
	// can turn the deliberately unauthorized bootstrap candidate into a
	// map-only Cookie; browser-provided runtime_enabled cannot.
	state.RuntimeAuthorized = true
	cookie, err := baidumapjsapi.IssueMapSession(authority.cookieKey[:], state, now)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_session_denied"})
		return
	}
	if s.baiduJSAPI4Authority.Load() != authority {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	http.SetCookie(c.Writer, cookie)
	c.JSON(http.StatusOK, gin.H{
		"provider": "baidu-jsapi-4.0", "runtime_enabled": true,
	})
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
	body, headers, err := s.baiduJSAPI4SignedLiveLoader(c.Request.Context(),
		c.Request, authority.cookieKey[:], authority.attestation, authority.scope)
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
	body, headers, err := s.baiduJSAPI4SignedLiveLoader(c.Request.Context(),
		c.Request, authority.cookieKey[:], authority.attestation, authority.scope)
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
	if headers == nil || headers.Get("Content-Type") != review.MediaType {
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
