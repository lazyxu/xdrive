package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBaiduJSAPIStatusFailClosedWithoutBrowserAKOrProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "static-server-ak-secret"}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/media/places/baidu-jsapi/status", nil)
	s.mediaBaiduJSAPIStatus(c)
	body := rec.Body.String()
	if rec.Code != http.StatusOK ||
		!strings.Contains(body, `"enabled":false`) ||
		!strings.Contains(body, `"blocked_pending_licence_and_proxy"`) ||
		strings.Contains(body, s.BaiduMapAK) ||
		rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unsafe JSAPI status: %d %s", rec.Code, body)
	}
}

func TestBaiduJSAPISeparateConfigRejectsUnencryptedWrites(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "old-static-ak"}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/services/baidu-jsapi",
		strings.NewReader(`{"desired_enabled":true,"browser_ak":"new-jsapi-browser-ak","revision":0}`))
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminSaveBaiduJSAPIConfig(c)
	if w.Code != http.StatusServiceUnavailable ||
		strings.Contains(w.Body.String(), "new-jsapi-browser-ak") ||
		s.BaiduMapAK != "old-static-ak" ||
		baiduMapSecretName == baiduJSAPISecretName ||
		baiduMapSecretKind == baiduJSAPISecretKind {
		t.Fatalf("browser AK must not affect old Server AK or unencrypted settings: %d %s", w.Code, w.Body.String())
	}
}
