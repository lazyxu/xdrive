package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
)

const (
	baiduMapVerifyDelay    = 30 * time.Second
	baiduMapVerifyMaxBytes = 2 << 20
	baiduMapVerifyPixels   = 128
)

type adminBaiduMapVerifyDTO struct {
	State         string    `json:"state"`
	Revision      uint64    `json:"revision"`
	CheckedAt     time.Time `json:"checked_at"`
	ImageVerified bool      `json:"image_verified"`
	Detail        string    `json:"detail"`
}

// One explicit admin request consumes one real map API call.
// This is current-instance, current-revision evidence, not a durable health lease.
func (s *Server) adminVerifyBaiduMap(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Baidu map audit unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "current Baidu map revision required")
		return
	}

	s.baiduMapVerifyMu.Lock()
	defer s.baiduMapVerifyMu.Unlock()
	cfg, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Baidu map configuration unavailable")
		return
	}
	if cfg.Revision != *input.Revision || !cfg.Enabled || !cfg.Configured || cfg.AK == "" {
		fail(c, http.StatusConflict, "Baidu map revision or enabled state changed; refresh")
		return
	}
	if !s.baiduMapVerifyAt.IsZero() && time.Since(s.baiduMapVerifyAt) < baiduMapVerifyDelay {
		c.Header("Retry-After", "30")
		fail(c, http.StatusTooManyRequests, "Baidu map verification is temporarily rate limited")
		return
	}
	// No network call without a committed, metadata-only audit.
	if err := recordAuditTx(s.DB.WithContext(c.Request.Context()), auditEventFromContext(
		c, "admin.service.baidu_map.verify", "service", baiduMapSecretName,
		"Baidu Static Map current revision live image verification", auditpkg.ResultSuccess,
		map[string]any{"revision": cfg.Revision, "source": cfg.Source, "online": true},
	)); err != nil {
		fail(c, http.StatusServiceUnavailable, "Baidu map verification audit unavailable")
		return
	}
	s.baiduMapVerifyAt = time.Now()
	state := s.baiduMapLiveVerify(c.Request.Context(), cfg.AK)
	latest, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Baidu map post-probe revision check unavailable")
		return
	}
	if latest.Revision != cfg.Revision || !latest.Enabled || !latest.Configured ||
		subtle.ConstantTimeCompare([]byte(latest.AK), []byte(cfg.AK)) != 1 {
		fail(c, http.StatusConflict, "Baidu map configuration changed during verification")
		return
	}
	detail := "地图在线接口不可确认，尚未验证当前 AK。"
	if state == "verified" {
		detail = "当前 Server 使用此修订 AK 获取并解析了真实百度静态图；并非所有实例或未来调用的保证。"
	} else if state == "denied" {
		detail = "百度接口拒绝此次请求；请检查 AK 权限、出口 IP 白名单和静态地图服务额度。"
	}
	c.JSON(http.StatusOK, adminBaiduMapVerifyDTO{
		State: state, Revision: cfg.Revision, CheckedAt: time.Now().UTC(),
		ImageVerified: state == "verified", Detail: detail,
	})
}

func (s *Server) baiduMapLiveVerify(ctx context.Context, ak string) string {
	endpoint, err := url.Parse(baiduStaticMapURL)
	if err != nil {
		return "unavailable"
	}
	query := endpoint.Query()
	query.Set("ak", ak)
	query.Set("center", "116.407400,39.904200") // Constant public test coordinate, never user GPS.
	query.Set("markers", "116.407400,39.904200")
	query.Set("coordtype", "wgs84ll")
	query.Set("zoom", "10")
	query.Set("width", strconv.Itoa(baiduMapVerifyPixels))
	query.Set("height", strconv.Itoa(baiduMapVerifyPixels))
	query.Set("scaler", "1")
	endpoint.RawQuery = query.Encode()
	ctx, cancel := context.WithTimeout(ctx, baiduMapTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "unavailable"
	}
	client := http.Client{
		Timeout: baiduMapTimeout,
		Transport: &http.Transport{
			Proxy: nil, DisableKeepAlives: true,
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
	}
	if s.BaiduMapHTTPClient != nil {
		client = *s.BaiduMapHTTPClient
	}
	client.Timeout = baiduMapTimeout
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	res, err := client.Do(req)
	if err != nil {
		return "unavailable"
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return "denied"
	}
	if res.StatusCode != http.StatusOK ||
		!strings.EqualFold(strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]), "image/png") {
		return "unavailable"
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, baiduMapVerifyMaxBytes+1))
	if err != nil || len(data) > baiduMapVerifyMaxBytes || !bytes.HasPrefix(data, baiduPNGHeader) {
		return "unavailable"
	}
	header, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || header.Width != baiduMapVerifyPixels || header.Height != baiduMapVerifyPixels {
		return "unavailable"
	}
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		return "unavailable"
	}
	return "verified"
}
