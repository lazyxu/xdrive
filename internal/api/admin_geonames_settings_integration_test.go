package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
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

func TestGeoNamesMatchingRadiusRejectsNonfiniteAndOutOfRangeValues(t *testing.T) {
	for _, value := range []float64{0, -1, 500.001, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if validGeoNamesMaxDistanceKM(value) {
			t.Fatalf("invalid radius %v accepted", value)
		}
	}
	for _, value := range []float64{0.001, 5, 100, 500} {
		if !validGeoNamesMaxDistanceKM(value) {
			t.Fatalf("valid radius %v rejected", value)
		}
	}
}

func TestAdminGeoNamesRadiusPersistedHotApplyAndPendingReplica(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_geonames_setting_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, tc := range []struct {
		token string
		want  int
	}{{"", http.StatusUnauthorized}, {memberToken, http.StatusForbidden}} {
		rec := request(http.MethodPut, endpoint, tc.token, `{"revision":0,"max_distance_km":8}`)
		if rec.Code != tc.want {
			t.Fatalf("nonadmin PUT returned %d, want %d", rec.Code, tc.want)
		}
	}
	status := request(http.MethodGet, endpoint, adminToken, "")
	var initial adminGeoNamesConfigDTO
	if err := json.Unmarshal(status.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if status.Code != http.StatusOK || initial.Revision != 0 || initial.MaxDistanceKM != 5 ||
		initial.EffectiveDistance != 5 || initial.ApplyState != "applied" ||
		initial.Source != "environment" || !initial.Editable {
		t.Fatalf("wrong initial config: HTTP %d %+v", status.Code, initial)
	}
	oldSnapshot := runtime.Snapshot()
	_, found, err := oldSnapshot.Resolve(1.3521, 103.85007)
	if err != nil || found {
		t.Fatal("5 km should not resolve the distant Singapore fixture")
	}
	for _, bad := range []string{
		`{"revision":0,"max_distance_km":0}`,
		`{"revision":0,"max_distance_km":500.01}`,
		`{"revision":0}`,
		`{"max_distance_km":8}`,
		`{}`,
	} {
		if rec := request(http.MethodPut, endpoint, adminToken, bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid radius body returned %d: %s", rec.Code, bad)
		}
	}
	saved := request(http.MethodPut, endpoint, adminToken, `{"revision":0,"max_distance_km":8}`)
	var next adminGeoNamesConfigDTO
	if err := json.Unmarshal(saved.Body.Bytes(), &next); err != nil {
		t.Fatal(err)
	}
	if saved.Code != http.StatusOK || next.Revision != 1 || next.Source != "saved" ||
		next.MaxDistanceKM != 8 || next.EffectiveDistance != 8 || next.ApplyState != "applied" ||
		next.CurrentVersion == first.Version() || next.RequiresRestart {
		t.Fatalf("persisted settings did not really apply: HTTP %d %+v", saved.Code, next)
	}
	if oldSnapshot.Version() != first.Version() {
		t.Fatal("in-flight resolver snapshot was changed")
	}
	_, found, err = runtime.Resolve(1.3521, 103.85007)
	if err != nil || !found {
		t.Fatalf("8 km resolver was not made effective: found=%v err=%v", found, err)
	}
	var row meta.AdminGeoNamesSetting
	if err := db.Where("name = ?", geoNamesSettingName).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Revision != 1 || row.MaxDistanceKM != 8 {
		t.Fatalf("GeoNames setting not persisted: %+v", row)
	}
	if distance, err := GeoNamesStartupMaxDistance(context.Background(), db, 5); err != nil || distance != 8 {
		t.Fatalf("restart lost persisted radius: radius=%v err=%v", distance, err)
	}
	if rec := request(http.MethodPut, endpoint, adminToken, `{"revision":0,"max_distance_km":10}`); rec.Code != http.StatusConflict {
		t.Fatalf("stale revision returned %d", rec.Code)
	}
	// Simulate another Server replica with an old local resolver and same DB.
	second := &Server{DB: db, GeoNamesRuntime: photointelligence.NewReloadablePlaceResolver(first),
		GeoNamesDataDir: dir, GeoNamesMaxDistanceKM: 5}
	viewRecorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(viewRecorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, endpoint, nil)
	second.adminGeoNamesConfig(ctx)
	var replicaStatus adminGeoNamesConfigDTO
	if err := json.Unmarshal(viewRecorder.Body.Bytes(), &replicaStatus); err != nil {
		t.Fatal(err)
	}
	if replicaStatus.ApplyState != "pending" || replicaStatus.MaxDistanceKM != 8 ||
		replicaStatus.EffectiveDistance != 5 || replicaStatus.Revision != 1 {
		t.Fatalf("another replica falsely claimed applied: %+v", replicaStatus)
	}
	// An invalid dataset cannot persist the next desired radius.
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte("broken\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPut, endpoint, adminToken, `{"revision":1,"max_distance_km":10}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid dataset returned %d", rec.Code)
	}
	if runtime.MaxDistanceKM() != 8 {
		t.Fatal("invalid dataset changed live radius")
	}
	if err := db.Where("name = ?", geoNamesSettingName).Take(&row).Error; err != nil || row.Revision != 1 {
		t.Fatalf("invalid dataset changed saved revision: %+v err=%v", row, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte(files["cities500.txt"]), 0o600); err != nil {
		t.Fatal(err)
	}
	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("expected one successful configuration audit, got %d", auditCount)
	}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPut, endpoint, adminToken, `{"revision":1,"max_distance_km":10}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing audit database returned %d", rec.Code)
	}
	if runtime.MaxDistanceKM() != 8 {
		t.Fatal("audit failure changed live resolver")
	}
	var after meta.AdminGeoNamesSetting
	if err := db.Where("name = ?", geoNamesSettingName).Take(&after).Error; err != nil ||
		after.Revision != 1 || after.MaxDistanceKM != 8 {
		t.Fatalf("audit failure persisted settings: %+v err=%v", after, err)
	}
	if bytes.Contains(status.Body.Bytes(), []byte(dir)) || bytes.Contains(saved.Body.Bytes(), []byte(dir)) {
		t.Fatal("GeoNames response leaked deployment mount path")
	}
}
