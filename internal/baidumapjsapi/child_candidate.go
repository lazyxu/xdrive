package baidumapjsapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// JSAPI4ChildCandidate is a NON-PRODUCTION, source-review aid for one observed
// Baidu JSAPI4 child resource. A candidate is not an approved allowlist entry.
// The production inventory remains empty, with its release gate hard-closed.
// The immutable upstream host here is the documented Baidu proxy host;
// supporting another provider-owned host requires a separate source review.
type JSAPI4ChildCandidate struct {
	ProxyPath        string
	UpstreamHost     string
	MediaType        string
	MaxResponseBytes int64
	Query            []JSAPI4ChildQueryCandidate
}

type JSAPI4ChildQueryCandidate struct {
	Name string
	// Literal and BoundedUint are mutually exclusive. Dynamic numeric
	// coordinates require explicit bounds, never a catch-all string regex.
	Literal     string
	BoundedUint bool
	Min, Max    uint32
}

// ValidateJSAPI4ChildCandidate checks the shape of an independently reviewed
// proposal. Passing this check proves NOTHING about legal authorization,
// network completeness, Browser AK secrecy or readiness for any HTTP route.
func ValidateJSAPI4ChildCandidate(c JSAPI4ChildCandidate) error {
	const allowedHost = "api.map.baidu.com"
	if c.UpstreamHost != allowedHost || c.ProxyPath == LoaderPath ||
		!strings.HasPrefix(c.ProxyPath, ProxyPrefix) ||
		len(c.ProxyPath) > 256 || c.MaxResponseBytes <= 0 ||
		c.MaxResponseBytes > MaxLoaderBytes || len(c.Query) > 8 {
		return ErrUnreviewedResource
	}
	childPath := strings.TrimPrefix(c.ProxyPath, ProxyPrefix)
	if childPath == "" || strings.Contains(childPath, "//") ||
		strings.HasSuffix(childPath, "/") || strings.Contains(childPath, "..") ||
		strings.ContainsAny(childPath, "%\\*?#:;@") {
		return ErrUnreviewedResource
	}
	for _, ch := range childPath {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
			ch >= '0' && ch <= '9' || ch == '/' || ch == '-' || ch == '_' || ch == '.') {
			return ErrUnreviewedResource
		}
	}
	switch c.MediaType {
	case "application/javascript", "text/javascript", "text/css",
		"application/wasm", "image/png", "image/jpeg", "image/webp", "font/woff2":
	default:
		return ErrUnreviewedResource
	}
	seen := make(map[string]bool, len(c.Query))
	for _, field := range c.Query {
		if field.Name == "" || len(field.Name) > 32 ||
			strings.EqualFold(field.Name, "ak") ||
			strings.EqualFold(field.Name, "token") ||
			strings.EqualFold(field.Name, "url") ||
			strings.EqualFold(field.Name, "callback") || seen[field.Name] {
			return ErrUnreviewedResource
		}
		seen[field.Name] = true
		for _, ch := range field.Name {
			if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
				ch >= '0' && ch <= '9' || ch == '_') {
				return ErrUnreviewedResource
			}
		}
		if field.BoundedUint {
			if field.Literal != "" || field.Min > field.Max {
				return ErrUnreviewedResource
			}
		} else {
			if field.Min != 0 || field.Max != 0 || field.Literal == "" ||
				len(field.Literal) > 64 {
				return ErrUnreviewedResource
			}
			for _, ch := range field.Literal {
				if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
					ch >= '0' && ch <= '9' || ch == '-' || ch == '_' ||
					ch == '.' || ch == '~') {
					return ErrUnreviewedResource
				}
			}
		}
	}
	return nil
}

// MatchJSAPI4ChildCandidate is an OFFLINE request-shape check, not a runtime
// proxy entry point. A positive result does not authorize this request or its
// upstream bytes. Only source-pinned, independently licensed rules can later
// be considered for a production policy after all other release gates.
func MatchJSAPI4ChildCandidate(c JSAPI4ChildCandidate, req *http.Request) error {
	if ValidateJSAPI4ChildCandidate(c) != nil || req == nil ||
		req.URL == nil || req.Context().Err() != nil || req.Method != http.MethodGet ||
		len(req.Header.Values("Authorization")) != 0 ||
		len(req.Header.Values("Proxy-Authorization")) != 0 {
		return ErrUnreviewedResource
	}
	u := req.URL
	if u.IsAbs() || u.Host != "" || u.User != nil || u.Opaque != "" ||
		u.RawPath != "" || u.ForceQuery || u.Fragment != "" ||
		u.RawFragment != "" || u.Path != c.ProxyPath ||
		u.EscapedPath() != c.ProxyPath {
		return ErrUnreviewedResource
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || query.Encode() != u.RawQuery || len(query) != len(c.Query) {
		return ErrUnreviewedResource
	}
	for _, field := range c.Query {
		v := query[field.Name]
		if len(v) != 1 {
			return ErrUnreviewedResource
		}
		if field.BoundedUint {
			n, err := strconv.ParseUint(v[0], 10, 32)
			if err != nil || strconv.FormatUint(n, 10) != v[0] ||
				uint32(n) < field.Min || uint32(n) > field.Max {
				return ErrUnreviewedResource
			}
		} else if v[0] != field.Literal {
			return ErrUnreviewedResource
		}
	}
	return nil
}
