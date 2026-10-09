package api

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type baiduMapRoundTripFunc func(*http.Request) (*http.Response, error)

func (f baiduMapRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func baiduMapTestContext(path string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, path, nil)
	c.Set("userID", uint64(42))
	return c, recorder
}

func baiduMapPNG(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestBaiduStaticMapServerProxyDoesNotExposeAK(t *testing.T) {
	rawPNG := baiduMapPNG(t)
	called := 0
	server := &Server{
		BaiduMapEnabled: true,
		BaiduMapAK:      "confidential-key-001",
		BaiduMapHTTPClient: &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			called++
			if req.URL.Scheme != "https" || req.URL.Host != "api.map.baidu.com" ||
				req.URL.Path != "/staticimage/v2" {
				t.Fatalf("unexpected upstream URL: %s", req.URL.Host+req.URL.Path)
			}
			values := req.URL.Query()
			if values.Get("ak") != "confidential-key-001" {
				t.Fatal("upstream AK missing")
			}
			for key, want := range map[string]string{
				"center": "103.820000,1.350000", "markers": "103.820000,1.350000",
				"zoom": "12", "width": "400", "height": "240",
				"coordtype": "wgs84ll", "scaler": "2",
			} {
				if values.Get(key) != want {
					t.Fatalf("%s = %q, want %q", key, values.Get(key), want)
				}
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"image/png"}},
				Body:       io.NopCloser(bytes.NewReader(rawPNG)),
			}, nil
		})},
	}
	c, recorder := baiduMapTestContext("/api/v1/media/places/baidu-static?lat=1.35&lng=103.82&zoom=12&width=400&height=240")
	server.mediaBaiduStaticMap(c)
	if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), rawPNG) || called != 1 {
		t.Fatalf("unexpected response code %d, calls %d", recorder.Code, called)
	}
	if recorder.Header().Get("Content-Type") != "image/png" || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("static map must return uncached PNG")
	}
	if strings.Contains(recorder.Body.String(), "confidential-key-001") {
		t.Fatal("AK disclosed in response")
	}
}

func TestBaiduStaticMapDisabledAndBadInputDoNotContactUpstream(t *testing.T) {
	called := 0
	server := &Server{
		BaiduMapEnabled: true,
		BaiduMapAK:      "test-ak",
		BaiduMapHTTPClient: &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			called++
			return nil, context.Canceled
		})},
	}
	for _, input := range []string{
		"lat=NaN&lng=10&zoom=12&width=400&height=240",
		"lat=1&lng=181&zoom=12&width=400&height=240",
		"lat=1&lng=2&zoom=19&width=400&height=240",
		"lat=1&lng=2&zoom=12&width=1024&height=240",
		"lat=1&lng=2&zoom=12&width=400&height=-2",
	} {
		c, recorder := baiduMapTestContext("/api/v1/media/places/baidu-static?" + input)
		server.mediaBaiduStaticMap(c)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s: got HTTP %d, want 400", input, recorder.Code)
		}
	}
	if called != 0 {
		t.Fatal("bad requests contacted Baidu")
	}

	server.BaiduMapEnabled = false
	c, recorder := baiduMapTestContext("/api/v1/media/places/baidu-static?lat=1&lng=2&zoom=12&width=400&height=240")
	server.mediaBaiduStaticMap(c)
	if recorder.Code != http.StatusServiceUnavailable || called != 0 {
		t.Fatal("disabled provider made upstream request")
	}
}

func TestBaiduStaticMapRejectsUpstreamErrorsAndRateLimit(t *testing.T) {
	called := 0
	server := &Server{
		BaiduMapEnabled: true,
		BaiduMapAK:      "secret-key",
		BaiduMapHTTPClient: &http.Client{Transport: baiduMapRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			called++
			return &http.Response{
				StatusCode: 200,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"status":302,"message":"bad AK"}`)),
			}, nil
		})},
	}
	path := "/api/v1/media/places/baidu-static?lat=1&lng=2&zoom=12&width=400&height=240"
	for i := 0; i < 31; i++ {
		c, rec := baiduMapTestContext(path)
		server.mediaBaiduStaticMap(c)
		if i < 30 && rec.Code != http.StatusBadGateway {
			t.Fatalf("request %d: got %d", i, rec.Code)
		}
		if i == 30 && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("request %d: expected 429, got %d", i, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "secret-key") {
			t.Fatal("AK leaked in upstream failure")
		}
	}
	if called != 30 {
		t.Fatalf("upstream calls %d, expected 30", called)
	}
}

func TestBaiduMapMissingAKDoesNotBecomeAnotherMapProvider(t *testing.T) {
	server := &Server{BaiduMapEnabled: true}
	c, rec := baiduMapTestContext("/api/v1/media/places/map-provider")
	server.mediaMapProviderStatus(c)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("missing AK must report unavailable Baidu provider: %d %s", rec.Code, rec.Body.String())
	}

	c, rec = baiduMapTestContext("/api/v1/media/places/baidu-static?lat=1&lng=2&zoom=12&width=400&height=240")
	server.mediaBaiduStaticMap(c)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing AK should fail map-only request, got HTTP %d", rec.Code)
	}
}

func TestBaiduMapProviderStatusNeverReturnsAK(t *testing.T) {
	server := &Server{BaiduMapEnabled: true, BaiduMapAK: "unpublished-map-key"}
	c, rec := baiduMapTestContext("/api/v1/media/places/map-provider")
	server.mediaMapProviderStatus(c)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":true`) ||
		strings.Contains(rec.Body.String(), server.BaiduMapAK) {
		t.Fatalf("unsafe map provider response %q", rec.Body.String())
	}
}

func TestBaiduStaticMapRequiresAuthenticatedRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/places/baidu-static?lat=1&lng=2&zoom=12&width=400&height=240", nil)
	(&Server{}).Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated static map response %d", rec.Code)
	}
}
