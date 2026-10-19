package baidumapjsapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBaiduJSAPI4ReviewedFamilyRejectsMaliciousAndForwardsOnlyFixedProvider(t *testing.T) {
	if !JSAPI4ChildInventoryComplete() || len(ApprovedJSAPI4ChildPaths()) != 1 ||
		ApprovedJSAPI4ChildPaths()[0] != JSAPI4ReviewedProviderFamilyPath {
		t.Fatal("bounded Baidu source family not registered")
	}
	const ak = "server-only-browser-ak-example"
	gates := ReleaseGates{Licensed: true, ObservedResourceInventory: true,
		RawLeakAudit: true, OwnerSessionAndFleetQuota: true, PlatformIsolation: true}
	for _, target := range []string{
		"/_BMapService/%2e%2e/api?v=4.0",
		"/_BMapService/tiles/a.png?ak=fixture-secret",
		"/_BMapService/tiles/a.png?url=https%3A%2F%2Fevil.invalid",
		"/_BMapService/assets/../payload.js",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if review, err := ReviewJSAPI4ResourceRequest(req); err == nil ||
			review.Kind == JSAPI4ResourceChild {
			t.Fatalf("malicious child review succeeded: %q", target)
		}
		out, err := NewApprovedJSAPI4ChildRequest(context.Background(),
			"https://gallery.example.invalid", ak, req, gates)
		if out != nil || err == nil || strings.Contains(err.Error(), ak) {
			t.Fatalf("malicious path created a provider request: %q", target)
		}
	}

	req := httptest.NewRequest(http.MethodGet,
		"/_BMapService/tiles/test.png?x=1&y=2", nil)
	out, err := NewApprovedJSAPI4ChildRequest(context.Background(),
		"https://gallery.example.invalid", ak, req, gates)
	if err != nil || out.URL.Scheme != "https" ||
		out.URL.Host != "api.map.baidu.com" || out.URL.Path != "/tiles/test.png" ||
		out.URL.Query().Get("ak") != ak || out.URL.Query().Get("x") != "1" ||
		out.Header.Get("BMAP_PROXY_URL") != "https://gallery.example.invalid/_BMapService/" ||
		out.Header.Get("Referer") != "https://gallery.example.invalid/" ||
		out.Header.Get("Authorization") != "" || out.Header.Get("Cookie") != "" {
		t.Fatal("fixed Baidu upstream, AK or credential isolation failed")
	}
	req.Header.Set("Authorization", "Bearer forged")
	if forwarded, err := NewApprovedJSAPI4ChildRequest(context.Background(),
		"https://gallery.example.invalid", ak, req, gates); forwarded != nil ||
		!errors.Is(err, ErrUnreviewedResource) {
		t.Fatal("browser bearer was accepted by family request planner")
	}
	for _, unsafeMedia := range []string{"text/html", "image/svg+xml"} {
		if ApprovedJSAPI4ChildResponseHeaders(JSAPI4ResourceReview{
			Kind: JSAPI4ResourceChild, MediaType: unsafeMedia,
			MaxResponseBytes: MaxLoaderBytes,
		}) != nil {
			t.Fatal("unsafe MIME entered fixed child response headers")
		}
	}
}

func TestApprovedJSAPI4ChildResponseStrictBoundsMIMEAndSecrecy(t *testing.T) {
	const ak = "fixture-secret-browser-ak"
	review := JSAPI4ResourceReview{
		Kind: JSAPI4ResourceChild, MaxResponseBytes: 128, MediaType: "image/png",
	}
	response := func(mime string, content []byte) *http.Response {
		return &http.Response{
			StatusCode: http.StatusOK, ContentLength: int64(len(content)),
			Header: http.Header{"Content-Type": []string{mime}},
			Body:   io.NopCloser(bytes.NewReader(content)),
		}
	}
	valid, err := CheckApprovedJSAPI4ChildResponse(
		response("image/png", []byte("offline synthetic child")), ak, review)
	if err != nil || !bytes.Equal(valid, []byte("offline synthetic child")) {
		t.Fatal("synthetic bounded approved content shape was rejected")
	}
	for _, tc := range []struct {
		name string
		res  *http.Response
	}{
		{"bad MIME", response("text/html", []byte("<h1>unsafe</h1>"))},
		{"raw AK", response("image/png", []byte(ak))},
		{"URL-escaped AK", response("image/png", []byte("fixture-secret-browser-ak"))},
		{"too large", response("image/png", bytes.Repeat([]byte("a"), 129))},
		{"empty", response("image/png", nil)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := CheckApprovedJSAPI4ChildResponse(tc.res, ak, review)
			if body != nil || !errors.Is(err, ErrUnsafeUpstream) {
				t.Fatal("unsafe child bytes passed inspection")
			}
		})
	}
	redirect := response("image/png", []byte("x"))
	redirect.Header.Set("Location", "https://attacker.example")
	if b, e := CheckApprovedJSAPI4ChildResponse(redirect, ak, review); b != nil || e == nil {
		t.Fatal("redirect was forwarded")
	}
	cookie := response("image/png", []byte("x"))
	cookie.Header.Set("Set-Cookie", "private=secret")
	if b, e := CheckApprovedJSAPI4ChildResponse(cookie, ak, review); b != nil || e == nil {
		t.Fatal("upstream Cookie was forwarded")
	}
	h := ApprovedJSAPI4ChildResponseHeaders(review)
	if h.Get("Content-Type") != "image/png" || h.Get("Cache-Control") != "private, no-store" ||
		h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Set-Cookie") != "" {
		t.Fatal("response header allowlist is incomplete")
	}
}
