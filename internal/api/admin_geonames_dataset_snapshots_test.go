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

func writeGeoNamesSnapshotFixture(t *testing.T, dir string) {
	t.Helper()
	for name, data := range map[string]string{
		"countryInfo.txt":      "SG\tSGP\t702\tSN\tSingapore\n",
		"admin1CodesASCII.txt": "SG.00\tSingapore\tSingapore\t1880251\n",
		"cities500.txt":        "1880252\tSingapore\tSingapore\t\t1.28967\t103.85007\tP\tPPLC\tSG\t\t00\t\t\t\t5638700\t\t\tAsia/Singapore\t2026-10-05\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGeoNamesSnapshotOnlyCopiesTrustedBoundedRegularFiles(t *testing.T) {
	source, root := t.TempDir(), t.TempDir()
	writeGeoNamesSnapshotFixture(t, source)
	if _, err := geoNamesSnapshotRoot(source, source); err == nil {
		t.Fatal("cannot snapshot into the source mount")
	}
	if _, err := geoNamesSnapshotRoot("", source); err == nil {
		t.Fatal("missing deployment root must not enable staging")
	}
	if err := os.Symlink(root, filepath.Join(t.TempDir(), "alias")); err == nil {
		// A path controlled by environment still cannot be a symbolic link.
		parent := t.TempDir()
		alias := filepath.Join(parent, "alias")
		if err := os.Symlink(root, alias); err == nil {
			if _, err := geoNamesSnapshotRoot(alias, source); err == nil {
				t.Fatal("symlink target was accepted for snapshot storage")
			}
		}
	}
	temp, fingerprint, total, version, err := copyAndValidateGeoNamesSnapshot(context.Background(), source, root, 5)
	if err != nil || len(fingerprint) != 64 || total <= 0 || version == "" {
		t.Fatalf("valid bounded snapshot failed: path=%q hash=%q bytes=%d ver=%q err=%v", temp, fingerprint, total, version, err)
	}
	defer os.RemoveAll(temp)
	original := filepath.Join(source, "cities500.txt")
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(temp, "cities500.txt"), original); err == nil {
		if _, _, _, _, err := copyAndValidateGeoNamesSnapshot(context.Background(), source, root, 5); err == nil {
			t.Fatal("symlinked data source was accepted")
		}
	} else {
		t.Skip("filesystem does not support test symlink")
	}
}

