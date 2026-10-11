package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminServiceDependenciesFailClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	(&Server{}).adminServiceDependencies(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("status response must not be cached")
	}
	var response serviceDependenciesSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.CheckedAt == "" || len(response.Services) != 11 {
		t.Fatalf("unexpected snapshot: %+v", response)
	}
	expected := map[string]string{
		"database":          "unavailable",
		"storage":           "unavailable",
		"media-worker":      "disabled",
		"photo-face":        "disabled",
		"photo-smart":       "disabled",
		"photo-semantic":    "disabled",
		"geonames":          "disabled",
		"baidu-map":         "disabled",
		"photo-creative":    "disabled",
		"background-worker": "unknown",
		"caddy":             "unknown",
	}
	for _, item := range response.Services {
		// Source credentials are per-user, not global service dependencies.
		if item.Group == "connectors" || item.ID == "yike" || item.ID == "synology-photos" || item.ID == "synology-files" {
			t.Fatalf("user-scoped source exposed in admin services: %q", item.ID)
		}
		if want, ok := expected[item.ID]; !ok || item.Status != want {
			t.Fatalf("invalid status for %q: got %q, expected %q", item.ID, item.Status, want)
		}
		if item.Detail == "" {
			t.Fatalf("missing detail for %q", item.ID)
		}
		if item.ConfigMode == "" || item.ApplyMode == "" || item.ConfigHint == "" {
			t.Fatalf("missing safe service configuration contract for %q", item.ID)
		}
	}
}

func TestAdminServiceDependenciesRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	(&Server{}).Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated admin endpoint returned %d", recorder.Code)
	}
}
