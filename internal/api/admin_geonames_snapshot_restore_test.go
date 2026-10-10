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

func TestGeoNamesMissingArchiveRestoreIsAdminScopedAndKeepsLastGood(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "geonames_restore_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminGeoNamesSetting{},
		&meta.AdminGeoNamesRevision{}, &meta.AdminGeoNamesDatasetSnapshot{}); err != nil {
		t.Fatal(err)
	}
	mounted, snapshots := t.TempDir(), t.TempDir()
	writeGeoNamesSnapshotFixture(t, mounted)
	original, err := photointelligence.LoadGeoNamesResolver(mounted, 5)
	if err != nil {
		t.Fatal(err)
	}
	temp, fingerprint, total, version, err := copyAndValidateGeoNamesSnapshot(context.Background(), mounted, snapshots, 5)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(snapshots, fingerprint)
	if err := os.Rename(temp, destination); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminGeoNamesDatasetSnapshot{
		Fingerprint: fingerprint, ResolverVersion: version,
		SourceVersion: original.Version(), CheckedRadiusKM: 5,
		CheckedRevision: 2, TotalBytes: total, CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminGeoNamesSetting{
		Name: geoNamesSettingName, MaxDistanceKM: 5, Revision: 3, Fingerprint: fingerprint,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(destination); err != nil {
		t.Fatal(err)
	}
	runtime := photointelligence.NewReloadablePlaceResolver(original)
	s := &Server{
		DB: db, Auth: auth.New("test-geonames-restore-missing", time.Hour),
		PhotoPlaceResolver: runtime, GeoNamesRuntime: runtime,
		GeoNamesDataDir: mounted, GeoNamesSnapshotDir: snapshots,
		GeoNamesMaxDistanceKM: 5,
	}
	admin := meta.User{Username: "missing-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "missing-user", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
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
	endpoint := "/api/v1/admin/services/geonames/dataset-snapshots/restore-missing"
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	input := fmt.Sprintf(`{"revision":3,"expected_version":%q,"expected_fingerprint":""}`, original.Version())
	// Status only proves the directory is missing, never that the deployment
	// mount currently contains the identical archive bytes.
	initial := request(http.MethodGet, "/api/v1/admin/services/geonames", adminToken, "")
	var initialCfg adminGeoNamesConfigDTO
	if initial.Code != http.StatusOK || json.Unmarshal(initial.Body.Bytes(), &initialCfg) != nil ||
		initialCfg.MissingArchiveState != "missing" || !initialCfg.RestoreMissingEnabled ||
		initialCfg.ApplyState == "applied" || initialCfg.DesiredFingerprint != fingerprint {
		t.Fatalf("missing archive status incorrectly reported: %d %+v", initial.Code, initialCfg)
	}
	if strings.Contains(initial.Body.String(), mounted) || strings.Contains(initial.Body.String(), snapshots) {
		t.Fatal("admin status leaked a host dataset directory")
	}
	if got := request(http.MethodPost, endpoint, "", input); got.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous restore accepted: %d", got.Code)
	}
	if got := request(http.MethodPost, endpoint, memberToken, input); got.Code != http.StatusForbidden {
		t.Fatalf("user restore accepted: %d", got.Code)
	}
	for _, bad := range []struct {
		body   string
		status int
	}{
		{`{"revision":3,"expected_version":"wrong","expected_fingerprint":""}`, http.StatusConflict},
		{`{"revision":2,"expected_version":"` + original.Version() + `","expected_fingerprint":""}`, http.StatusConflict},
		{`{"revision":3,"expected_version":"` + original.Version() + `","expected_fingerprint":"../"}`, http.StatusBadRequest},
		{`{"revision":3,"expected_fingerprint":""}`, http.StatusBadRequest},
	} {
		if got := request(http.MethodPost, endpoint, adminToken, bad.body); got.Code != bad.status {
			t.Fatalf("invalid request unexpectedly passed: %d want %d, body=%s", got.Code, bad.status, bad.body)
		}
	}
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		t.Fatal("invalid calls restored a directory")
	}
	if runtime.Snapshot() != original || s.GeoNamesAppliedRevision.Load() != 0 {
		t.Fatal("unauthorized or stale request changed the resolver")
	}
	mountedCities := filepath.Join(mounted, "cities500.txt")
	previous, err := os.ReadFile(mountedCities)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mountedCities, append(append([]byte{}, previous...), []byte("extra\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodPost, endpoint, adminToken, input); got.Code != http.StatusUnprocessableEntity {
		t.Fatalf("different source bytes accepted: %d %s", got.Code, got.Body.String())
	}
	if err := os.WriteFile(mountedCities, previous, 0600); err != nil {
		t.Fatal(err)
	}
	// Existing paths are immutable, even if they contain obviously bad data.
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(destination, "do-not-delete"), []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodPost, endpoint, adminToken, input); got.Code != http.StatusConflict {
		t.Fatalf("corrupted existing archive was overwritten: %d", got.Code)
	}
	if _, err := os.Stat(filepath.Join(destination, "do-not-delete")); err != nil {
		t.Fatal("existing corrupted directory was modified or deleted", err)
	}
	if err := os.RemoveAll(destination); err != nil {
		t.Fatal(err)
	}
	// Filesystem publication rolls back if audit cannot commit.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodPost, endpoint, adminToken, input); got.Code != http.StatusServiceUnavailable {
		t.Fatalf("audit unavailable unexpectedly recovered archive: %d %s", got.Code, got.Body.String())
	}
	if _, err := os.Lstat(destination); !os.IsNotExist(err) || runtime.Snapshot() != original {
		t.Fatal("audit failure mutated archived files or last-good runtime")
	}
	if err := db.Migrator().CreateTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	pinned := runtime.Snapshot()
	success := request(http.MethodPost, endpoint, adminToken, input)
	var actual adminGeoNamesConfigDTO
	if success.Code != http.StatusOK || json.Unmarshal(success.Body.Bytes(), &actual) != nil ||
		actual.ApplyState != "applied" || actual.DesiredFingerprint != fingerprint ||
		actual.ActiveDatasetFingerprint != fingerprint || !actual.ActiveDatasetPersistent ||
		actual.MissingArchiveState != "present-unverified" || actual.RestoreMissingEnabled ||
		s.GeoNamesAppliedRevision.Load() != 3 || runtime.Snapshot() == pinned ||
		pinned.Version() != original.Version() {
		t.Fatalf("verified current Server did not acknowledge recovery: %d %+v", success.Code, actual)
	}
	gotDistance, gotRevision, gotFingerprint, err := GeoNamesStartupDesired(context.Background(), db, 5)
	if err != nil || gotDistance != 5 || gotRevision != 3 || gotFingerprint != fingerprint {
		t.Fatalf("local recovery unexpectedly changed global desired config: %.2f %d %q %v",
			gotDistance, gotRevision, gotFingerprint, err)
	}
	reopened, err := GeoNamesStartupVerifiedSnapshot(context.Background(), db, mounted, snapshots, fingerprint, 5)
	if err != nil || reopened.Version() != original.Version() {
		t.Fatalf("persisted snapshot did not verify after missing archive restore: %v", err)
	}
	var events int64
	if err := db.Model(&meta.AuditEvent{}).Where("action = ?", "admin.service.geonames.archive_restore_local").
		Count(&events).Error; err != nil || events != 1 {
		t.Fatalf("missing-archive restore did not create exactly one audit: %d %v", events, err)
	}
	if got := request(http.MethodPost, endpoint, adminToken,
		fmt.Sprintf(`{"revision":3,"expected_version":%q,"expected_fingerprint":%q}`,
			original.Version(), fingerprint)); got.Code != http.StatusConflict {
		t.Fatalf("repeated recovery accepted existing archive: %d", got.Code)
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatal(err)
	}
}
