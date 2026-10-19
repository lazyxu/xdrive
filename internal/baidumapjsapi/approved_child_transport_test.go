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

func TestApprovedJSAPI4ChildrenDoNotRegisterOrAuthorizeWithoutReview(t *testing.T) {
	if JSAPI4ChildInventoryComplete() || len(ApprovedJSAPI4ChildPaths()) != 0 {
		t.Fatal("an unreviewed child became a production route")
	}
	for _, target := range []string{
		"/_BMapService/tile/a.png?x=1",
		"/_BMapService/%2e%2e/api?v=4.0",
		"/_BMapService/tiles/a.png?ak=fixture-secret",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if result, err := ReviewJSAPI4ResourceRequest(req); err == nil ||
			result.Kind == JSAPI4ResourceChild {
			t.Fatalf("unreviewed route was accepted")
		}
		out, err := NewApprovedJSAPI4ChildRequest(context.Background(),
			"https://gallery.example.invalid", "fixture-private-browser-ak", req,
			ReleaseGates{Licensed: true, ObservedResourceInventory: true,
				RawLeakAudit: true, OwnerSessionAndFleetQuota: true, PlatformIsolation: true})
		if out != nil || err == nil ||
			strings.Contains(err.Error(), "fixture-private-browser-ak") {
			t.Fatal("unreviewed child created an upstream request or leaked AK")
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
