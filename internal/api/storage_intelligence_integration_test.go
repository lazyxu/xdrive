package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	adminpkg "github.com/lazyxu/xdrive/internal/admin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestStorageIntelligenceScopesDedupAndBuckets(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "storage_intelligence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store,
		Auth:           auth.New("storage-intelligence-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 64 << 20,
	}).Router()

	adminUser, err := adminpkg.Bootstrap(db, "storage-admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	if adminUser.Role != meta.UserRoleAdmin {
		t.Fatalf("admin role=%q", adminUser.Role)
	}
	adminToken := loginTestUser(t, router, "storage-admin", "admin-password", http.StatusOK).AccessToken

	tokenA := createTestUser(t, db, router, "storage-a", "password-a")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	uploadTestFile(t, router, tokenA, rootA.ID, "small-a.txt", "abc")
	uploadTestFile(t, router, tokenA, rootA.ID, "small-b.txt", "abc")
	large := strings.Repeat("x", 20<<10)
	uploadTestFile(t, router, tokenA, rootA.ID, "large.bin", large)

	tokenB := createTestUser(t, db, router, "storage-b", "password-b")
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	uploadTestFile(t, router, tokenB, rootB.ID, "same.txt", "abc")

	statsA := requestStorageStats(t, router, "/api/v1/me/storage", tokenA, http.StatusOK)
	if statsA.Scope != "self" {
		t.Fatalf("scope=%q", statsA.Scope)
	}
	if statsA.CASBlobCount != 2 {
		t.Fatalf("user A CAS blob count=%d want=2", statsA.CASBlobCount)
	}
	wantPhysical := int64(3 + len(large))
	wantLogical := int64(6 + len(large))
	if statsA.CASPhysicalBytes != wantPhysical || statsA.CASLogicalReferencedBytes != wantLogical {
		t.Fatalf("user A bytes physical=%d logical=%d want physical=%d logical=%d", statsA.CASPhysicalBytes, statsA.CASLogicalReferencedBytes, wantPhysical, wantLogical)
	}
	if statsA.CASDedupSavedBytes != 3 {
		t.Fatalf("user A dedup saved=%d want=3", statsA.CASDedupSavedBytes)
	}
	if statsA.CASDedupRatio <= 1 || statsA.CASSavingsRatio <= 0 {
		t.Fatalf("user A dedup ratios=%f/%f", statsA.CASDedupRatio, statsA.CASSavingsRatio)
	}
	if statsA.LegacyBlobCount != 0 || statsA.LegacyPhysicalBytes != 0 {
		t.Fatalf("unexpected legacy usage: %#v", statsA)
	}
	bucketA := storageBucketByKey(statsA, "lt_16_kib")
	if bucketA.Count != 1 || bucketA.Bytes != 3 {
		t.Fatalf("<16 KiB bucket=%#v", bucketA)
	}
	bucketLarge := storageBucketByKey(statsA, "16_64_kib")
	if bucketLarge.Count != 1 || bucketLarge.Bytes != int64(len(large)) {
		t.Fatalf("16-64 KiB bucket=%#v", bucketLarge)
	}
	if statsA.P50BlobSizeBytes <= 0 || statsA.P90BlobSizeBytes < statsA.P50BlobSizeBytes || statsA.P99BlobSizeBytes < statsA.P90BlobSizeBytes {
		t.Fatalf("unexpected percentiles p50=%d p90=%d p99=%d", statsA.P50BlobSizeBytes, statsA.P90BlobSizeBytes, statsA.P99BlobSizeBytes)
	}

	statsB := requestStorageStats(t, router, "/api/v1/me/storage", tokenB, http.StatusOK)
	if statsB.CASBlobCount != 1 || statsB.CASPhysicalBytes != 3 || statsB.CASLogicalReferencedBytes != 3 {
		t.Fatalf("user B leaked cross-user statistics: %#v", statsB)
	}

	request(t, router, http.MethodGet, "/api/v1/admin/storage", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodGet, "/api/v1/admin/storage/health", tokenA, nil, http.StatusForbidden)
	global := requestStorageStats(t, router, "/api/v1/admin/storage", adminToken, http.StatusOK)
	if global.Scope != "global" || global.CASBlobCount != 2 {
		t.Fatalf("global stats=%#v", global)
	}
	wantGlobalLogical := int64(9 + len(large))
	if global.CASPhysicalBytes != wantPhysical || global.CASLogicalReferencedBytes != wantGlobalLogical || global.CASDedupSavedBytes != 6 {
		t.Fatalf("global bytes physical=%d logical=%d saved=%d", global.CASPhysicalBytes, global.CASLogicalReferencedBytes, global.CASDedupSavedBytes)
	}

	healthRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/health", adminToken, nil, http.StatusOK)
	var health maintenance.CASHealthReport
	if err := json.Unmarshal(healthRes.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if !health.Healthy || health.Status != "ok" || health.RefCountMismatches != 0 || health.MissingMetadata != 0 {
		t.Fatalf("unexpected CAS health: %+v", health)
	}

	metrics := request(t, router, http.MethodGet, "/metrics", "", nil, http.StatusOK).Body.String()
	for _, want := range []string{
		"xdrive_cas_blobs 2",
		fmt.Sprintf("xdrive_cas_physical_bytes %d", wantPhysical),
		fmt.Sprintf("xdrive_cas_logical_referenced_bytes %d", wantGlobalLogical),
		"xdrive_cas_dedup_saved_bytes 6",
		"xdrive_cas_metadata_health 1",
		"xdrive_cas_missing_metadata 0",
		"xdrive_cas_refcount_mismatches 0",
		`xdrive_cas_blob_count_by_size{range="lt_16_kib"} 1`,
		`xdrive_cas_blob_count_by_size{range="16_64_kib"} 1`,
	} {
		if !strings.Contains(metrics, want) {
			t.Fatalf("metrics missing %q:\n%s", want, metrics)
		}
	}
}

func requestStorageStats(t *testing.T, h http.Handler, path, token string, status int) storageStatsDTO {
	t.Helper()
	res := request(t, h, http.MethodGet, path, token, nil, status)
	var out storageStatsDTO
	if status/100 == 2 {
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

func storageBucketByKey(stats storageStatsDTO, key string) storageSizeBucketDTO {
	for _, bucket := range stats.Buckets {
		if bucket.Key == key {
			return bucket
		}
	}
	return storageSizeBucketDTO{}
}
