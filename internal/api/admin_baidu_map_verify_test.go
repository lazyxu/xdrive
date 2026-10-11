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

func TestBaiduMapLiveVerifyFixedInputImageAndFailures(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 128, 128))); err != nil {
		t.Fatal(err)
	}
	secret := "sensitive-test-server-ak"
	for _, tc := range []struct {
		name        string
		code        int
		contentType string
		data        []byte
		want        string
	}{
		{"valid", 200, "image/png", pngBytes.Bytes(), "verified"},
		{"forbidden", 403, "application/json", []byte("{}"), "denied"},
		{"invalid-key-json", 200, "application/json", []byte(`{"status":302}`), "unavailable"},
		{"redirect", 302, "text/plain", []byte("https://attacker.invalid"), "unavailable"},
		{"truncated-png", 200, "image/png", pngBytes.Bytes()[:12], "unavailable"},
		{"fake-png", 200, "image/png", append(append([]byte{}, baiduPNGHeader...), []byte("fake")...), "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			s := &Server{BaiduMapHTTPClient: &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.Host != "api.map.baidu.com" || req.URL.Scheme != "https" ||
					req.URL.Path != "/staticimage/v2" || req.URL.Query().Get("ak") != secret ||
					req.URL.Query().Get("center") != "116.407400,39.904200" ||
					req.URL.Query().Get("width") != "128" || req.URL.Query().Get("height") != "128" {
					t.Fatalf("unexpected map verifier upstream input")
				}
				return &http.Response{StatusCode: tc.code, Header: http.Header{"Content-Type": []string{tc.contentType}},
					Body: io.NopCloser(bytes.NewReader(tc.data))}, nil
			})}}
			if got := s.baiduMapLiveVerify(context.Background(), secret); got != tc.want || calls != 1 {
				t.Fatalf("state %s expected %s, calls %d", got, tc.want, calls)
			}
		})
	}
}

func TestBaiduMapLiveVerifyAuditUnavailableNeverCallsNetwork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	calls := 0
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "secret", BaiduMapHTTPClient: &http.Client{
		Transport: baiduMapRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			calls++
			return nil, context.Canceled
		})},
	}
	out := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(out)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/services/baidu-map/verify",
		strings.NewReader(`{"revision":0}`))
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminVerifyBaiduMap(c)
	if out.Code != 503 || calls != 0 || strings.Contains(out.Body.String(), "secret") {
		t.Fatalf("missing audit backend must fail closed: HTTP %d calls %d", out.Code, calls)
	}
}
