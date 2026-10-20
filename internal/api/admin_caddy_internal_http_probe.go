package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// This is deliberately weaker than the trusted Host Control observation.
// It checks exactly one fixed Docker-internal HTTP reverse-proxy path; no
// operator-supplied address, headers, cookies, secrets, redirects, proxies,
// container control, CA trust changes or HTTPS/Applied-Revision claims.
const (
	caddyInternalRouteURL           = "http://caddy:80/api/v1/readyz"
	caddyInternalRouteAddress       = "caddy:80"
	caddyInternalRouteTimeout       = 500 * time.Millisecond
	caddyInternalRouteResponseLimit = 256
)

func caddyInternalRouteReady(ctx context.Context, dial func(context.Context, string, string) (net.Conn, error)) bool {
	if ctx == nil || dial == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, caddyInternalRouteTimeout)
	defer cancel()
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != caddyInternalRouteAddress {
				return nil, errors.New("Caddy internal route target rejected")
			}
			return dial(ctx, network, address)
		},
		DisableKeepAlives:     true,
		DisableCompression:    true,
		ResponseHeaderTimeout: caddyInternalRouteTimeout,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		Timeout:       caddyInternalRouteTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, caddyInternalRouteURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK ||
		!strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "application/json") {
		return false
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, caddyInternalRouteResponseLimit+1))
	if err != nil || len(raw) > caddyInternalRouteResponseLimit {
		return false
	}
	var ready struct {
		OK       bool   `json:"ok"`
		Database string `json:"database"`
		Storage  string `json:"storage"`
	}
	if json.Unmarshal(raw, &ready) != nil {
		return false
	}
	return ready.OK && ready.Database == "ok" && ready.Storage == "ok"
}

func caddyInternalRouteObserved(ctx context.Context) bool {
	return caddyInternalRouteReady(ctx, (&net.Dialer{Timeout: caddyInternalRouteTimeout}).DialContext)
}

// Only the official Compose Server's fixed mount enables this weak extra
// signal. A missing witness or HTTP success is never authoritative Caddy
// identity, Docker health, TLS identity, DNS access or Host Apply evidence.
func annotateCaddyMissingHostWitness(item *serviceDependency, detail string, routeChecked, routeReady bool) {
	item.Detail = detail
	if !routeChecked {
		return
	}
	item.CaddyInternalHTTPState = "unavailable"
	if routeReady {
		item.CaddyInternalHTTPState = "reachable"
		item.Detail = "固定 Docker 内部 caddy:80 HTTP 转发返回有效的 Server Ready 响应；但宿主 Caddy 状态快照仍缺失或不可信。此证据不证明容器身份、HTTPS 证书、公网可达性或已应用配置；" + detail
	}
}
