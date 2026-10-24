package client

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ValidConnectionIP validates a session route without resolving or contacting
// its origin. An empty setting preserves the legacy transport.
func ValidConnectionIP(server, ip string) error {
	if ip == "" {
		return nil
	}
	address, err := netip.ParseAddr(ip)
	if err != nil || address.Zone() != "" {
		return errors.New("connection IP must be a literal IP address")
	}
	_, err = connectionOrigin(server)
	return err
}

func connectionOrigin(server string) (*url.URL, error) {
	u, err := url.Parse(server)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Opaque != "" ||
		u.Hostname() == "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || strings.Contains(server, "#") {
		return nil, errors.New("connection IP requires an HTTPS origin")
	}
	if strings.HasSuffix(u.Host, ":") {
		return nil, errors.New("invalid connection origin port")
	}
	if port := u.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return nil, errors.New("invalid connection origin port")
		}
	}
	return u, nil
}

func connectionAddress(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = "443"
	}
	return net.JoinHostPort(strings.ToLower(u.Hostname()), port)
}

type connectionIPTransport struct {
	origin string
	source *http.Transport
	direct *http.Transport
}

func (t *connectionIPTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL == nil || req.URL.Scheme != "https" || req.URL.User != nil ||
		connectionAddress(req.URL) != t.origin || (req.Host != "" && !strings.EqualFold(req.Host, req.URL.Host)) {
		return nil, errors.New("connection IP cannot be used outside its HTTPS origin")
	}
	return t.direct.RoundTrip(req)
}

func (t *connectionIPTransport) CloseIdleConnections() { t.direct.CloseIdleConnections() }

// ConfigureConnectionIP pins only the socket destination. The request URL and
// Host remain unchanged, and ordinary TLS verifies the original origin on each
// connection. Configure private LAN trust first when it has been approved.
func (c *Client) ConfigureConnectionIP(ip string) error {
	if err := ValidConnectionIP(c.BaseURL, ip); err != nil {
		return err
	}
	if ip == "" {
		return nil
	}
	u, _ := connectionOrigin(c.BaseURL)
	h := c.HTTP
	if h == nil {
		h = &http.Client{}
	}
	var source *http.Transport
	switch existing := h.Transport.(type) {
	case nil:
		var ok bool
		source, ok = http.DefaultTransport.(*http.Transport)
		if !ok {
			return errors.New("connection IP requires an HTTP transport")
		}
	case *http.Transport:
		source = existing
	case *connectionIPTransport:
		source = existing.source
	default:
		return errors.New("connection IP requires an HTTP transport")
	}
	if source.TLSClientConfig != nil && source.TLSClientConfig.InsecureSkipVerify {
		return errors.New("connection IP requires TLS verification")
	}
	direct := source.Clone()
	if direct.TLSClientConfig == nil {
		direct.TLSClientConfig = &tls.Config{}
	}
	direct.TLSClientConfig.ServerName = u.Hostname()
	if direct.TLSClientConfig.MinVersion < tls.VersionTLS12 {
		direct.TLSClientConfig.MinVersion = tls.VersionTLS12
	}
	// A route selection is an exact per-origin NO_PROXY: a CONNECT proxy would
	// otherwise resolve the original hostname instead of using this socket IP.
	direct.Proxy = nil
	direct.DialTLS = nil
	direct.DialTLSContext = nil
	origin := connectionAddress(u)
	_, port, _ := net.SplitHostPort(origin)
	destination := net.JoinHostPort(ip, port)
	dial := source.DialContext
	if dial == nil {
		dial = (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	}
	direct.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if !strings.EqualFold(address, origin) {
			return nil, errors.New("connection IP refused another destination")
		}
		return dial(ctx, network, destination)
	}
	configured := *h
	configured.Transport = &connectionIPTransport{origin: origin, source: source, direct: direct}
	configured.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return ErrAuthRedirect }
	c.HTTP = &configured
	return nil
}