func TestGeoNamesSnapshotAdminStagePersistsOnlyValidatedImmutableData(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "geonames_snapshot_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{},
		&meta.AdminGeoNamesSetting{}, &meta.AdminGeoNamesDatasetSnapshot{}); err != nil {
		t.Fatal(err)
	}
	source, savedRoot := t.TempDir(), t.TempDir()
	writeGeoNamesSnapshotFixture(t, source)
	resolver, err := photointelligence.LoadGeoNamesResolver(source, 5)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		DB: db, Auth: auth.New("geonames-stage-test-secret", time.Hour),
		GeoNamesRuntime: photointelligence.NewReloadablePlaceResolver(resolver),
		GeoNamesDataDir: source, GeoNamesMaxDistanceKM: 5, GeoNamesSnapshotDir: savedRoot,
	}
	if err := db.Create(&meta.AdminGeoNamesSetting{
		Name: geoNamesSettingName, Revision: 2, MaxDistanceKM: 5,
	}).Error; err != nil {
		t.Fatal(err)
	}
	admin := meta.User{Username: "stage-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "stage-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := srv.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := srv.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := srv.Router()
	endpoint := "/api/v1/admin/services/geonames/dataset-snapshots"
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
	body := fmt.Sprintf(`{"expected_version":%q,"revision":2}`, resolver.Version())
	for _, tc := range []struct {
		token  string
		status int
	}{{"", http.StatusUnauthorized}, {memberToken, http.StatusForbidden}} {
		if rec := request(http.MethodPost, endpoint, tc.token, body); rec.Code != tc.status {
			t.Fatalf("non-admin staging HTTP %d, wanted %d", rec.Code, tc.status)
		}
	}
	for _, bad := range []string{
		`{}`, `{"revision":2}`,
		fmt.Sprintf(`{"revision":1,"expected_version":%q}`, resolver.Version()),
	} {
		want := http.StatusBadRequest
		if strings.Contains(bad, "\"revision\":1") {
			want = http.StatusConflict
		}
		if rec := request(http.MethodPost, endpoint, adminToken, bad); rec.Code != want {
			t.Fatalf("invalid/stale request %s gave HTTP %d, want %d", bad, rec.Code, want)
		}
	}
	originalVersion := srv.GeoNamesRuntime.Version()
	rec := request(http.MethodPost, endpoint, adminToken, body)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("snapshot HTTP %d: %s", rec.Code, rec.Body.String())
	}
	var result geoNamesSnapshotResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Staged || result.Applied || len(result.Snapshot.Fingerprint) != 64 ||
		!result.Snapshot.LocallyPresent || result.Snapshot.CheckedRevision != 2 ||
		result.Snapshot.ResolverVersion == "" {
		t.Fatalf("snapshot response falsely claimed apply or failed staging: %+v", result)
	}
	if srv.GeoNamesRuntime.Version() != originalVersion {
		t.Fatal("snapshot staging mutated the active GeoNames resolver")
	}
	if strings.Contains(rec.Body.String(), source) || strings.Contains(rec.Body.String(), savedRoot) {
		t.Fatal("host dataset paths leaked in snapshot response")
	}
	for _, file := range geoNamesSnapshotFiles {
		archived := filepath.Join(savedRoot, result.Snapshot.Fingerprint, file.Name)
		info, err := os.Lstat(archived)
		if err != nil || !info.Mode().IsRegular() {
			t.Fatalf("snapshot missing durable input file %s: %v", file.Name, err)
		}
	}
	if rec := request(http.MethodPost, endpoint, adminToken, body); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate immutable snapshot should not overwrite: HTTP %d", rec.Code)
	}
	status := request(http.MethodGet, "/api/v1/admin/services/geonames", adminToken, "")
	var config adminGeoNamesConfigDTO
	if err := json.Unmarshal(status.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	if status.Code != http.StatusOK || !config.SnapshotSupported || !config.SnapshotHistoryKnown ||
		len(config.Snapshots) != 1 || config.Snapshots[0].Fingerprint != result.Snapshot.Fingerprint {
		t.Fatalf("snapshots not visible on admin page: status=%d %+v", status.Code, config)
	}
	var audits int64
	if err := db.Model(&meta.AuditEvent{}).Count(&audits).Error; err != nil || audits != 1 {
		t.Fatalf("expected single safe audit for staging, got %d: %v", audits, err)
	}
	if err := os.WriteFile(filepath.Join(source, "cities500.txt"), []byte("broken\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, endpoint, adminToken, body); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid mounted dataset snapshot HTTP %d", rec.Code)
	}
	if srv.GeoNamesRuntime.Version() != originalVersion {
		t.Fatal("invalid staging mutated active resolver")
	}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	writeGeoNamesSnapshotFixture(t, source)
	if err := os.WriteFile(filepath.Join(source, "cities500.txt"),
		[]byte("1880252\tSingapore\tSingapore\t\t1.28967\t103.85007\tP\tPPLC\tSG\t\t00\t\t\t\t5638700\t\t\tAsia/Singapore\t2026-10-05\n9999999\tTestville\tTestville\t\t2.0\t104.0\tP\tPPL\tSG\t\t00\t\t\t\t1000\t\t\tAsia/Singapore\t2026-10-05\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodPost, endpoint, adminToken, body); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing audit must refuse snapshot publication: HTTP %d", rec.Code)
	}
	var count int64
	if err := db.Model(&meta.AdminGeoNamesDatasetSnapshot{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("failed audit must not persist new snapshot: count=%d err=%v", count, err)
	}
}
