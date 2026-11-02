package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAdminViewerQualityUnavailableDoesNotSilentlyAllowUnlimited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/viewer-quality", nil)
	(&Server{}).adminGetViewerQuality(c)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("admin policy unavailable was not fail-closed: %d", rec.Code)
	}
}

func TestAdminViewerQualityMaximumPersistenceCASPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "viewer_admin_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := adminDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = adminDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := dsnURL.Query()
	q.Set("search_path", schema)
	dsnURL.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.AdminViewerQualitySetting{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db}
	invoke := func(method, body string) (*httptest.ResponseRecorder, adminViewerQualityDTO) {
		t.Helper()
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(method, "/api/v1/admin/services/viewer-quality", strings.NewReader(body))
		if method == http.MethodPut { s.adminPutViewerQuality(c) } else { s.adminGetViewerQuality(c) }
		var result adminViewerQualityDTO
		if rec.Code == http.StatusOK && json.Unmarshal(rec.Body.Bytes(), &result) != nil {
			t.Fatalf("invalid admin response: %s", rec.Body.String())
		}
		return rec, result
	}
	r, defaults := invoke(http.MethodGet, "")
	if r.Code != http.StatusOK || defaults.Revision != 0 || defaults.Maximum != "high" || defaults.CacheBudgetBytes != 10<<30 {
		t.Fatal("unexpected administrator default", defaults)
	}
	r, changed := invoke(http.MethodPut, `{"revision":0,"maximum_preset":"balanced"}`)
	if r.Code != http.StatusOK || changed.Revision != 1 || changed.Maximum != "balanced" ||
		changed.CacheBudgetBytes != 10<<30 {
		t.Fatal("administrator save failed", r.Body.String())
	}
	r, _ = invoke(http.MethodPut, `{"revision":0,"maximum_preset":"high"}`)
	if r.Code != http.StatusConflict {
		t.Fatal("stale admin write was accepted")
	}
	r, _ = invoke(http.MethodPut, `{"revision":1,"maximum_preset":"8k"}`)
	if r.Code != http.StatusBadRequest {
		t.Fatal("unbounded tier was accepted")
	}
	r, changed = invoke(http.MethodPut, `{"revision":1,"maximum_preset":"economy","cache_budget_bytes":1073741824}`)
	if r.Code != http.StatusOK || changed.Maximum != "economy" ||
		changed.CacheBudgetBytes != 1<<30 {
		t.Fatal("new administrator cap not persisted")
	}
	r, _ = invoke(http.MethodPut, `{"revision":2,"maximum_preset":"economy","cache_budget_bytes":0}`)
	if r.Code != http.StatusBadRequest {
		t.Fatal("zero cache budget accepted")
	}
	real, err := s.readAdminViewerQualityMaximum(httptest.NewRequest(http.MethodGet, "/", nil).Context())
	if err != nil || real.Maximum != "economy" || real.CacheBudgetBytes != 1<<30 {
		t.Fatal("request-time administrator cap is inconsistent", err, real)
	}
}
