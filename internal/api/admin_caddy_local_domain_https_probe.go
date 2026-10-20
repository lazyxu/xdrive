package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"time"
)

// A second, INDEPENDENT Server-side observation for an ALREADY deployed public
// domain. It checks the real TLS peer, public CA chain, hostname and xDrive
// Ready response through the single fixed Compose network service caddy:443.
// It NEVER authenticates the host Docker process, private-IP CA, WAN ingress,
// desired revision, or grants Host Apply/Restart.
const (
	caddyLocalDomainHTTPSDialAddress = "caddy:443"
	caddyLocalDomainHTTPSTimeout     = 650 * time.Millisecond
)

func caddyLocalDomainHTTPSReady(
	ctx context.Context, domain string,
	dial func(context.Context, string, string) (net.Conn, error),
	roots *x509.CertPool,
) bool {
	if ctx == nil || dial == nil || !validCaddyHTTPSDomain(domain) {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, caddyLocalDomainHTTPSTimeout)
	defer cancel()

	// No browser input or operator-supplied URL: use only an already validated
	// Server deployment hostname for SNI/Host, and NEVER resolve it for dialing.
	// RootCAs=nil means Go's system trust; no insecure TLS bypass/fallback.
	expectedAddress := net.JoinHostPort(domain, "443")
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != expectedAddress {
				return nil, errors.New("non-fixed Caddy TLS route rejected")
			}
			return dial(ctx, "tcp", caddyLocalDomainHTTPSDialAddress)
		},
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: domain,
			RootCAs:    roots,
		},
		TLSHandshakeTimeout:   caddyLocalDomainHTTPSTimeout,
		ResponseHeaderTimeout: caddyLocalDomainHTTPSTimeout,
		DisableKeepAlives:     true,
		DisableCompression:    true,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		Timeout:       caddyLocalDomainHTTPSTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+domain+"/api/v1/readyz", nil)
	if err != nil {
		return false
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.TLS == nil || !response.TLS.HandshakeComplete || len(response.TLS.VerifiedChains) == 0 ||
		response.StatusCode != http.StatusOK {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
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
	return json.Unmarshal(raw, &ready) == nil && ready.OK &&
		ready.Database == "ok" && ready.Storage == "ok"
}

func caddyLocalDomainHTTPSObserved(ctx context.Context, domain string) bool {
	return caddyLocalDomainHTTPSReady(
		ctx, domain,
		(&net.Dialer{Timeout: caddyLocalDomainHTTPSTimeout}).DialContext,
		nil,
	)
}
