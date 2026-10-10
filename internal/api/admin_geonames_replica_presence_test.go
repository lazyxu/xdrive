package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestGeoNamesReplicaSummaryOnlyTrustsMatchingObservedRevisionAndDataset(t *testing.T) {
	desired := geoNamesDesiredConfig{MaxDistanceKM: 8, Revision: 2}
	good := meta.GeoNamesReplicaPresence{
		InstanceID: "internal-only-1", Configured: true,
		ResolverVersion: "v1:fixture", MaxDistanceKM: 8, AppliedRevision: 2,
	}
	good2 := good
	good2.InstanceID = "internal-only-2"

	check := func(name string, rows []meta.GeoNamesReplicaPresence, truncated bool,
		wantState string, wantApplied int, consistent bool) {
		t.Helper()
		got := summarizeGeoNamesReplicas(desired, rows, truncated)
		if got.State != wantState || got.AppliedInstances != wantApplied ||
			got.DatasetConsistent != consistent {
			t.Fatalf("%s: got %+v, want %s / %d / consistent=%v",
				name, got, wantState, wantApplied, consistent)
		}
	}
	check("no heartbeats", nil, false, "unavailable", 0, false)
	check("two verified replicas", []meta.GeoNamesReplicaPresence{good, good2}, false, "applied", 2, true)
	// Equal radius/revision/version alone cannot acknowledge an archived
	// desired dataset unless the instance reports the exact fingerprint.
	archived := desired
	archived.Fingerprint = strings.Repeat("a", 64)
	wrong := summarizeGeoNamesReplicas(archived, []meta.GeoNamesReplicaPresence{good, good2}, false)
	if wrong.State != "pending" || wrong.AppliedInstances != 0 {
		t.Fatalf("archive provenance wrongly marked applied: %+v", wrong)
	}

	stale := good2
	stale.AppliedRevision = 1
	check("same radius but old revision", []meta.GeoNamesReplicaPresence{good, stale}, false, "pending", 1, true)

	diff := good2
	diff.ResolverVersion = "v1:other-dataset"
	check("divergent immutable datasets", []meta.GeoNamesReplicaPresence{good, diff}, false, "pending", 2, false)

	missing := good2
	missing.Configured = false
	missing.ResolverVersion = ""
	check("unconfigured instance", []meta.GeoNamesReplicaPresence{good, missing}, false, "pending", 1, false)
	check("cap prevents false all-applied", []meta.GeoNamesReplicaPresence{good}, true, "pending", 1, true)

	withoutRevision := desired
	withoutRevision.Revision = 0
	got := summarizeGeoNamesReplicas(withoutRevision, []meta.GeoNamesReplicaPresence{good}, false)
	if got.State != "unmanaged" {
		t.Fatalf("deployment defaults must not claim managed fleet apply: %+v", got)
	}
}

func TestGeoNamesReplicaHeartbeatPersistedAndAdminSummaryRedacted(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "geonames_presence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.AdminGeoNamesSetting{}, &meta.GeoNamesReplicaPresence{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminGeoNamesSetting{
		Name: geoNamesSettingName, MaxDistanceKM: 8, Revision: 2,
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secretID := "never-return-this-instance-id"
	row := meta.GeoNamesReplicaPresence{
		InstanceID: secretID, Configured: true, ResolverVersion: "v1:trusted-fixture",
		MaxDistanceKM: 8, AppliedRevision: 1,
		HeartbeatAt: now, ExpiresAt: now.Add(time.Minute),
	}
	if err := publishGeoNamesReplicaPresence(context.Background(), db, row); err != nil {
		t.Fatal(err)
	}
	row.AppliedRevision = 2
	if err := publishGeoNamesReplicaPresence(context.Background(), db, row); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&meta.GeoNamesReplicaPresence{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("expected upserted single instance row: count=%d err=%v", count, err)
	}
	expired := row
	expired.InstanceID = "stale-instance-never-counted"
	expired.ExpiresAt = now.Add(-time.Second)
	if err := publishGeoNamesReplicaPresence(context.Background(), db, expired); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server := &Server{DB: db, GeoNamesMaxDistanceKM: 8}
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/geonames", nil)
	server.adminGeoNamesConfig(ctx)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin GeoNames status HTTP %d: %s", rec.Code, rec.Body.String())
	}
	var got adminGeoNamesConfigDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ReplicaApplyState != "applied" || got.ObservedInstances != 1 ||
		got.AppliedInstances != 1 || !got.DatasetConsistent ||
		len(got.DatasetVersions) != 1 || got.DatasetVersions[0].Count != 1 {
		t.Fatalf("fresh heartbeat/revision aggregate incorrect: %+v", got)
	}
	if strings.Contains(rec.Body.String(), secretID) ||
		strings.Contains(rec.Body.String(), expired.InstanceID) ||
		strings.Contains(rec.Body.String(), "search_path") {
		t.Fatal("GeoNames admin summary leaked internal instance identity or DB details")
	}
}
