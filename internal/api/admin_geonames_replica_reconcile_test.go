package api

import (
	"context"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestGeoNamesReplicaReconcileRetainsLastGoodIndex(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_geonames_replica_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.AdminGeoNamesSetting{}); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	city := "1880252\tSingapore\tSingapore\t\t1.28967\t103.85007\tP\tPPLC\tSG\t\t00\t\t\t\t5638700\t\tAsia/Singapore\t2026-10-05\n"
	for name, data := range map[string]string{
		"countryInfo.txt":      "SG\tSGP\t702\tSN\tSingapore\n",
		"admin1CodesASCII.txt": "SG.00\tSingapore\tSingapore\t1880251\n",
		"cities500.txt":        city,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	initial, err := photointelligence.LoadGeoNamesResolver(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	replica := &Server{
		DB: db, GeoNamesRuntime: photointelligence.NewReloadablePlaceResolver(initial),
		GeoNamesDataDir: dir, GeoNamesMaxDistanceKM: 5,
	}
	ctx := context.Background()
	if err := replica.reconcileGeoNamesReplica(ctx); err != nil ||
		replica.GeoNamesRuntime.MaxDistanceKM() != 5 {
		t.Fatalf("unchanged settings unexpectedly rebuilt: radius=%v err=%v", replica.GeoNamesRuntime.MaxDistanceKM(), err)
	}
	if err := db.Create(&meta.AdminGeoNamesSetting{
		Name: geoNamesSettingName, Revision: 1, MaxDistanceKM: 15,
	}).Error; err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(rec)
	ginCtx.Request = httptest.NewRequest("GET", "/api/v1/admin/services/geonames", nil)
	replica.adminGeoNamesConfig(ginCtx)
	if !strings.Contains(rec.Body.String(), `"apply_state":"pending"`) {
		t.Fatalf("replica must report pending before validation: %s", rec.Body.String())
	}

	// Foreground admin commands must take precedence over the passive retry.
	replica.geoNamesReloadMu.Lock()
	if err := replica.reconcileGeoNamesReplica(ctx); err != nil {
		t.Fatal(err)
	}
	if replica.GeoNamesRuntime.MaxDistanceKM() != 5 {
		t.Fatal("background changed an index while an administrator owned the reload lock")
	}
	replica.geoNamesReloadMu.Unlock()

	pinned := replica.GeoNamesRuntime.Snapshot()
	if err := replica.reconcileGeoNamesReplica(ctx); err != nil {
		t.Fatal(err)
	}
	if replica.GeoNamesRuntime.MaxDistanceKM() != 15 ||
		pinned.Version() != initial.Version() {
		t.Fatal("pending radius was not hot-applied or an in-flight snapshot changed")
	}
	rec = httptest.NewRecorder()
	ginCtx, _ = gin.CreateTestContext(rec)
	ginCtx.Request = httptest.NewRequest("GET", "/api/v1/admin/services/geonames", nil)
	replica.adminGeoNamesConfig(ginCtx)
	if !strings.Contains(rec.Body.String(), `"apply_state":"applied"`) {
		t.Fatalf("validated replica must report applied: %s", rec.Body.String())
	}

	beforeFailure := replica.GeoNamesRuntime.Version()
	if err := db.Model(&meta.AdminGeoNamesSetting{}).
		Where("name = ?", geoNamesSettingName).
		Updates(map[string]any{"revision": uint64(2), "max_distance_km": 25.0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte("broken\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := replica.reconcileGeoNamesReplica(ctx); err == nil {
		t.Fatal("invalid replica dataset was published without a validation failure")
	}
	if replica.GeoNamesRuntime.Version() != beforeFailure ||
		replica.GeoNamesRuntime.MaxDistanceKM() != 15 {
		t.Fatal("failed replica validation must preserve last-good effective index")
	}
	if err := os.WriteFile(filepath.Join(dir, "cities500.txt"), []byte(city), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := replica.reconcileGeoNamesReplica(ctx); err != nil ||
		replica.GeoNamesRuntime.MaxDistanceKM() != 25 {
		t.Fatalf("repaired replica did not converge: radius=%v err=%v", replica.GeoNamesRuntime.MaxDistanceKM(), err)
	}
}
