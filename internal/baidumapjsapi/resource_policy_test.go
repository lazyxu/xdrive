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
	if JSAPI4ChildInventoryComplete() {
		t.Fatal("unreviewed child policy presented as complete")
	}
	// Even with synthetic all-true helper flags, runtime must not enable.
	g := ReleaseGates{true, true, true, true, true}
	if err := JSAPI4ProductionResourceGate(context.Background(), req, g); !errors.Is(err, ErrGateClosed) {
		t.Fatalf("unlicensed JSAPI4 policy activated: %v", err)
	}
}

func TestJSAPI4UnreviewedResourcesAlwaysDenied(t *testing.T) {
	invalid := []string{
		"/_BMapService/tiles/0.png?v=4.0",
		"/_BMapService/assets/script.js?v=4.0",
		"/_BMapService/assets/map.wasm?v=4.0",
		"/_BMapService/font/map.woff2?v=4.0",
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
