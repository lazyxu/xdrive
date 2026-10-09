package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminBaiduMapStatusNeverExposesDeploymentAK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "deployment-only-test-key"}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/baidu-map", nil)
	s.adminBaiduMapConfig(c)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"configured":true`) ||
		!strings.Contains(w.Body.String(), `"editable":false`) ||
		!strings.Contains(w.Body.String(), `"requires_restart":false`) ||
		strings.Contains(w.Body.String(), s.BaiduMapAK) {
		t.Fatalf("unsafe admin configuration status: HTTP %d %s", w.Code, w.Body.String())
	}
}

func TestAdminBaiduMapSaveRequiresEncryptedStorage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "deployment-only-test-key"}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/services/baidu-map",
		strings.NewReader(`{"enabled":true,"ak":"new-map-ak","revision":0}`))
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminSaveBaiduMapConfig(c)
	if w.Code != http.StatusServiceUnavailable || strings.Contains(w.Body.String(), "new-map-ak") {
		t.Fatalf("missing encrypted storage must fail closed: HTTP %d %s", w.Code, w.Body.String())
	}
	// The existing deployment configuration is not changed by a rejected save.
	if s.BaiduMapAK != "deployment-only-test-key" {
		t.Fatal("failed save modified the deployment AK")
	}
}
