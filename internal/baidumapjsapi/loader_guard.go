// Package baidumapjsapi supplies strict, non-routable building blocks for the
// future Baidu JSAPI 4.0 Server proxy. This is NOT a public proxy or entitlement.
package baidumapjsapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	ProxyPrefix    = "/_BMapService/"
	LoaderPath     = ProxyPrefix + "api"
	UpstreamLoader = "https://api.map.baidu.com/api"
	MaxLoaderBytes = 2 << 20
)

var (
	ErrGateClosed          = errors.New("jsapi proxy release gates are not satisfied")
	ErrUnreviewedResource  = errors.New("jsapi proxy resource not allowlisted")
	ErrInvalidServerOrigin = errors.New("jsapi proxy trusted origin is invalid")
	ErrUnsafeUpstream      = errors.New("jsapi upstream response rejected")
)

// ReleaseGates must eventually come from trusted Server-side, audited evidence,
// not from a browser request, AK desired_enabled, or a saved configuration.
// There is currently NO caller: the dynamic proxy remains runtime-disabled.
type ReleaseGates struct {
	Licensed, ObservedResourceInventory, RawLeakAudit bool
	OwnerSessionAndFleetQuota, PlatformIsolation      bool
}

func (g ReleaseGates) Ready() bool {
	return g.Licensed && g.ObservedResourceInventory && g.RawLeakAudit &&
		g.OwnerSessionAndFleetQuota && g.PlatformIsolation
}

// ValidateLoaderRoute is deliberately exact: the real 4.0 child-resource
// inventory has not been established. Do NOT add a wildcard or generic URL.
func ValidateLoaderRoute(method, escapedPath, rawQuery string) error {
	if method != http.MethodGet || escapedPath != LoaderPath || rawQuery != "v=4.0" {
		return ErrUnreviewedResource
	}
	return nil
}

// TrustedProxyBase builds the provider-required BMAP_PROXY_URL exclusively
// from a configured HTTPS origin, never from Host/X-Forwarded-* headers.
func TrustedProxyBase(origin string) (string, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.Fragment != "" ||
		u.RawFragment != "" || u.Opaque != "" || u.String() != origin ||
		strings.ContainsAny(u.Host, "\\\r\n\t") {
		return "", ErrInvalidServerOrigin
	}
	return origin + ProxyPrefix, nil
}

// NewLoaderRequest constructs the *only* currently reviewed upstream shape.
// The returned request (including URL) is SECRET SERVER MEMORY. Never log it,
// serialize it, forward it to an Agent/renderer, or attach it to an error.
// No Server route or HTTP client invokes this function in A3b2b.
func NewLoaderRequest(ctx context.Context, origin, browserAK string, gates ReleaseGates) (*http.Request, error) {
	if !gates.Ready() {
		return nil, ErrGateClosed
	}
	host, err := TrustedProxyBase(origin)
	if err != nil {
		return nil, err
	}
	if len(browserAK) == 0 || len(browserAK) > 512 {
		return nil, ErrGateClosed
	}
	for _, c := range browserAK {
		if c < '!' || c > '~' {
			return nil, ErrGateClosed
		}
	}
	u, _ := url.Parse(UpstreamLoader) // immutable, code-owned HTTPS upstream
	q := url.Values{"v": {"4.0"}, "ak": {browserAK}}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrUnsafeUpstream
	}
	// Browser AK Referer is fixed to the trusted HTTPS Server origin;
	// an inbound Referer or Host must never control this header.
	req.Header.Set("Referer", origin+"/")
	req.Header.Set("BMAP_PROXY_URL", host)
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Accept", "application/javascript, text/javascript")
	return req, nil
}

// SafeHTTPClient must be used when the authorized network phase is added.
// It ignores environment proxy settings and never forwards AK via redirects.
func SafeHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	transport.DisableKeepAlives = true
	return &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// CheckLoaderResponse consumes at most 2 MiB + 1 and fails closed if the AK
// appears in common direct/URL/base64 encodings. This is a MINIMUM safety
// check, not proof against arbitrary JS encoding, script-generated requests,
// or all child resources. A real raw-response+HAR audit remains mandatory.
func CheckLoaderResponse(res *http.Response, browserAK string) ([]byte, error) {
	if res == nil || res.StatusCode != http.StatusOK || res.Body == nil ||
		browserAK == "" || res.ContentLength > MaxLoaderBytes ||
		res.Header.Get("Content-Encoding") != "" &&
			!strings.EqualFold(res.Header.Get("Content-Encoding"), "identity") ||
		res.Header.Get("Location") != "" {
		return nil, ErrUnsafeUpstream
	}
	typ, _, err := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if err != nil || (typ != "application/javascript" && typ != "text/javascript" &&
		typ != "application/x-javascript") {
		return nil, ErrUnsafeUpstream
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, MaxLoaderBytes+1))
	if err != nil || len(body) == 0 || len(body) > MaxLoaderBytes {
		return nil, ErrUnsafeUpstream
	}
	patterns := []string{
		browserAK,
		url.QueryEscape(browserAK),
		url.PathEscape(browserAK),
		base64.StdEncoding.EncodeToString([]byte(browserAK)),
		base64.RawStdEncoding.EncodeToString([]byte(browserAK)),
	}
	for _, pattern := range patterns {
		if pattern != "" && bytes.Contains(body, []byte(pattern)) {
			return nil, ErrUnsafeUpstream
		}
	}
	return body, nil
}

// LoaderResponseHeaders is a fresh whitelist: upstream Set-Cookie, Location,
// Cache-Control, CSP, Server, ETag and other headers must never escape.
func LoaderResponseHeaders() http.Header {
	h := make(http.Header)
	h.Set("Content-Type", "application/javascript; charset=utf-8")
	h.Set("Cache-Control", "private, no-store")
	h.Set("Pragma", "no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	return h
}
