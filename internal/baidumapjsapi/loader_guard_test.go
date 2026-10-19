package baidumapjsapi

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func completeGates() ReleaseGates {
	return ReleaseGates{true, true, true, true, true}
}

func TestLoaderExactRouteFailClosed(t *testing.T) {
	if err := ValidateLoaderRoute("GET", "/_BMapService/api", "v=4.0"); err != nil {
		t.Fatal(err)
	}
	invalid := [][3]string{
		{"POST", LoaderPath, "v=4.0"}, {"GET", "/_BMapService/tiles/0", "v=4.0"},
		{"GET", "//_BMapService/api", "v=4.0"}, {"GET", "/_BMapService/%61pi", "v=4.0"},
		{"GET", "/_BMapService/../api", "v=4.0"},
		{"GET", LoaderPath, "v=4.0&ak=secret"}, {"GET", LoaderPath, "v=4.0&v=4.0"},
		{"GET", LoaderPath, "v=3.0"}, {"GET", LoaderPath, "ak=secret&v=4.0"},
		{"GET", LoaderPath, "v=4%2e0"}, {"GET", LoaderPath, "v=4.0&callback=1"},
	}
	for _, in := range invalid {
		if ValidateLoaderRoute(in[0], in[1], in[2]) == nil {
			t.Fatalf("accepted %q", in)
		}
	}
}

func TestCanonicalTrustedOriginOnly(t *testing.T) {
	for _, origin := range []string{
		"http://gallery.example", "https://gallery.example/path", "https://gallery.example/?x=1",
		"https://u:p@gallery.example", "https://gallery.example/#fragment", "https://gallery.example/",
		"https://gallery.example\r\nX-Evil: yes", "//gallery.example", "https://gallery.example?next=bad",
	} {
		if _, err := TrustedProxyBase(origin); !errors.Is(err, ErrInvalidServerOrigin) {
			t.Fatalf("accepted %q", origin)
		}
	}
	s, err := TrustedProxyBase("https://gallery.example")
	if err != nil || s != "https://gallery.example/_BMapService/" {
		t.Fatalf("base %q %v", s, err)
	}
}

func TestReleaseGatesAndServerOnlyBrowserAK(t *testing.T) {
	if _, err := NewLoaderRequest(context.Background(), "https://gallery.example", "browser-ak-test", ReleaseGates{}); !errors.Is(err, ErrGateClosed) {
		t.Fatal(err)
	}
	g := completeGates()
	for n := 0; n < 5; n++ {
		z := g
		switch n {
		case 0:
			z.Licensed = false
		case 1:
			z.ObservedResourceInventory = false
		case 2:
			z.RawLeakAudit = false
		case 3:
			z.OwnerSessionAndFleetQuota = false
		case 4:
			z.PlatformIsolation = false
		}
		if _, err := NewLoaderRequest(context.Background(), "https://gallery.example", "browser-ak-test", z); !errors.Is(err, ErrGateClosed) {
			t.Fatalf("missing gate %d", n)
		}
	}
	req, err := NewLoaderRequest(context.Background(), "https://gallery.example", "private-ak-test", g)
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.Host != "api.map.baidu.com" || req.URL.Scheme != "https" || req.URL.Path != "/api" || req.Method != "GET" ||
		req.URL.Query().Get("ak") != "private-ak-test" || req.URL.Query().Get("v") != "4.0" ||
		req.Header.Get("BMAP_PROXY_URL") != "https://gallery.example/_BMapService/" ||
		req.Header.Get("Referer") != "https://gallery.example/" ||
		req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
		t.Fatal("unsafe immutable upstream plan")
	}
	if _, err := NewLoaderRequest(context.Background(), "https://gallery.example", "wrong key\n", g); err == nil {
		t.Fatal("accepted newline in AK")
	}
	if _, err := url.Parse(req.URL.String()); err != nil {
		t.Fatal(err)
	}
	if client := SafeHTTPClient(); client.CheckRedirect == nil || client.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("unsafe http client")
	}
}

func response(status int, mime, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {mime}}, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body))}
}
func TestLoaderUpstreamResponseNeverLeaksAK(t *testing.T) {
	const secret = "secret-browser-ak-very-private"
	if out, err := CheckLoaderResponse(response(200, "application/javascript", "window.BMap = {};"), secret); err != nil || string(out) != "window.BMap = {};" {
		t.Fatalf("safe JS rejected: %v", err)
	}
	for _, body := range []string{secret, "var z='" + url.QueryEscape(secret) + "';", "var z='" + url.PathEscape(secret) + "';", base64.StdEncoding.EncodeToString([]byte(secret))} {
		if _, err := CheckLoaderResponse(response(200, "application/javascript", body), secret); !errors.Is(err, ErrUnsafeUpstream) {
			t.Fatal("AK escaped in JS")
		}
	}
	for _, r := range []*http.Response{
		response(301, "application/javascript", "valid"), response(200, "text/html", "valid"),
		response(200, "application/javascript", ""), response(200, "application/javascript", strings.Repeat("a", MaxLoaderBytes+1)),
	} {
		if _, err := CheckLoaderResponse(r, secret); !errors.Is(err, ErrUnsafeUpstream) {
			t.Fatal("unsafe upstream accepted")
		}
	}
	c := response(200, "application/javascript", "valid")
	c.Header.Set("Content-Encoding", "gzip")
	if _, err := CheckLoaderResponse(c, secret); err == nil {
		t.Fatal("compressed response accepted")
	}
	redirect := response(200, "application/javascript", "valid")
	redirect.Header.Set("Location", "https://wrong.example")
	if _, err := CheckLoaderResponse(redirect, secret); err == nil {
		t.Fatal("redirect header accepted")
	}
}

func TestResponseHeaderWhitelisting(t *testing.T) {
	h := LoaderResponseHeaders()
	for _, k := range []string{"Set-Cookie", "Location", "ETag", "Server", "Access-Control-Allow-Origin"} {
		if h.Get(k) != "" {
			t.Fatalf("untrusted header: %s", k)
		}
	}
	for _, k := range []string{"Cache-Control", "X-Content-Type-Options", "Referrer-Policy", "Cross-Origin-Resource-Policy"} {
		if h.Get(k) == "" {
			t.Fatalf("missing %s", k)
		}
	}
}

func TestRedirectCannotForwardAK(t *testing.T) {
	var hits atomic.Int64
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer external.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, external.URL+"/?ak=secret", http.StatusFound)
	}))
	defer source.Close()
	res, err := SafeHTTPClient().Get(source.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusFound || hits.Load() != 0 {
		t.Fatal("client followed secret-bearing upstream redirect")
	}
}

func TestContextCancellationPropagatesToLoaderPlan(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	req, err := NewLoaderRequest(ctx, "https://gallery.example", "synthetic-browser-ak", completeGates())
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if !errors.Is(req.Context().Err(), context.Canceled) {
		t.Fatal("cancellation did not reach upstream request")
	}
}
