package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAdminGeoNamesReloadValidatesAuditsAndKeepsOldVersionOnFailure(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_geonames_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	files := map[string]string{
		"countryInfo.txt":      "SG\tSGP\t702\tSN\tSingapore\n",
		"admin1CodesASCII.txt": "SG.00\tSingapore\tSingapore\t1880251\n",
		"cities500.txt":        "1880252\tSingapore\tSingapore\t\t1.28967\t103.85007\tP\tPPLC\tSG\t\t00\t\t\t\t5638700\t\t\tAsia/Singapore\t2026-10-05\n",
	}
	for name, value := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	first, err := photointelligence.LoadGeoNamesResolver(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	runtime := photointelligence.NewReloadablePlaceResolver(first)
	s := &Server{
		DB: db, Auth: auth.New("test-geonames-access-token", time.Hour),
		GeoNamesRuntime: runtime, PhotoPlaceResolver: runtime,
		GeoNamesDataDir: dir, GeoNamesMaxDistanceKM: 5,
	}
	admin := meta.User{Username: "geo-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "geo-user", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(rec, req)
		return rec
	}
	statusPath := "/api/v1/admin/services/geonames"
	reloadPath := statusPath + "/reload"
	for _, token := range []struct {
		value string
		code  int
	}{{"", 401}, {memberToken, 403}} {
		if rec := request(http.MethodGet, statusPath, token.value, ""); rec.Code != token.code {
			t.Fatalf("nonadmin GET status=%d want=%d", rec.Code, token.code)
		}
		if rec := request(http.MethodPost, reloadPath, token.value, `{"expected_version":"x"}`); rec.Code != token.code {
			t.Fatalf("nonadmin POST status=%d want=%d", rec.Code, token.code)
		}
	}
	status := request(http.MethodGet, statusPath, adminToken, "")
	if status.Code != http.StatusOK || status.Header().Get("Cache-Control") != "no-store" ||
		bytes.Contains(status.Body.Bytes(), []byte(dir)) {
		t.Fatalf("unsafe GeoNames status response %d %s", status.Code, status.Body.String())
	}
	var initial adminGeoNamesConfigDTO
	if err := json.Unmarshal(status.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if initial.CurrentVersion != first.Version() || !initial.ReloadSupported || initial.RequiresRestart {
		t.Fatalf("unexpected GeoNames status: %+v", initial)
	}
	action := func(version string) *httptest.ResponseRecorder {
		return request(http.MethodPost, reloadPath, adminToken,
			`{"expected_version":"`+version+`"}`)
	}
	if rec := action("stale"); rec.Code != http.StatusConflict {
		t.Fatalf("stale version returned %d", rec.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte("broken\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := action(first.Version()); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid data returned %d", rec.Code)
	}
	if runtime.Version() != first.Version() {
		t.Fatal("invalid candidate replaced active dataset")
	}
	var beforeAudit int64
	if err := db.Model(&meta.AuditEvent{}).Count(&beforeAudit).Error; err != nil {
		t.Fatal(err)
	}
	if beforeAudit != 0 {
		t.Fatalf("failure should not have success audit: %d", beforeAudit)
	}

	city := "9999999\tTestville\tTestville\t\t2.0\t104.0\tP\tPPL\tSG\t\t00\t\t\t\t1000\t\t\tAsia/Singapore\t2026-10-05\n"
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte(files["cities500.txt"]+city), 0o600); err != nil {
		t.Fatal(err)
	}
	previous := runtime.Snapshot()
	changed := action(first.Version())
	if changed.Code != http.StatusOK {
		t.Fatalf("valid dataset returned %d %s", changed.Code, changed.Body.String())
	}
	if runtime.Version() == first.Version() || previous.Version() != first.Version() {
		t.Fatal("hot reload did not atomically preserve old version and publish new version")
	}
	var response struct {
		Applied        bool   `json:"applied"`
		Changed        bool   `json:"changed"`
		CurrentVersion string `json:"current_version"`
	}
	if err := json.Unmarshal(changed.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Applied || !response.Changed || response.CurrentVersion != runtime.Version() {
		t.Fatalf("unverified GeoNames reload: %+v", response)
	}
	if rec := action(first.Version()); rec.Code != http.StatusConflict {
		t.Fatalf("stale retry returned %d", rec.Code)
	}
	var count int64
	if err := db.Model(&meta.AuditEvent{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one successful reload audit, got %d", count)
	}
	currentVersion := runtime.Version()
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte(files["cities500.txt"]), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := action(currentVersion); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("audit unavailable returned %d", rec.Code)
	}
	if runtime.Version() != currentVersion {
		t.Fatal("unaudited change reached live resolver")
	}
}
