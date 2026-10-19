package baidumapjsapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

// This is the ONLY source-owned manifest used to register future production
// JSAPI4 child routes. Intentionally EMPTY: the operator has not yet supplied
// a licensed, complete, privately reviewed nine-pair Browser/upstream HAR set.
// Do not populate it from an HTTP field, admin setting, runtime flag or HAR
// parser. Every new entry must be independently reviewed and code-pinned.
var sourceReviewedJSAPI4Children = []JSAPI4ChildCandidate{}

// ApprovedJSAPI4ChildPaths is used exclusively by the real Gin Router at
// construction. No wildcard handler is installed and an incomplete reviewed
// manifest always returns zero routes.
func ApprovedJSAPI4ChildPaths() []string {
	if !JSAPI4ChildInventoryComplete() {
		return nil
	}
	paths := make([]string, 0, len(sourceReviewedJSAPI4Children))
	for _, child := range sourceReviewedJSAPI4Children {
		paths = append(paths, child.ProxyPath)
	}
	return paths
}

func approvedJSAPI4ChildRequest(req *http.Request) (JSAPI4ChildCandidate, error) {
	if req == nil || req.Context().Err() != nil || !JSAPI4ChildInventoryComplete() {
		return JSAPI4ChildCandidate{}, ErrUnreviewedResource
	}
	for _, rule := range sourceReviewedJSAPI4Children {
		if MatchJSAPI4ChildCandidate(rule, req) == nil {
			return rule, nil
		}
	}
	return JSAPI4ChildCandidate{}, ErrUnreviewedResource
}

// NewApprovedJSAPI4ChildRequest constructs only an independently source-
// approved, fixed Baidu HTTPS child request, with the current Browser AK in
// PRIVATE SERVER MEMORY. It never reflects the inbound Host, URL or headers.
// Tests may validate candidate shapes, but cannot add production routes.
func NewApprovedJSAPI4ChildRequest(
	ctx context.Context, origin, browserAK string,
	inbound *http.Request, gates ReleaseGates,
) (*http.Request, error) {
	if ctx == nil || ctx.Err() != nil || inbound == nil || !gates.Ready() ||
		len(browserAK) == 0 || len(browserAK) > 512 {
		return nil, ErrGateClosed
	}
	for _, ch := range browserAK {
		if ch < '!' || ch > '~' {
			return nil, ErrGateClosed
		}
	}
	proxyBase, err := TrustedProxyBase(origin)
	if err != nil {
		return nil, ErrGateClosed
	}
	child, err := approvedJSAPI4ChildRequest(inbound)
	if err != nil || child.UpstreamHost != "api.map.baidu.com" {
		return nil, ErrUnreviewedResource
	}
	query, err := url.ParseQuery(inbound.URL.RawQuery)
	if err != nil {
		return nil, ErrUnreviewedResource
	}
	query.Set("ak", browserAK)
	upstream := url.URL{
		Scheme: "https", Host: "api.map.baidu.com",
		Path:     strings.TrimPrefix(child.ProxyPath, "/_BMapService"),
		RawQuery: query.Encode(),
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
	if err != nil {
		return nil, ErrUnsafeUpstream
	}
	// The trusted HTTPS origin, never caller headers, determines Browser AK Referer.
	request.Header.Set("Referer", origin+"/")
	request.Header.Set("BMAP_PROXY_URL", proxyBase)
	request.Header.Set("Accept-Encoding", "identity")
	request.Header.Set("Accept", child.MediaType)
	return request, nil
}

// CheckApprovedJSAPI4ChildResponse is a bounded minimum byte-safety check,
// NOT a replacement for the independent raw HAR, script-child and licence
// audit. No upstream header is ever copied through to a Browser.
func CheckApprovedJSAPI4ChildResponse(
	response *http.Response, browserAK string, review JSAPI4ResourceReview,
) ([]byte, error) {
	if response == nil || response.StatusCode != http.StatusOK ||
		response.Body == nil || browserAK == "" ||
		review.Kind != JSAPI4ResourceChild || review.MaxResponseBytes <= 0 ||
		review.MaxResponseBytes > MaxLoaderBytes || review.MediaType == "" ||
		response.ContentLength > review.MaxResponseBytes ||
		len(response.Header.Values("Content-Type")) != 1 ||
		len(response.Header.Values("Location")) != 0 ||
		len(response.Header.Values("Set-Cookie")) != 0 {
		return nil, ErrUnsafeUpstream
	}
	encodings := response.Header.Values("Content-Encoding")
	if len(encodings) > 1 ||
		len(encodings) == 1 && !strings.EqualFold(encodings[0], "identity") {
		return nil, ErrUnsafeUpstream
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || contentType != review.MediaType {
		return nil, ErrUnsafeUpstream
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, review.MaxResponseBytes+1))
	if err != nil || len(body) == 0 || int64(len(body)) > review.MaxResponseBytes {
		return nil, ErrUnsafeUpstream
	}
	for _, candidate := range []string{
		browserAK, url.QueryEscape(browserAK), url.PathEscape(browserAK),
		base64.StdEncoding.EncodeToString([]byte(browserAK)),
		base64.RawStdEncoding.EncodeToString([]byte(browserAK)),
	} {
		if candidate != "" && bytes.Contains(body, []byte(candidate)) {
			clear(body)
			return nil, ErrUnsafeUpstream
		}
	}
	return body, nil
}

func ApprovedJSAPI4ChildResponseHeaders(review JSAPI4ResourceReview) http.Header {
	if review.Kind != JSAPI4ResourceChild || review.MediaType == "" {
		return nil
	}
	h := LoaderResponseHeaders()
	h.Set("Content-Type", review.MediaType)
	return h
}
