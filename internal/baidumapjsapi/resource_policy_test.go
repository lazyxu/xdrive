package baidumapjsapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
)

func reviewedRequest(t *testing.T, method, path string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, "https://gallery.example.invalid"+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Go's server receives origin-form URLs, never the browser's absolute URL.
	req.URL.Scheme, req.URL.Host = "", ""
	return req
}

func TestJSAPI4LoaderShapeIsReviewedButNotReleased(t *testing.T) {
	req := reviewedRequest(t, "GET", "/_BMapService/api?v=4.0")
	review, err := ReviewJSAPI4ResourceRequest(req)
	if err != nil || review.Kind != JSAPI4ResourceLoader || review.MaxResponseBytes != MaxLoaderBytes {
		t.Fatalf("review=%#v err=%v", review, err)
	}
	if !JSAPI4ChildInventoryComplete() {
		t.Fatal("approved bounded official serviceHost policy was not compiled")
	}
	// Synthetic all-true helper flags cannot enable the live Server without a
	// current managed signer, Owner Cookie, quota and revocation evidence.
	g := ReleaseGates{true, true, true, true, true}
	if err := JSAPI4ProductionResourceGate(context.Background(), req, g); !errors.Is(err, ErrGateClosed) {
		t.Fatalf("unlicensed JSAPI4 policy activated: %v", err)
	}
}

func TestJSAPI4UnreviewedResourcesAlwaysDenied(t *testing.T) {
	invalid := []string{
		"/_BMapService/api?v=4.0&ak=client",
		"/_BMapService/api?ak=client&v=4.0",
		"/_BMapService/api?v=4.0&v=4.0",
		"/_BMapService/api?v=4%2e0",
		"/_BMapService/api?v=3.0",
		"/_BMapService/api?V=4.0",
		"/_BMapService/api?",
		"/_BMapService/api",
		"/_BMapService/api?v=4.0&callback=x",
		"/_BMapService/%61pi?v=4.0",
		"/_BMapService/%2e%2e/api?v=4.0",
		"/_BMapService/../api?v=4.0",
		"//_BMapService/api?v=4.0",
	}
	for _, item := range invalid {
		req := reviewedRequest(t, "GET", item)
		// Reproduce raw path ambiguity rather than ignoring Go URL cleanup.
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Errorf("accepted unsafe resource %q: %v", item, err)
		}
	}
}

func TestJSAPI4MethodCredentialAndAbsoluteURLDenied(t *testing.T) {
	for _, method := range []string{"POST", "HEAD", "OPTIONS", "DELETE"} {
		req := reviewedRequest(t, method, "/_BMapService/api?v=4.0")
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Errorf("accepted method %s", method)
		}
	}
	for _, header := range []string{"Authorization", "Proxy-Authorization"} {
		req := reviewedRequest(t, "GET", "/_BMapService/api?v=4.0")
		req.Header.Set(header, "Bearer internal")
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Errorf("accepted %s", header)
		}
	}
	for _, absolute := range []string{
		"https://api.map.baidu.com/_BMapService/api?v=4.0",
		"https://evil.invalid/_BMapService/api?v=4.0",
	} {
		req, err := http.NewRequest("GET", absolute, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Errorf("accepted absolute URL %s", absolute)
		}
	}
	// The exact map-only Cookie is handled by authentication, not this review.
	req := reviewedRequest(t, "GET", "/_BMapService/api?v=4.0")
	req.AddCookie(&http.Cookie{Name: "XD_BMAP_SESSION", Value: "opaque"})
	if _, err := ReviewJSAPI4ResourceRequest(req); err != nil {
		t.Fatalf("review unexpectedly coupled to future session verifier: %v", err)
	}
}

func TestJSAPI4MalformedURLAndCancellationDenied(t *testing.T) {
	if _, err := ReviewJSAPI4ResourceRequest(nil); !errors.Is(err, ErrUnreviewedResource) {
		t.Fatal("accepted nil request")
	}
	req := reviewedRequest(t, "GET", "/_BMapService/api?v=4.0")
	req.URL = nil
	if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
		t.Fatal("accepted nil URL")
	}
	for _, mutate := range []func(*url.URL){
		func(u *url.URL) { u.RawPath = "/_BMapService/%61pi" },
		func(u *url.URL) { u.ForceQuery = true },
		func(u *url.URL) { u.Fragment = "x" },
		func(u *url.URL) { u.RawFragment = "x" },
		func(u *url.URL) { u.Opaque = "/_BMapService/api" },
		func(u *url.URL) { u.User = url.User("attacker") },
	} {
		req = reviewedRequest(t, "GET", "/_BMapService/api?v=4.0")
		mutate(req.URL)
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Error("accepted non-canonical URL fields")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	req = reviewedRequest(t, "GET", "/_BMapService/api?v=4.0").WithContext(ctx)
	cancel()
	if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
		t.Fatal("accepted canceled request")
	}
	if err := JSAPI4ProductionResourceGate(ctx, req, ReleaseGates{true, true, true, true, true}); !errors.Is(err, ErrGateClosed) {
		t.Fatal("accepted canceled context")
	}
}

