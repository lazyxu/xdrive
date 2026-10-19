package api

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A3d1 is an explicit ADMIN-ONLY one-shot Browser AK/Loader health probe.
// It does not grant permission to execute JS, install a map session, return
// script bytes, enumerate tiles, or change runtime_enabled / release gates.
const baiduJSAPI4ProbeDelay = 30 * time.Second

type adminJSAPI4LoaderProbeDTO struct {
	State          string    `json:"state"`
	Revision       uint64    `json:"revision"`
	CheckedAt      time.Time `json:"checked_at"`
	LoaderAccepted bool      `json:"loader_accepted"`
	RuntimeEnabled bool      `json:"runtime_enabled"`
	Detail         string    `json:"detail"`
}

// Only an authenticated admin route may invoke this handler. A probe consumes
// one possible provider API request; audit must commit BEFORE any AK is opened
// or a request is sent. No parameter can supply a URL, coordinate, AK or proxy.
func (s *Server) adminVerifyBaiduJSAPI4Loader(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "JSAPI4 verification is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		*input.Revision == 0 || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "current Browser AK revision required")
		return
	}
	s.baiduJSAPIProbeMu.Lock()
	defer s.baiduJSAPIProbeMu.Unlock()
	cfg, err := s.baiduJSAPIDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "JSAPI4 config unavailable")
		return
	}
	if !cfg.DesiredEnabled || !cfg.Configured || cfg.Revision != *input.Revision {
		fail(c, http.StatusConflict, "Browser AK revision or desired state changed")
		return
	}
	if _, err := baidumapjsapi.TrustedProxyBase(s.AllowedOrigin); err != nil {
		fail(c, http.StatusConflict, "trusted HTTPS origin is invalid")
		return
	}
	if !s.baiduJSAPIProbeAt.IsZero() && time.Since(s.baiduJSAPIProbeAt) < baiduJSAPI4ProbeDelay {
		c.Header("Retry-After", "30")
		fail(c, http.StatusTooManyRequests, "JSAPI4 manual verification is rate limited")
		return
	}
	if err := recordAuditTx(s.DB.WithContext(c.Request.Context()), auditEventFromContext(c,
		"admin.service.baidu_jsapi.verify_loader", "service", baiduJSAPISecretName,
		"Baidu JSAPI4 private fixed Loader one-shot attempt", auditpkg.ResultSuccess,
		map[string]any{"revision": cfg.Revision, "probe": "loader_only", "provider_request": true},
	)); err != nil {
		fail(c, http.StatusServiceUnavailable, "JSAPI4 probe audit unavailable")
		return
	}
	s.baiduJSAPIProbeAt = time.Now()

	var row meta.AdminServiceSecret
	if err := s.DB.WithContext(c.Request.Context()).Where("name = ?", baiduJSAPISecretName).Take(&row).Error; err != nil ||
		!row.Enabled || row.Revision != cfg.Revision || row.KeyVersion == 0 || len(row.Ciphertext) == 0 {
		fail(c, http.StatusConflict, "Browser AK changed before verification")
		return
	}
	secret, err := s.ConnectorSecrets.Open(
		baiduJSAPISecretAADID, baiduJSAPISecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil || len(secret) == 0 || len(secret) > maxBaiduMapAKBytes {
		clear(secret)
		fail(c, http.StatusServiceUnavailable, "encrypted Browser AK unavailable")
		return
	}
	defer clear(secret)
	for _, char := range secret {
		if char < '!' || char > '~' {
			fail(c, http.StatusServiceUnavailable, "encrypted Browser AK invalid")
			return
		}
	}

	// Never pass or return Browser AK via the browser. This bounded request
	// evaluates ONLY a fixed upstream JS envelope, not all JSAPI4 resources.
	state := checkFixedBaiduJSAPI4Loader(c.Request.Context(), s.AllowedOrigin, string(secret),
		s.BaiduJSAPIProbeHTTPClient)
	latest, err := s.baiduJSAPIDesired(c.Request.Context())
	if err != nil || !latest.Configured || !latest.DesiredEnabled || latest.Revision != cfg.Revision {
		fail(c, http.StatusConflict, "Browser AK changed during verification")
		return
	}
	var current meta.AdminServiceSecret
	if err := s.DB.WithContext(c.Request.Context()).Where("name = ?", baiduJSAPISecretName).Take(&current).Error; err != nil ||
		current.Revision != row.Revision || current.KeyVersion != row.KeyVersion ||
		subtle.ConstantTimeCompare(current.Ciphertext, row.Ciphertext) != 1 {
		fail(c, http.StatusConflict, "Browser AK rotated during verification")
		return
	}
	detail := "当前 Server 未能验证百度 JSAPI4 Loader 响应；不能据此判断动态地图健康。"
	switch state {
	case "loader_accepted":
		detail = "固定百度 JSAPI4 Loader 的 HTTPS 响应包络通过校验；不代表子资源、地图交互或生产发布已授权。"
	case "denied":
		detail = "百度拒绝这次固定 Loader 请求；请核查 Browser AK 的 JSAPI 权限和域名限制。"
	}
	c.JSON(http.StatusOK, adminJSAPI4LoaderProbeDTO{
		State: state, Revision: cfg.Revision, CheckedAt: time.Now().UTC(),
		LoaderAccepted: state == "loader_accepted", RuntimeEnabled: false,
		Detail: detail,
	})
}

// A direct, deliberately fixed provider request, never an open proxy. This
// audit-only canary does NOT invoke JSAPI4 release gates because it neither
// issues a map Cookie nor relays executable bytes to any client. It cannot
// be used to discover or approve arbitrary child-resource paths.
func checkFixedBaiduJSAPI4Loader(ctx context.Context, origin, ak string, injected *http.Client) string {
	if ctx == nil || ctx.Err() != nil || len(ak) == 0 {
		return "unavailable"
	}
	proxyBase, err := baidumapjsapi.TrustedProxyBase(origin)
	if err != nil {
		return "unavailable"
	}
	endpoint, err := url.Parse(baidumapjsapi.UpstreamLoader)
	if err != nil {
		return "unavailable"
	}
	endpoint.RawQuery = url.Values{"v": {"4.0"}, "ak": {ak}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "unavailable"
	}
	// The saved Browser AK uses its registered Referer whitelist even from
	// a Server-only probe. Never reflect inbound Origin, Referer or Host.
	req.Header.Set("Referer", origin+"/")
	req.Header.Set("BMAP_PROXY_URL", proxyBase)
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Accept", "application/javascript, text/javascript")
	client := baidumapjsapi.SafeHTTPClient()
	if injected != nil {
		// Controlled test transport only; the deployed Server never sets it.
		client = injected
	}
	// Always reject redirects, even with a caller-supplied test client.
	noRedirect := *client
	noRedirect.Timeout = 5 * time.Second
	noRedirect.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	res, err := noRedirect.Do(req)
	if err != nil {
		return "unavailable"
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return "denied"
	}
	body, err := baidumapjsapi.CheckLoaderResponse(res, ak)
	defer clear(body)
	if err != nil {
		return "unavailable"
	}
	return "loader_accepted"
}
