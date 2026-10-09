package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	baiduStaticMapURL = "https://api.map.baidu.com/staticimage/v2"
	baiduMapMaxBytes  = 3 << 20
	baiduMapTimeout   = 5 * time.Second
)

// A private per-owner throttle prevents browser zoom/refresh loops from exhausting
// a Server AK. These counters are local to this Server process; shared deployments
// must additionally configure an upstream/account quota.
type baiduMapWindow struct {
	start time.Time
	used  int
}
type baiduMapLimiter struct {
	mu      sync.Mutex
	windows map[uint64]baiduMapWindow
}

func (l *baiduMapLimiter) allow(owner uint64, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = make(map[uint64]baiduMapWindow)
	}
	if len(l.windows) > 4096 {
		for key, item := range l.windows {
			if now.Sub(item.start) > time.Minute {
				delete(l.windows, key)
			}
		}
	}
	item := l.windows[owner]
	if item.start.IsZero() || now.Sub(item.start) >= time.Minute {
		item = baiduMapWindow{start: now}
	}
	if item.used >= 30 {
		return false
	}
	item.used++
	l.windows[owner] = item
	return true
}

var baiduMapInFlight = make(chan struct{}, 3)
var baiduPNGHeader = []byte("\x89PNG\r\n\x1a\n")

type baiduMapStatusDTO struct {
	Provider    string `json:"provider"`
	Enabled     bool   `json:"enabled"`
	Attribution string `json:"attribution"`
	Privacy     string `json:"privacy"`
}

// mediaMapProviderStatus does not reveal the Server AK, any signed URL, or
// whether an individual user has GPS-tagged photos.
func (s *Server) mediaMapProviderStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "baidu map configuration is unavailable")
		return
	}
	c.JSON(http.StatusOK, baiduMapStatusDTO{
		Provider:    "baidu-server-static",
		Enabled:     cfg.Enabled && cfg.Configured,
		Attribution: "© 百度地图",
		Privacy:     "启用后，用户查看百度地图时，该坐标将发送至百度地图服务",
	})
}

func parseBaiduMapCenter(q url.Values) (lat, lng float64, zoom, width, height int, valid bool) {
	var err error
	lat, err = strconv.ParseFloat(strings.TrimSpace(q.Get("lat")), 64)
	if err != nil || math.IsNaN(lat) || math.IsInf(lat, 0) || lat < -85 || lat > 85 {
		return
	}
	lng, err = strconv.ParseFloat(strings.TrimSpace(q.Get("lng")), 64)
	if err != nil || math.IsNaN(lng) || math.IsInf(lng, 0) || lng < -180 || lng > 180 {
		return
	}
	zoom, err = strconv.Atoi(strings.TrimSpace(q.Get("zoom")))
	if err != nil || zoom < 3 || zoom > 18 {
		return
	}
	width, err = strconv.Atoi(strings.TrimSpace(q.Get("width")))
	if err != nil || width < 128 || width > 512 {
		return
	}
	height, err = strconv.Atoi(strings.TrimSpace(q.Get("height")))
	if err != nil || height < 128 || height > 512 {
		return
	}
	valid = true
	return
}

func (s *Server) mediaBaiduStaticMap(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	cfg, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "baidu map configuration is unavailable")
		return
	}
	if !cfg.Enabled || !cfg.Configured {
		fail(c, http.StatusServiceUnavailable, "baidu map is not configured")
		return
	}
	lat, lng, zoom, width, height, valid := parseBaiduMapCenter(c.Request.URL.Query())
	if !valid {
		fail(c, http.StatusBadRequest, "invalid map coordinates or size")
		return
	}
	if !s.baiduMapLimiter.allow(userID(c), time.Now()) {
		c.Header("Retry-After", "60")
		fail(c, http.StatusTooManyRequests, "map request quota exceeded")
		return
	}
	select {
	case baiduMapInFlight <- struct{}{}:
		defer func() { <-baiduMapInFlight }()
	default:
		c.Header("Retry-After", "1")
		fail(c, http.StatusTooManyRequests, "map requests are busy")
		return
	}

	requestCtx, cancel := context.WithTimeout(c.Request.Context(), baiduMapTimeout)
	defer cancel()
	endpoint, _ := url.Parse(baiduStaticMapURL)
	values := endpoint.Query()
	center := fmt.Sprintf("%.6f,%.6f", lng, lat) // Baidu Static v2: longitude,latitude.
	values.Set("ak", cfg.AK)
	values.Set("center", center)
	values.Set("markers", center)
	values.Set("coordtype", "wgs84ll") // EXIF GPS is WGS84; do not silently apply BD-09 offsets.
	values.Set("zoom", strconv.Itoa(zoom))
	values.Set("width", strconv.Itoa(width))
	values.Set("height", strconv.Itoa(height))
	values.Set("scaler", "2") // HiDPI without unexpectedly changing the zoom level.
	endpoint.RawQuery = values.Encode()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		fail(c, http.StatusBadGateway, "map service unavailable")
		return
	}
	client := http.Client{Timeout: baiduMapTimeout}
	if s.BaiduMapHTTPClient != nil {
		client = *s.BaiduMapHTTPClient
	}
	client.Timeout = baiduMapTimeout
	// Never forward AK to a redirect target or follow arbitrary external URLs.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	res, err := client.Do(req)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(requestCtx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
			code = http.StatusGatewayTimeout
		}
		fail(c, code, "map service unavailable") // No URLs/errors containing AK.
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.EqualFold(strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]), "image/png") {
		fail(c, http.StatusBadGateway, "map image unavailable")
		return
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, baiduMapMaxBytes+1))
	if err != nil || len(data) > baiduMapMaxBytes || !bytes.HasPrefix(data, baiduPNGHeader) {
		fail(c, http.StatusBadGateway, "invalid map image")
		return
	}
	c.Data(http.StatusOK, "image/png", data)
}
