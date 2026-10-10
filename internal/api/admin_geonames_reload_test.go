package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGeoNamesReloadRequiresConfiguredRuntimeAndAuditStore(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	record := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(record)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/services/geonames/reload",
		bytes.NewBufferString(`{"expected_version":"v1"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	s.adminGeoNamesReload(ctx)
	if record.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured GeoNames reloader returned %d", record.Code)
	}
}

func TestGeoNamesAdminStatusDoesNotExposeDirectoryOrUserConnectors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{GeoNamesDataDir: "/sensitive/host/mount", GeoNamesMaxDistanceKM: 100}
	record := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(record)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/geonames", nil)
	s.adminGeoNamesConfig(ctx)
	var config adminGeoNamesConfigDTO
	if err := json.Unmarshal(record.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	if config.ReloadSupported || config.DatasetConfigured {
		t.Fatal("GeoNames must be disabled without a runtime snapshot")
	}
	if bytes.Contains(record.Body.Bytes(), []byte("/sensitive/host/mount")) ||
		bytes.Contains(record.Body.Bytes(), []byte("synology")) {
		t.Fatal("admin response leaked host path or user-specific source")
	}
}

func TestGeoNamesAdminReloadRejectsUnauthenticatedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	record := httptest.NewRecorder()
	(&Server{}).Router().ServeHTTP(record,
		httptest.NewRequest(http.MethodPost, "/api/v1/admin/services/geonames/reload",
			bytes.NewBufferString(`{"expected_version":"v1"}`)))
	if record.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated reload returned %d", record.Code)
	}
}
