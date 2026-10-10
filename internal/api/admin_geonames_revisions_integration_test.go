package api

import (
	"context"
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

func TestAdminGeoNamesRevisionJournalRollbackAndAudit(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_geonames_rollback_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminGeoNamesSetting{}, &meta.AdminGeoNamesRevision{}); err != nil {
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
	server := &Server{
		DB: db, Auth: auth.New("geonames-radius-integration-secret", time.Hour),
		GeoNamesRuntime: runtime, PhotoPlaceResolver: runtime,
		GeoNamesDataDir: dir, GeoNamesMaxDistanceKM: 5,
	}
	admin := meta.User{Username: "geo-radius-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "geo-radius-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := server.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := server.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := server.Router()
	endpoint := "/api/v1/admin/services/geonames"
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
	for _, token := range []string{"", memberToken} {
		status := http.StatusForbidden
		if token == "" {
			status = http.StatusUnauthorized
		}
		for _, endpoint := range []string{endpoint + "/revisions", endpoint + "/rollback"} {
			method, body := http.MethodGet, ""
			if strings.HasSuffix(endpoint, "/rollback") {
				method, body = http.MethodPost, `{"revision":1,"target_revision":0}`
			}
			if rec := request(method, endpoint, token, body); rec.Code != status {
				t.Fatalf("nonadmin %s %s: got %d want %d", method, endpoint, rec.Code, status)
			}
		}
	}
	historyEndpoint := endpoint + "/revisions"
	rollbackEndpoint := endpoint + "/rollback"
	if response := request(http.MethodGet, historyEndpoint, adminToken, ""); response.Code != http.StatusOK {
		t.Fatalf("empty history returned HTTP %d", response.Code)
	}
	// First save preserves the original deployment radius as revision 0.
	save := request(http.MethodPut, endpoint, adminToken, `{"revision":0,"max_distance_km":8}`)
	if save.Code != http.StatusOK || runtime.MaxDistanceKM() != 8 {
		t.Fatalf("initial radius did not apply: HTTP %d, radius %v: %s",
			save.Code, runtime.MaxDistanceKM(), save.Body.String())
	}
	var history geoNamesRevisionPage
	readHistory := func() {
		t.Helper()
		rec := request(http.MethodGet, historyEndpoint, adminToken, "")
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &history) != nil {
			t.Fatalf("read GeoNames history: %d %s", rec.Code, rec.Body.String())
		}
	}
	readHistory()
	if len(history.Items) != 2 || history.Items[0].Revision != 1 ||
		history.Items[0].MaxDistanceKM != 8 || history.Items[0].Origin != "saved" ||
		history.Items[1].Revision != 0 || history.Items[1].MaxDistanceKM != 5 ||
		history.Items[1].Origin != "environment" {
		t.Fatalf("wrong immutable history after initial save: %+v", history.Items)
	}
	oldEight := runtime.Snapshot()
	rollback := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":1,"target_revision":0}`)
	var effective adminGeoNamesConfigDTO
	if rollback.Code != http.StatusOK || json.Unmarshal(rollback.Body.Bytes(), &effective) != nil ||
		effective.Revision != 2 || effective.MaxDistanceKM != 5 ||
		effective.EffectiveDistance != 5 || effective.ApplyState != "applied" {
		t.Fatalf("rollback did not hot-apply revision 2: %d %+v", rollback.Code, effective)
	}
	_, oldFound, oldErr := oldEight.Resolve(1.3521, 103.85007)
	if runtime.Version() != first.Version() || oldErr != nil || !oldFound {
		t.Fatal("rollback changed in-flight immutable snapshot or failed to restore original resolver")
	}
	if value, err := GeoNamesStartupMaxDistance(context.Background(), db, 5); err != nil || value != 5 {
		t.Fatalf("rollback was not persisted for restart: %v %v", value, err)
	}
	readHistory()
	if len(history.Items) != 3 || history.Items[0].Revision != 2 ||
		history.Items[0].Origin != "rollback" || history.Items[0].MaxDistanceKM != 5 {
		t.Fatalf("rollback was not added to immutable history: %+v", history.Items)
	}
	if rec := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":1,"target_revision":0}`); rec.Code != http.StatusConflict {
		t.Fatalf("stale rollback returned %d", rec.Code)
	}
	if rec := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":2,"target_revision":2}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("not-older rollback returned %d", rec.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte("broken\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":2,"target_revision":1}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid dataset rollback returned %d", rec.Code)
	}
	if runtime.MaxDistanceKM() != 5 {
		t.Fatal("invalid dataset modified effective resolver")
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte(files["cities500.txt"]), 0o600); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.AuditEvent{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("expected one save and one rollback audit, got %d (%v)", count, err)
	}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":2,"target_revision":1}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing audit database rollback returned %d", rec.Code)
	}
	var after meta.AdminGeoNamesSetting
	if err := db.Where("name = ?", geoNamesSettingName).First(&after).Error; err != nil ||
		after.Revision != 2 || after.MaxDistanceKM != 5 || runtime.MaxDistanceKM() != 5 {
		t.Fatalf("failed rollback changed effective or desired settings: %+v err=%v", after, err)
	}
	if err := db.Where("name = ? AND revision = ?", geoNamesSettingName, 0).
		Delete(&meta.AdminGeoNamesRevision{}).Error; err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, rollbackEndpoint, adminToken,
		`{"revision":2,"target_revision":0}`); rec.Code != http.StatusNotFound {
		t.Fatalf("missing historical revision returned %d", rec.Code)
	}
	if strings.Contains(save.Body.String(), dir) || strings.Contains(rollback.Body.String(), dir) {
		t.Fatal("GeoNames response leaked Server host dataset directory")
	}
}
