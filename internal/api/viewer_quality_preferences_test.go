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

func TestViewerQualityPreferenceRequiresAuthenticatedOwnerAndDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/me/viewer-quality", nil)
	(&Server{}).getViewerQualityPreference(c)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("unavailable preferences must fail closed: %d", rec.Code)
	}
}

func TestViewerQualityPreferenceIsolatedCASPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "viewer_pref_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := adminDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = adminDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()
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
	if err := db.AutoMigrate(&meta.ViewerQualityPreference{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db}
	invoke := func(uid uint64, method, body string) (*httptest.ResponseRecorder, viewerQualityPreferenceDTO) {
		t.Helper()
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Set("userID", uid)
		c.Request = httptest.NewRequest(method, "/api/v1/me/viewer-quality", strings.NewReader(body))
		if method == http.MethodPut {
			s.putViewerQualityPreference(c)
		} else {
			s.getViewerQualityPreference(c)
		}
		var result viewerQualityPreferenceDTO
		if rec.Code == http.StatusOK && json.Unmarshal(rec.Body.Bytes(), &result) != nil {
			t.Fatalf("invalid JSON result %s", rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("viewer preference response was cacheable")
		}
		return rec, result
	}
	r, before := invoke(11, http.MethodGet, "")
	if r.Code != http.StatusOK || before.Revision != 0 || before.Preset != "high" {
		t.Fatalf("default must be high: %+v", before)
	}
	r, after := invoke(11, http.MethodPut, `{"revision":0,"preset":"economy"}`)
	if r.Code != http.StatusOK || after.Revision != 1 || after.Preset != "economy" {
		t.Fatalf("owner save failed: %s", r.Body.String())
	}
	r, other := invoke(12, http.MethodGet, "")
	if r.Code != http.StatusOK || other.Revision != 0 || other.Preset != "high" {
		t.Fatal("account A preference escaped into account B")
	}
	r, _ = invoke(11, http.MethodPut, `{"revision":0,"preset":"high"}`)
	if r.Code != http.StatusConflict {
		t.Fatal("concurrent stale revision overwrote current preference")
	}
	r, _ = invoke(11, http.MethodPut, `{"revision":1,"preset":"high","user_id":12}`)
	if r.Code != http.StatusBadRequest {
		t.Fatal("forged Owner field accepted")
	}
	r, after = invoke(11, http.MethodPut, `{"revision":1,"preset":"balanced"}`)
	if r.Code != http.StatusOK || after.Revision != 2 || after.Preset != "balanced" {
		t.Fatalf("updated owner CAS failed: %s", r.Body.String())
	}
	r, _ = invoke(12, http.MethodGet, "")
	if r.Code != http.StatusOK {
		t.Fatal("other Owner read failed")
	}
}