func TestJSAPI4LoaderShapeRejectsAmbiguousOrBlankCredentialHeaders(t *testing.T) {
	// Header.Get silently returns an empty/first canonical value. Every
	// credential-bearing field must instead be absent, including direct
	// map mutations possible in an upstream Go middleware.
	tests := []struct {
		name string
		set  func(http.Header)
	}{
		{"blank authorization", func(h http.Header) { h["Authorization"] = []string{""} }},
		{"empty authorization slice", func(h http.Header) { h["Authorization"] = []string{} }},
		{"nil authorization slice", func(h http.Header) { h["Authorization"] = nil }},
		{"lowercase authorization alias", func(h http.Header) { h["authorization"] = []string{"Bearer leaked"} }},
		{"duplicate authorization values", func(h http.Header) { h["Authorization"] = []string{"", "Bearer leaked"} }},
		{"authorization case collision", func(h http.Header) {
			h["Authorization"] = []string{""}
			h["AUTHORIZATION"] = []string{"Bearer leaked"}
		}},
		{"blank proxy authorization", func(h http.Header) { h["Proxy-Authorization"] = []string{""} }},
		{"nil proxy authorization", func(h http.Header) { h["Proxy-Authorization"] = nil }},
		{"lowercase proxy authorization alias", func(h http.Header) { h["proxy-authorization"] = []string{"Basic leaked"} }},
		{"duplicate proxy authorization", func(h http.Header) { h["Proxy-Authorization"] = []string{"", "Basic leaked"} }},
		{"proxy authorization case collision", func(h http.Header) {
			h["Proxy-Authorization"] = []string{""}
			h["PROXY-AUTHORIZATION"] = []string{"Basic leaked"}
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := reviewedRequest(t, http.MethodGet, "/_BMapService/api?v=4.0")
			tc.set(req.Header)
			got, err := ReviewJSAPI4ResourceRequest(req)
			if !errors.Is(err, ErrUnreviewedResource) || got.Kind != JSAPI4ResourceUnreviewed {
				t.Fatalf("review accepted ambiguous credentials: %#v, %v", got, err)
			}
			// This is a second NO-GO gate even if synthetic release flags
			// appear ready. Runtime remains unconfigured and non-routable.
			allSyntheticGates := ReleaseGates{true, true, true, true, true}
			if err := JSAPI4ProductionResourceGate(context.Background(), req, allSyntheticGates); !errors.Is(err, ErrGateClosed) {
				t.Fatalf("credential-bearing resource reached release gate: %v", err)
			}
		})
	}
	req := reviewedRequest(t, http.MethodGet, "/_BMapService/api?v=4.0")
	got, err := ReviewJSAPI4ResourceRequest(req)
	if err != nil || got.Kind != JSAPI4ResourceLoader {
		t.Fatalf("missing credentials should preserve original shape review: %#v, %v", got, err)
	}
}

// Source policy admits only canonical Baidu-owned GET resource shapes.
// A passing request shape alone does not grant an Owner Session or network IO.
func TestJSAPI4BaiduServiceHostFamilyShapeAndBoundedFields(t *testing.T) {
	if !JSAPI4ChildInventoryComplete() ||
		len(ApprovedJSAPI4ChildPaths()) != 1 ||
		ApprovedJSAPI4ChildPaths()[0] != JSAPI4ReviewedProviderFamilyPath {
		t.Fatal("bounded map child family not registered in reviewed code")
	}
	for _, target := range []string{
		"/_BMapService/getscript?v=4.0",
		"/_BMapService/tiles/sample.png?x=1&y=2&z=12",
		"/_BMapService/assets/lib.js?v=4.0",
		"/_BMapService/?qt=tiles",
	} {
		req := reviewedRequest(t, http.MethodGet, target)
		result, err := ReviewJSAPI4ResourceRequest(req)
		if err != nil || result.Kind != JSAPI4ResourceChild ||
			result.MaxResponseBytes != MaxLoaderBytes {
			t.Fatalf("rejected source family shape %q: %#v %v", target, result, err)
		}
	}
	for _, target := range []string{
		"/_BMapService/assets/code.js?callback=evil",
		"/_BMapService/assets/code.js?ak=leak",
		"/_BMapService/assets/code.js?AK=leak",
		"/_BMapService/assets/code.js?url=https%3A%2F%2Fevil.invalid",
		"/_BMapService/assets/code.js?x=1&x=2",
		"/_BMapService/assets/%2e%2e/code.js",
		"/_BMapService/assets/../code.js",
		"/_BMapService/assets//code.js",
		"/_BMapService/assets%2Fcode.js",
		"/_BMapService/",
	} {
		req := reviewedRequest(t, http.MethodGet, target)
		if _, err := ReviewJSAPI4ResourceRequest(req); !errors.Is(err, ErrUnreviewedResource) {
			t.Errorf("accepted malicious resource family %q", target)
		}
	}
	for _, typ := range []string{
		"text/html", "image/svg+xml", "text/plain",
		"application/octet-stream", "application/x-shockwave-flash",
	} {
		if JSAPI4AllowedProviderMediaType(typ) {
			t.Fatalf("untrusted MIME approved: %s", typ)
		}
	}
}
