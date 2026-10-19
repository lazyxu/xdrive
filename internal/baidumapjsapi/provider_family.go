package baidumapjsapi

import (
	"net/http"
	"net/url"
	"strings"
)

// The Baidu JSAPI4 serviceHost contract routes all SDK-owned requests through
// the SAME fixed HTTPS provider. It does not publish an arbitrary outbound
// URL, Host, port, third-party map provider, credential or redirect.
// This source-owned family has a deliberately narrow method/path/query/response
// grammar; it is NOT the unbounded Nginx example from provider documentation.
const JSAPI4ReviewedProviderFamilyPath = ProxyPrefix + "*resource"

const (
	jsapi4FamilyMaxPathBytes  = 192
	jsapi4FamilyMaxQueryBytes = 2048
	jsapi4FamilyMaxFields     = 20
	jsapi4FamilyMaxValueBytes = 192
)

// We accept only GET requests to canonical opaque *Baidu* SDK paths; the
// already audited Loader /api?v=4.0 is checked by ValidateLoaderRoute.
// We never accept path decoding ambiguities, nested hosts/URLs or client AK.
func ValidateJSAPI4ProviderFamilyRequest(req *http.Request) error {
	if req == nil || req.URL == nil || req.Context().Err() != nil ||
		req.Method != http.MethodGet || req.ContentLength > 0 ||
		len(req.TransferEncoding) != 0 {
		return ErrUnreviewedResource
	}
	_, hasAuthorization, validAuthorization := strictMapTransportHeader(req, "Authorization")
	_, hasProxyAuthorization, validProxyAuthorization := strictMapTransportHeader(req, "Proxy-Authorization")
	if !validAuthorization || hasAuthorization ||
		!validProxyAuthorization || hasProxyAuthorization {
		return ErrUnreviewedResource
	}
	u := req.URL
	if u.IsAbs() || u.Host != "" || u.User != nil || u.Opaque != "" ||
		u.Scheme != "" || u.RawPath != "" || u.ForceQuery ||
		u.Fragment != "" || u.RawFragment != "" ||
		u.EscapedPath() != u.Path {
		return ErrUnreviewedResource
	}
	if !strings.HasPrefix(u.Path, ProxyPrefix) || u.Path == LoaderPath {
		return ErrUnreviewedResource
	}
	suffix := strings.TrimPrefix(u.Path, ProxyPrefix)
	if len(suffix) > jsapi4FamilyMaxPathBytes ||
		strings.Contains(suffix, "//") || strings.ContainsAny(suffix, "\\%*?#;:@") ||
		len(u.RawQuery) > jsapi4FamilyMaxQueryBytes {
		return ErrUnreviewedResource
	}
	if suffix == "" && u.RawQuery == "" {
		return ErrUnreviewedResource
	}
	for _, segment := range strings.Split(suffix, "/") {
		if segment == "." || segment == ".." {
			return ErrUnreviewedResource
		}
	}
	for _, c := range suffix {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' ||
			c >= '0' && c <= '9' || c == '/' || c == '.' ||
			c == '-' || c == '_') {
			return ErrUnreviewedResource
		}
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(query) > jsapi4FamilyMaxFields {
		return ErrUnreviewedResource
	}
	for key, values := range query {
		lower := strings.ToLower(key)
		switch lower {
		case "ak", "key", "token", "secret", "url", "uri", "host",
			"domain", "callback", "redirect", "redirect_uri", "target",
			"proxy", "proxy_url", "authorization", "__proto__":
			return ErrUnreviewedResource
		}
		if len(key) == 0 || len(key) > 40 || len(values) != 1 {
			return ErrUnreviewedResource
		}
		for _, ch := range key {
			if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
				ch >= '0' && ch <= '9' || ch == '_' || ch == '-' ||
				ch == '.') {
				return ErrUnreviewedResource
			}
		}
		for _, value := range values {
			if len(value) > jsapi4FamilyMaxValueBytes ||
				strings.ContainsAny(value, "\\<>\r\n\x00#@") ||
				strings.Contains(strings.ToLower(value), "://") {
				return ErrUnreviewedResource
			}
		}
	}
	return nil
}

// Media types are fixed, audited Go source; never adopt an arbitrary upstream
// Content-Type or allow HTML/SVG/JSONP into the authenticated Gallery origin.
// Application/json is data, not JavaScript; nosniff and no-store are mandatory.
func JSAPI4AllowedProviderMediaType(mediaType string) bool {
	switch mediaType {
	case "application/javascript", "application/x-javascript",
		"text/javascript", "text/css", "application/wasm",
		"application/json", "application/x-protobuf",
		"application/vnd.mapbox-vector-tile", "image/png",
		"image/jpeg", "image/webp", "image/gif", "font/woff",
		"font/woff2", "application/font-woff":
		return true
	default:
		return false
	}
}
