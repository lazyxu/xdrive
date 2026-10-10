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

func TestGeoNamesDatasetApplyTargetRejectsPaths(t *testing.T) {
	for _, invalid := range []string{"", "deployment/", "../", ".", "A" + strings.Repeat("f", 63),
		strings.Repeat("z", 64), strings.Repeat("0", 63)} {
		if validGeoNamesSnapshotFingerprint(invalid) {
			t.Fatalf("untrusted snapshot reference accepted: %q", invalid)
		}
	}
	if !validGeoNamesSnapshotFingerprint(strings.Repeat("a", 64)) {
		t.Fatal("canonical SHA-256 fingerprint was rejected")
	}
}

func TestGeoNamesSnapshotLocalApplyRevalidatesAndKeepsLastGood(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "geonames_local_apply_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
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
		&meta.AdminGeoNamesDatasetSnapshot{}, &meta.AdminGeoNamesRevision{}); err != nil {
		t.Fatal(err)
	}
	source, historyDir := t.TempDir(), t.TempDir()
	writeGeoNamesSnapshotFixture(t, source)
	original, err := os.ReadFile(filepath.Join(source, "cities500.txt"))
	if err != nil {
		t.Fatal(err)
	}
	first, err := photointelligence.LoadGeoNamesResolver(source, 5)
	if err != nil {
		t.Fatal(err)
	}
	rt := photointelligence.NewReloadablePlaceResolver(first)
	srv := &Server{
		DB: db, Auth: auth.New("test-geonames-local-apply-secret", time.Hour),
		GeoNamesRuntime: rt, PhotoPlaceResolver: rt,
		GeoNamesDataDir: source, GeoNamesMaxDistanceKM: 5, GeoNamesSnapshotDir: historyDir,
	}
	if err := db.Create(&meta.AdminGeoNamesSetting{
		Name: geoNamesSettingName, Revision: 2, MaxDistanceKM: 5,
	}).Error; err != nil {
		t.Fatal(err)
	}
	srv.GeoNamesAppliedRevision.Store(2)
	admin := meta.User{Username: "apply-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "apply-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
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
	request := func(path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, r)
		return out
	}
	const endpoint = "/api/v1/admin/services/geonames/dataset-snapshots"
	// Stage a real and different dataset from the operator's trusted mount,
	// then restore the original mount content. Only explicit apply may swap it.
	additional := "9999999\tTestville\tTestville\t\t2.0\t104.0\tP\tPPL\tSG\t\t00\t\t\t\t1000\t\t\tAsia/Singapore\t2026-10-05\n"
	if err := os.WriteFile(filepath.Join(source, "cities500.txt"),
		append(append([]byte{}, original...), []byte(additional)...), 0600); err != nil {
		t.Fatal(err)
	}
	stage := request(endpoint, adminToken,
		fmt.Sprintf(`{"revision":2,"expected_version":%q}`, first.Version()))
	if stage.Code != http.StatusOK {
		t.Fatalf("failed to stage candidate for apply: %d %s", stage.Code, stage.Body.String())
	}
	var staged geoNamesSnapshotResult
	if err := json.Unmarshal(stage.Body.Bytes(), &staged); err != nil {
		t.Fatal(err)
	}
	fp := staged.Snapshot.Fingerprint
	if err := os.WriteFile(filepath.Join(source, "cities500.txt"), original, 0600); err != nil {
		t.Fatal(err)
	}
	applyBody := func(revision uint64, version, active, target string) string {
		return fmt.Sprintf(`{"revision":%d,"expected_version":%q,"expected_fingerprint":%q,"target":%q}`,
			revision, version, active, target)
	}
	want := applyBody(2, first.Version(), "", fp)
	applyPath := endpoint + "/apply"
	if rec := request(applyPath, "", want); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous dataset apply allowed: %d", rec.Code)
	}
	if rec := request(applyPath, memberToken, want); rec.Code != http.StatusForbidden {
		t.Fatalf("ordinary user dataset apply allowed: %d", rec.Code)
	}
	for _, bad := range []string{
		applyBody(2, first.Version(), "", "../"),
		applyBody(2, "old", "", fp),
		applyBody(1, first.Version(), "", fp),
	} {
		rec := request(applyPath, adminToken, bad)
		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusConflict {
			t.Fatalf("invalid or stale target accepted: HTTP %d %s", rec.Code, bad)
		}
	}
	archivedFile := filepath.Join(historyDir, fp, "cities500.txt")
	archivedBytes, err := os.ReadFile(archivedFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivedFile, []byte("tampered\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if rec := request(applyPath, adminToken, want); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("modified archived bytes must be rejected, got %d", rec.Code)
	}
	if rt.Version() != first.Version() || srv.currentGeoNamesDatasetFingerprint() != "" {
		t.Fatal("corrupt archived bytes modified active resolver")
	}
	if err := os.WriteFile(archivedFile, archivedBytes, 0600); err != nil {
		t.Fatal(err)
	}
	pinned := rt.Snapshot()
	applied := request(applyPath, adminToken, want)
	if applied.Code != http.StatusOK {
		t.Fatalf("validated snapshot not applied: HTTP %d %s", applied.Code, applied.Body.String())
	}
	var cfg adminGeoNamesConfigDTO
	if err := json.Unmarshal(applied.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.ActiveDatasetFingerprint != fp || cfg.ActiveDatasetSource != "snapshot" ||
		!cfg.ActiveDatasetPersistent || cfg.DesiredFingerprint != fp || cfg.Revision != 3 ||
		cfg.EffectiveRevision != 3 || rt.Version() == first.Version() ||
		pinned.Version() != first.Version() || srv.currentGeoNamesDatasetFingerprint() != fp {
		t.Fatalf("local snapshot apply false state: %+v", cfg)
	}
	// The persisted revision and content address survive a fresh Server startup.
	startupDistance, startupRevision, startupFP, err := GeoNamesStartupDesired(context.Background(), db, 5)
	if err != nil || startupDistance != 5 || startupRevision != 3 || startupFP != fp {
		t.Fatalf("persisted dataset selection invalid: distance=%v revision=%v fp=%v err=%v",
			startupDistance, startupRevision, startupFP, err)
	}
	restored, err := GeoNamesStartupVerifiedSnapshot(
		context.Background(), db, source, historyDir, startupFP, startupDistance,
	)
	if err != nil || restored.Version() != rt.Version() {
		t.Fatalf("restart did not verify selected archived bytes: %v", err)
	}
	// An archived snapshot that was corrupted after saving must not restore.
	if err := os.WriteFile(archivedFile, []byte("corrupted-startup"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := GeoNamesStartupVerifiedSnapshot(
		context.Background(), db, source, historyDir, startupFP, startupDistance,
	); err == nil {
		t.Fatal("startup accepted changed archived bytes")
	}
	fallback := &Server{
		DB: db, GeoNamesRuntime: photointelligence.NewReloadablePlaceResolver(first),
		GeoNamesDataDir: source, GeoNamesSnapshotDir: historyDir, GeoNamesMaxDistanceKM: 5,
	}
	statusOut := httptest.NewRecorder()
	statusCtx, _ := gin.CreateTestContext(statusOut)
	statusCtx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/geonames", nil)
	fallback.adminGeoNamesConfig(statusCtx)
	var pendingConfig adminGeoNamesConfigDTO
	if json.Unmarshal(statusOut.Body.Bytes(), &pendingConfig) != nil ||
		pendingConfig.ApplyState == "applied" || pendingConfig.ActiveDatasetPersistent {
		t.Fatalf("corrupt archived startup was marked applied: %+v", pendingConfig)
	}
	if err := os.WriteFile(archivedFile, archivedBytes, 0600); err != nil {
		t.Fatal(err)
	}
	// A later global radius change must rebuild from this selected archive on
	// the current instance, not silently revert to the deployment-mounted bytes.
	if err := db.Model(&meta.AdminGeoNamesSetting{}).Where("name = ?", geoNamesSettingName).
		Updates(map[string]any{"revision": uint64(4), "max_distance_km": 8.0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := srv.reconcileGeoNamesReplica(context.Background()); err != nil {
		t.Fatal(err)
	}
	expectedFromArchive, err := photointelligence.LoadGeoNamesResolver(filepath.Join(historyDir, fp), 8)
	if err != nil {
		t.Fatal(err)
	}
	expectedFromDeployment, err := photointelligence.LoadGeoNamesResolver(source, 8)
	if err != nil {
		t.Fatal(err)
	}
	if rt.Version() != expectedFromArchive.Version() ||
		rt.Version() == expectedFromDeployment.Version() ||
		srv.currentGeoNamesDatasetFingerprint() != fp {
		t.Fatal("global radius reconcile did not retain selected content-addressed dataset")
	}
	// The existing audit gate blocks even a deployment restore. No runtime
	// swap is permitted when the audit cannot be durably persisted.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	revert := applyBody(4, rt.Version(), fp, "deployment")
	if rec := request(applyPath, adminToken, revert); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing audit accepted deployment restore: %d", rec.Code)
	}
	// A failed audit must also leave the desired database source untouched.
	_, stillRevision, stillFP, stateErr := GeoNamesStartupDesired(context.Background(), db, 5)
	if stateErr != nil || stillRevision != 4 || stillFP != fp {
		t.Fatalf("audit error changed desired dataset selection: %d %q %v", stillRevision, stillFP, stateErr)
	}
	if rt.Version() != expectedFromArchive.Version() || srv.currentGeoNamesDatasetFingerprint() != fp {
		t.Fatal("audit failure changed active data source")
	}
	if err := db.Migrator().CreateTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	rec := request(applyPath, adminToken, revert)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore operator-mounted source failed: %d %s", rec.Code, rec.Body.String())
	}
	if rt.Version() != expectedFromDeployment.Version() || srv.currentGeoNamesDatasetFingerprint() != "" ||
		srv.GeoNamesAppliedRevision.Load() != 5 {
		t.Fatal("deployment restore failed to publish a verified index")
	}
	_, restoredRevision, restoredTarget, restoredErr := GeoNamesStartupDesired(context.Background(), db, 5)
	if restoredErr != nil || restoredRevision != 5 || restoredTarget != "" {
		t.Fatalf("deployment restore was not persisted: %d %q %v", restoredRevision, restoredTarget, restoredErr)
	}
	if _, err := os.Stat(archivedFile); err != nil {
		t.Fatal("historical snapshot was deleted during deployment restore")
	}
}
