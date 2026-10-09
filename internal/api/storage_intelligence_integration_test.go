package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
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
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{}, &meta.StorageSample{},
		&meta.StagingCleanupRun{}, &meta.StagingCleanupFailure{}, &meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	storageRoot := t.TempDir()
	hostRoot := t.TempDir()
	store, err := storage.NewLocal(storageRoot)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth:                 auth.New("storage-intelligence-secret", time.Hour),
		RefreshTTL:           24 * time.Hour,
		AllowedOrigin:        "http://localhost",
		MaxUploadBytes:       64 << 20,
		FilesDataHostPath:    storageRoot,
		PostgresDataHostPath: filepath.Join(hostRoot, "data", "postgres"),
		BackupRootHostPath:   filepath.Join(hostRoot, "backups"),
		XDriveHomeHostPath:   hostRoot,
		CaddyDataHostPath:    filepath.Join(hostRoot, "data", "caddy", "data"),
		CaddyConfigHostPath:  filepath.Join(hostRoot, "data", "caddy", "config"),
	}
	router := server.Router()

	adminUser, err := adminpkg.Bootstrap(db, "storage-admin", "admin-password")
	if err != nil {
		t.Fatal(err)
	}
	if adminUser.Role != meta.UserRoleAdmin {
		t.Fatalf("admin role=%q", adminUser.Role)
	}
	adminToken := loginTestUser(t, router, "storage-admin", "admin-password", http.StatusOK).AccessToken

	tokenA := createTestUser(t, db, router, "storage-a", "password-a")
	var storageUserA meta.User
	if err := db.First(&storageUserA, "username = ?", "storage-a").Error; err != nil {
		t.Fatal(err)
	}
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	smallA := uploadTestFile(t, router, tokenA, rootA.ID, "small-a.txt", "abc")
	uploadTestFile(t, router, tokenA, rootA.ID, "small-b.txt", "abc")
	large := strings.Repeat("x", 20<<10)
	uploadTestFile(t, router, tokenA, rootA.ID, "large.bin", large)

	tokenB := createTestUser(t, db, router, "storage-b", "password-b")
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	uploadTestFile(t, router, tokenB, rootB.ID, "same.txt", "abc")

	selfBody := request(t, router, http.MethodGet, "/api/v1/me/storage", tokenA, nil, http.StatusOK).Body.String()
	for _, forbidden := range []string{"cas_blob_count", "cas_physical_bytes", "buckets", "inventory", "disk_total_bytes"} {
		if strings.Contains(selfBody, `"`+forbidden+`"`) {
			t.Fatalf("self storage response leaked global/CAS field %q: %s", forbidden, selfBody)
		}
	}
	statsA := requestStorageStats(t, router, "/api/v1/me/storage", tokenA, http.StatusOK)
	if statsA.Scope != "self" {
		t.Fatalf("scope=%q", statsA.Scope)
	}
	if statsA.DiskTotalBytes != nil || statsA.DiskUsedBytes != nil || statsA.DiskAvailableBytes != nil ||
		statsA.XDrivePhysicalBytes != nil || statsA.UploadStaging != nil || statsA.Inventory != nil {
		t.Fatalf("self storage stats leaked global physical state: %#v", statsA)
	}
	wantPhysical := int64(3 + len(large))
	wantLogical := int64(6 + len(large))
	if statsA.DuplicateGroupCount != 1 || statsA.DuplicateFileCount != 1 || statsA.DuplicateLogicalBytes != 3 {
		t.Fatalf("user A duplicate accounting groups=%d extra=%d saved=%d", statsA.DuplicateGroupCount, statsA.DuplicateFileCount, statsA.DuplicateLogicalBytes)
	}
	if statsA.FileCount != 3 || statsA.LogicalFileBytes != wantLogical {
		t.Fatalf("user A file stats count=%d logical=%d want count=3 logical=%d", statsA.FileCount, statsA.LogicalFileBytes, wantLogical)
	}
	if statsA.CASBlobCount != 0 || statsA.CASPhysicalBytes != 0 || len(statsA.Buckets) != 0 {
		t.Fatalf("self storage stats exposed CAS data: %#v", statsA)
	}
	bucketA := storageFileBucketByKey(statsA, "lt_16_kib")
	if bucketA.Count != 2 || bucketA.Bytes != 6 {
		t.Fatalf("user <16 KiB file bucket=%#v", bucketA)
	}
	bucketLarge := storageFileBucketByKey(statsA, "16_64_kib")
	if bucketLarge.Count != 1 || bucketLarge.Bytes != int64(len(large)) {
		t.Fatalf("user 16-64 KiB file bucket=%#v", bucketLarge)
	}
	if statsA.P50FileSizeBytes <= 0 || statsA.P90FileSizeBytes < statsA.P50FileSizeBytes || statsA.P99FileSizeBytes < statsA.P90FileSizeBytes {
		t.Fatalf("unexpected file percentiles p50=%d p90=%d p99=%d", statsA.P50FileSizeBytes, statsA.P90FileSizeBytes, statsA.P99FileSizeBytes)
	}

	statsB := requestStorageStats(t, router, "/api/v1/me/storage", tokenB, http.StatusOK)
	if statsB.DuplicateGroupCount != 0 || statsB.DuplicateFileCount != 0 || statsB.DuplicateLogicalBytes != 0 {
		t.Fatalf("user B duplicate accounting leaked another account: %+v", statsB)
	}
	if statsB.FileCount != 1 || statsB.LogicalFileBytes != 3 || statsB.CASBlobCount != 0 {
		t.Fatalf("user B storage stats leaked cross-user/global statistics: %#v", statsB)
	}

	request(t, router, http.MethodGet, "/api/v1/admin/storage", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodGet, "/api/v1/admin/storage/health", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodGet, "/api/v1/admin/storage/legacy", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodGet, "/api/v1/admin/storage/unreferenced-blobs", tokenA, nil, http.StatusForbidden)

	legacyParentID := rootA.ID
	legacyNode := meta.Node{
		ParentID: &legacyParentID,
		Name:     "legacy-nine.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  storageUserA.ID,
		Revision: 2,
	}
	if err := db.Create(&legacyNode).Error; err != nil {
		t.Fatal(err)
	}
	legacyKey := "legacy/manual-nine"
	if err := db.Create(&meta.File{
		NodeID: legacyNode.ID, Size: 9, StorageKey: legacyKey,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: legacyNode.ID, Revision: 1, Size: 9, StorageKey: legacyKey,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), legacyKey, strings.NewReader("123456789")); err != nil {
		t.Fatal(err)
	}

	initialGlobal := requestStorageStats(t, router, "/api/v1/admin/storage", adminToken, http.StatusOK)
	if initialGlobal.PhysicalSnapshotAt != nil || initialGlobal.Inventory != nil ||
		initialGlobal.UploadStaging != nil || initialGlobal.UnreferencedBlobCount != 0 {
		t.Fatalf("global page performed physical discovery before the background snapshot: %#v", initialGlobal)
	}
	sampleNow := time.Date(2026, 9, 25, 12, 30, 0, 0, time.UTC)
	unreferencedKey := storage.ContentBlobDir + "/sha256/ff/" + strings.Repeat("f", 64)
	if err := db.Create(&meta.ContentBlob{
		SHA256:     strings.Repeat("f", 64),
		StorageKey: unreferencedKey,
		Size:       9,
		RefCount:   0,
		State:      meta.ContentBlobStateDeleting,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), unreferencedKey, strings.NewReader("123456789")); err != nil {
		t.Fatal(err)
	}
	missingUnreferencedKey := storage.ContentBlobDir + "/sha256/ee/" + strings.Repeat("e", 64)
	if err := db.Create(&meta.ContentBlob{
		SHA256:     strings.Repeat("e", 64),
		StorageKey: missingUnreferencedKey,
		Size:       123,
		RefCount:   0,
		State:      meta.ContentBlobStateDeleting,
	}).Error; err != nil {
		t.Fatal(err)
	}

	legacyDetailsRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/legacy?limit=20", adminToken, nil, http.StatusOK)
	var legacyDetails storageLegacyObjectPageDTO
	if err := json.Unmarshal(legacyDetailsRes.Body.Bytes(), &legacyDetails); err != nil {
		t.Fatal(err)
	}
	if len(legacyDetails.Items) != 1 ||
		legacyDetails.Items[0].StorageKey != legacyKey ||
		legacyDetails.Items[0].Size != 9 ||
		legacyDetails.Items[0].CurrentFileRefs != 1 ||
		legacyDetails.Items[0].HistoryVersionRefs != 1 {
		t.Fatalf("unexpected legacy storage details: %+v", legacyDetails)
	}

	unreferencedDetailsRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/unreferenced-blobs?limit=20", adminToken, nil, http.StatusOK)
	var unreferencedDetails storageUnreferencedBlobPageDTO
	if err := json.Unmarshal(unreferencedDetailsRes.Body.Bytes(), &unreferencedDetails); err != nil {
		t.Fatal(err)
	}
	if len(unreferencedDetails.Items) != 2 {
		t.Fatalf("unexpected unreferenced detail count: %+v", unreferencedDetails)
	}
	var physicalDetail, missingDetail *storageUnreferencedBlobDTO
	for index := range unreferencedDetails.Items {
		item := &unreferencedDetails.Items[index]
		switch item.StorageKey {
		case unreferencedKey:
			physicalDetail = item
		case missingUnreferencedKey:
			missingDetail = item
		}
	}
	if physicalDetail == nil || !physicalDetail.PhysicalExists || physicalDetail.PhysicalSize != 9 ||
		physicalDetail.GCStatus != "awaiting_gc" {
		t.Fatalf("unexpected physical unreferenced detail: %+v", physicalDetail)
	}
	if missingDetail == nil || missingDetail.PhysicalExists || missingDetail.GCStatus != "physical_missing" {
		t.Fatalf("unexpected missing unreferenced detail: %+v", missingDetail)
	}

	reuseGuard := meta.UploadPart{
		SessionID:        "storage-detail-reuse",
		PartIndex:        0,
		Size:             1,
		SHA256:           strings.Repeat("d", 64),
		StorageKey:       storage.UploadStagingDir + "/storage-detail-reuse/0",
		Reused:           true,
		SourceStorageKey: unreferencedKey,
	}
	if err := db.Create(&reuseGuard).Error; err != nil {
		t.Fatal(err)
	}
	blockedRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/unreferenced-blobs?limit=20", adminToken, nil, http.StatusOK)
	var blocked storageUnreferencedBlobPageDTO
	if err := json.Unmarshal(blockedRes.Body.Bytes(), &blocked); err != nil {
		t.Fatal(err)
	}
	foundBlocked := false
	for _, item := range blocked.Items {
		if item.StorageKey == unreferencedKey {
			foundBlocked = true
			if item.GCStatus != "blocked_by_upload" || item.ReusedUploadParts != 1 {
				t.Fatalf("unexpected blocked GC detail: %+v", item)
			}
		}
	}
	if !foundBlocked {
		t.Fatal("blocked GC detail missing")
	}
	var storageProgress []storageSampleProgress
	if err := server.captureStorageSampleWithProgress(
		context.Background(),
		sampleNow,
		true,
		func(value storageSampleProgress) {
			storageProgress = append(storageProgress, value)
		},
	); err != nil {
		t.Fatal(err)
	}
	phaseSeen := make(map[string]bool)
	var gcDeterminate, inventoryObserved, persisted bool
	for _, progress := range storageProgress {
		phaseSeen[progress.Phase] = true
		if progress.Phase == meta.SystemMaintenancePhaseStorageSampleGC &&
			progress.Total == 2 &&
			progress.Current == 2 {
			gcDeterminate = true
		}
		if progress.Phase == meta.SystemMaintenancePhaseStorageSampleInventory &&
			progress.Current > 0 &&
			progress.Bytes > 0 {
			inventoryObserved = true
		}
		if progress.Phase == meta.SystemMaintenancePhaseStorageSamplePersist &&
			progress.Current == 1 &&
			progress.Total == 1 {
			persisted = true
		}
	}
	for _, phase := range []string{
		meta.SystemMaintenancePhaseStorageSampleStats,
		meta.SystemMaintenancePhaseStorageSampleGC,
		meta.SystemMaintenancePhaseStorageSampleHealth,
		meta.SystemMaintenancePhaseStorageSampleStaging,
		meta.SystemMaintenancePhaseStorageSampleInventory,
		meta.SystemMaintenancePhaseStorageSamplePersist,
	} {
		if !phaseSeen[phase] {
			t.Fatalf("storage sampler progress missing phase %q: %+v", phase, storageProgress)
		}
	}
	if !gcDeterminate {
		t.Fatalf("GC progress did not expose real current/total: %+v", storageProgress)
	}
	if !inventoryObserved {
		t.Fatalf("inventory progress did not expose scanned item/byte counts: %+v", storageProgress)
	}
	if !persisted {
		t.Fatalf("storage sampler progress did not report persisted terminal sample: %+v", storageProgress)
	}
	global := requestStorageStats(t, router, "/api/v1/admin/storage", adminToken, http.StatusOK)
	if global.Scope != "global" || global.CASBlobCount != 2 || global.PhysicalSnapshotAt == nil {
		t.Fatalf("global stats=%#v", global)
	}
	if global.UnreferencedBlobCount != 1 || global.UnreferencedBlobBytes != 9 {
		t.Fatalf("physical unreferenced blobs count=%d bytes=%d want 1/9", global.UnreferencedBlobCount, global.UnreferencedBlobBytes)
	}
	if global.PendingGC == nil ||
		global.PendingGC.BlockedByUploadBlobCount != 1 ||
		global.PendingGC.BlockedByUploadBlobBytes != 9 ||
		global.PendingGC.PhysicalMissingBlobCount != 1 ||
		global.PendingGC.PhysicalMissingMetadataBytes != 123 ||
		global.PendingGC.AwaitingGCBlobCount != 0 ||
		global.PendingGC.MetadataInconsistentBlobCount != 0 ||
		global.PendingGC.DeletingBlobCount != 2 ||
		global.PendingGC.DeletingBlobMetadataBytes != 132 {
		t.Fatalf("unexpected pending GC snapshot: %+v", global.PendingGC)
	}
	if global.CASHealth == nil ||
		global.CASHealth.DeletingBlobs != 2 ||
		global.CASHealth.MissingMetadata != 0 ||
		global.CASHealth.RefCountMismatches != 0 {
		t.Fatalf("unexpected CAS health snapshot: %+v", global.CASHealth)
	}
	if err := db.Delete(&reuseGuard).Error; err != nil {
		t.Fatal(err)
	}
	if global.DiskTotalBytes == nil || global.DiskUsedBytes == nil || global.DiskAvailableBytes == nil || global.XDrivePhysicalBytes == nil {
		t.Fatalf("global stats missing disk capacity: %#v", global)
	}
	if *global.DiskTotalBytes <= 0 || *global.DiskAvailableBytes < 0 || *global.DiskAvailableBytes > *global.DiskTotalBytes {
		t.Fatalf("invalid global disk capacity: %#v", global)
	}
	if *global.DiskUsedBytes != *global.DiskTotalBytes-*global.DiskAvailableBytes {
		t.Fatalf("disk used=%d total=%d available=%d", *global.DiskUsedBytes, *global.DiskTotalBytes, *global.DiskAvailableBytes)
	}
	wantGlobalLogical := int64(9 + len(large))
	if global.CASPhysicalBytes != wantPhysical || global.CASLogicalReferencedBytes != wantGlobalLogical || global.CASDedupSavedBytes != 6 {
		t.Fatalf("global bytes physical=%d logical=%d saved=%d", global.CASPhysicalBytes, global.CASLogicalReferencedBytes, global.CASDedupSavedBytes)
	}
	wantXDrivePhysical := global.CASPhysicalBytes + global.LegacyPhysicalBytes + global.UnreferencedBlobBytes
	if *global.XDrivePhysicalBytes != wantXDrivePhysical {
		t.Fatalf("xdrive physical=%d want=%d", *global.XDrivePhysicalBytes, wantXDrivePhysical)
	}
	if global.Inventory == nil {
		t.Fatal("global storage stats missing physical inventory")
	}
	for _, item := range global.Inventory.Items {
		if item.Path == "" || strings.Contains(item.Path, "$XD_") {
			t.Fatalf("inventory item has unresolved path: %+v", item)
		}
		if item.Path != "宿主机绝对路径不可用" && !filepath.IsAbs(strings.TrimSuffix(item.Path, "/*-512.jpg")) &&
			!filepath.IsAbs(strings.TrimSuffix(item.Path, "/*-1280.jpg")) &&
			!strings.Contains(item.Path, "**/.xdrive-upload-*") {
			t.Fatalf("inventory path is not absolute: %+v", item)
		}
	}
	if got := storageInventoryItemByKey(*global.Inventory, "cas").Path; got != filepath.Join(storageRoot, storage.ContentBlobDir) {
		t.Fatalf("CAS host path=%q want=%q", got, filepath.Join(storageRoot, storage.ContentBlobDir))
	}

	stagingNow := time.Now().UTC()
	activeSession := meta.UploadSession{
		ID: "staging-active", OwnerID: adminUser.ID,
		TotalSize: 20, ChunkSize: 10, ChunkCount: 2,
		Status: meta.UploadStatusActive, ReservedBytes: 40,
		ExpiresAt: stagingNow.Add(time.Hour),
	}
	expiredSession := meta.UploadSession{
		ID: "staging-expired", OwnerID: adminUser.ID,
		TotalSize: 7, ChunkSize: 7, ChunkCount: 1,
		Status: meta.UploadStatusActive, ReservedBytes: 14,
		ExpiresAt: stagingNow.Add(-time.Hour),
	}
	if err := db.Create(&activeSession).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&expiredSession).Error; err != nil {
		t.Fatal(err)
	}
	knownKey := storage.UploadStagingDir + "/admin/staging-active/known"
	expiredKey := storage.UploadStagingDir + "/admin/staging-expired/expired"
	oldOrphanKey := storage.UploadStagingDir + "/orphan/old"
	recentKey := storage.UploadStagingDir + "/orphan/recent"
	for key, body := range map[string]string{
		knownKey:     "known",
		expiredKey:   "expired",
		oldOrphanKey: "orphan-old",
		recentKey:    "recent",
	} {
		if _, err := store.Put(context.Background(), key, strings.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := stagingNow.Add(-2 * time.Hour)
	if err := os.Chtimes(filepath.Join(storageRoot, filepath.FromSlash(oldOrphanKey)), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.UploadPart{
		{SessionID: activeSession.ID, PartIndex: 0, Size: 5, SHA256: strings.Repeat("a", 64), StorageKey: knownKey},
		{SessionID: activeSession.ID, PartIndex: 1, Size: 9, SHA256: strings.Repeat("b", 64), StorageKey: storage.UploadStagingDir + "/admin/staging-active/missing"},
		{SessionID: expiredSession.ID, PartIndex: 0, Size: 7, SHA256: strings.Repeat("c", 64), StorageKey: expiredKey},
	}).Error; err != nil {
		t.Fatal(err)
	}
	server.invalidateUploadStagingSnapshot()
	if err := server.captureStorageSample(context.Background(), sampleNow.Add(time.Hour), true); err != nil {
		t.Fatal(err)
	}

	request(t, router, http.MethodGet, "/api/v1/admin/storage/staging", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodPost, "/api/v1/admin/storage/staging/cleanup", tokenA, strings.NewReader(`{}`), http.StatusForbidden)
	stagingRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/staging?limit=20&offset=0", adminToken, nil, http.StatusOK)
	var staging uploadStagingDetailDTO
	if err := json.Unmarshal(stagingRes.Body.Bytes(), &staging); err != nil {
		t.Fatal(err)
	}
	if !staging.Stats.Supported ||
		staging.Stats.ActiveSessions != 1 ||
		staging.Stats.ReservedBytes != 40 ||
		staging.Stats.StagingFiles != 4 ||
		staging.Stats.StagingBytes != 28 ||
		staging.Stats.OrphanFiles != 1 ||
		staging.Stats.OrphanBytes != 10 ||
		staging.Stats.RecentUntrackedFiles != 1 ||
		staging.Stats.RecentUntrackedBytes != 6 ||
		staging.Stats.MissingPartFiles != 1 ||
		staging.Stats.MissingPartBytes != 9 ||
		staging.Stats.ExpiredSessions != 1 ||
		staging.Stats.ExpiredStagingFiles != 1 ||
		staging.Stats.ExpiredStagingBytes != 7 ||
		staging.Stats.ReclaimableFiles != 2 ||
		staging.Stats.ReclaimableBytes != 17 {
		t.Fatalf("unexpected staging stats: %+v", staging.Stats)
	}
	if len(staging.Orphans) != 1 || staging.Orphans[0].Key != oldOrphanKey {
		t.Fatalf("unexpected staging orphans: %+v", staging.Orphans)
	}

	globalWithStaging := requestStorageStats(t, router, "/api/v1/admin/storage", adminToken, http.StatusOK)
	if globalWithStaging.UploadStaging == nil || globalWithStaging.UploadStaging.StagingBytes != 28 {
		t.Fatalf("global stats missing staging: %#v", globalWithStaging)
	}
	wantWithStaging := globalWithStaging.CASPhysicalBytes + globalWithStaging.LegacyPhysicalBytes + globalWithStaging.UnreferencedBlobBytes + 28
	if globalWithStaging.XDrivePhysicalBytes == nil || *globalWithStaging.XDrivePhysicalBytes != wantWithStaging {
		t.Fatalf("xdrive physical with staging=%v want=%d", globalWithStaging.XDrivePhysicalBytes, wantWithStaging)
	}

	cleanupRes := request(t, router, http.MethodPost, "/api/v1/admin/storage/staging/cleanup", adminToken, strings.NewReader(`{}`), http.StatusOK)
	var cleanup uploadStagingCleanupDTO
	if err := json.Unmarshal(cleanupRes.Body.Bytes(), &cleanup); err != nil {
		t.Fatal(err)
	}
	if cleanup.DeletedFiles != 2 || cleanup.DeletedBytes != 17 || cleanup.FailedFiles != 0 {
		t.Fatalf("unexpected staging cleanup: %+v", cleanup)
	}
	if cleanup.RunID == 0 {
		t.Fatal("staging cleanup did not persist a run id")
	}
	cleanupRunsRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/staging/cleanup-runs?limit=20&offset=0", adminToken, nil, http.StatusOK)
	var cleanupRuns []stagingCleanupRunDTO
	if err := json.Unmarshal(cleanupRunsRes.Body.Bytes(), &cleanupRuns); err != nil {
		t.Fatal(err)
	}
	if len(cleanupRuns) == 0 || cleanupRuns[0].ID != cleanup.RunID || cleanupRuns[0].Status != meta.StagingCleanupStatusSuccess {
		t.Fatalf("unexpected staging cleanup history: %+v", cleanupRuns)
	}
	cleanupFailuresRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/admin/storage/staging/cleanup-runs/%d/failures?limit=20&offset=0", cleanup.RunID), adminToken, nil, http.StatusOK)
	var cleanupFailures []stagingCleanupFailureDTO
	if err := json.Unmarshal(cleanupFailuresRes.Body.Bytes(), &cleanupFailures); err != nil {
		t.Fatal(err)
	}
	if len(cleanupFailures) != 0 {
		t.Fatalf("successful cleanup unexpectedly has failures: %+v", cleanupFailures)
	}
	if cleanup.Stats.OrphanFiles != 0 || cleanup.Stats.ExpiredSessions != 0 ||
		cleanup.Stats.RecentUntrackedFiles != 1 || cleanup.Stats.MissingPartFiles != 1 ||
		cleanup.Stats.StagingFiles != 2 || cleanup.Stats.StagingBytes != 11 {
		t.Fatalf("unexpected staging stats after cleanup: %+v", cleanup.Stats)
	}
	if _, err := store.Open(context.Background(), recentKey); err != nil {
		t.Fatalf("recent untracked staging was deleted: %v", err)
	}
	if _, err := store.Open(context.Background(), knownKey); err != nil {
		t.Fatalf("active staging was deleted: %v", err)
	}

	thumbnailKey := ".xdrive-media/thumbnails/aa/test-512.jpg"
	analysisKey := ".xdrive-media/thumbnails/aa/test-1280.jpg"
	if _, err := store.Put(context.Background(), thumbnailKey, strings.NewReader("thumb")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), analysisKey, strings.NewReader("analysis")); err != nil {
		t.Fatal(err)
	}
	server.invalidateStorageInventory()
	request(t, router, http.MethodPost, "/api/v1/admin/storage/cache/cleanup", tokenA, strings.NewReader(`{"kind":"media_thumbnail"}`), http.StatusForbidden)
	cacheCleanupRes := request(t, router, http.MethodPost, "/api/v1/admin/storage/cache/cleanup", adminToken, strings.NewReader(`{"kind":"media_thumbnail"}`), http.StatusOK)
	var cacheCleanup storageCacheCleanupDTO
	if err := json.Unmarshal(cacheCleanupRes.Body.Bytes(), &cacheCleanup); err != nil {
		t.Fatal(err)
	}
	if cacheCleanup.DeletedFiles != 1 || cacheCleanup.DeletedBytes != int64(len("thumb")) || cacheCleanup.FailedFiles != 0 {
		t.Fatalf("unexpected thumbnail cleanup: %+v", cacheCleanup)
	}
	if _, err := store.Open(context.Background(), thumbnailKey); !os.IsNotExist(err) {
		t.Fatalf("thumbnail cache still exists after cleanup: %v", err)
	}
	if _, err := store.Open(context.Background(), analysisKey); err != nil {
		t.Fatalf("analysis preview was incorrectly deleted: %v", err)
	}
	canonicalKey, err := storage.ContentAddressedKey(smallA.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(context.Background(), canonicalKey); err != nil {
		t.Fatalf("canonical CAS file was incorrectly deleted: %v", err)
	}

	failedOrphanKey := storage.UploadStagingDir + "/orphan/delete-fails"
	if _, err := store.Put(context.Background(), failedOrphanKey, strings.NewReader("cannot-delete")); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(storageRoot, filepath.FromSlash(failedOrphanKey)), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	server.Store = &stagingDeleteFailStore{Local: store, failKey: failedOrphanKey}
	server.invalidateUploadStagingSnapshot()
	failedCleanupRes := request(t, router, http.MethodPost, "/api/v1/admin/storage/staging/cleanup", adminToken, strings.NewReader(`{}`), http.StatusOK)
	var failedCleanup uploadStagingCleanupDTO
	if err := json.Unmarshal(failedCleanupRes.Body.Bytes(), &failedCleanup); err != nil {
		t.Fatal(err)
	}
	if failedCleanup.RunID == 0 || failedCleanup.FailedFiles != 1 {
		t.Fatalf("expected one persisted cleanup failure: %+v", failedCleanup)
	}
	failedRunRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/admin/storage/staging/cleanup-runs/%d/failures?limit=20&offset=0", failedCleanup.RunID), adminToken, nil, http.StatusOK)
	var failedDetails []stagingCleanupFailureDTO
	if err := json.Unmarshal(failedRunRes.Body.Bytes(), &failedDetails); err != nil {
		t.Fatal(err)
	}
	if len(failedDetails) != 1 || failedDetails[0].StorageKey != failedOrphanKey || !strings.Contains(failedDetails[0].Error, "forced staging delete failure") {
		t.Fatalf("unexpected cleanup failure details: %+v", failedDetails)
	}

	healthRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/health", adminToken, nil, http.StatusOK)
	var health maintenance.CASHealthReport
	if err := json.Unmarshal(healthRes.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if !health.Healthy || health.Status != "ok" || health.RefCountMismatches != 0 || health.MissingMetadata != 0 {
		t.Fatalf("unexpected CAS health: %+v", health)
	}

	request(t, router, http.MethodGet, "/api/v1/admin/storage/history", tokenA, nil, http.StatusForbidden)
	if err := db.Create(&meta.StorageSample{
		SlotAt:      sampleNow.Add(-181 * 24 * time.Hour).Truncate(storageSampleInterval),
		CapturedAt:  sampleNow.Add(-181 * 24 * time.Hour),
		BucketsJSON: "[]",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.captureStorageSampleIfDue(context.Background(), sampleNow); err != nil {
		t.Fatal(err)
	}
	if err := server.captureStorageSampleIfDue(context.Background(), sampleNow.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var sampleCount int64
	if err := db.Model(&meta.StorageSample{}).Count(&sampleCount).Error; err != nil {
		t.Fatal(err)
	}
	if sampleCount != 1 {
		t.Fatalf("storage sample count=%d want=1 for one daily slot", sampleCount)
	}
	historyRes := request(t, router, http.MethodGet, "/api/v1/admin/storage/history?days=180", adminToken, nil, http.StatusOK)
	var history storageHistoryDTO
	if err := json.Unmarshal(historyRes.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Samples) != 1 || history.Samples[0].CASBlobCount != 2 {
		t.Fatalf("unexpected storage history: %+v", history)
	}
	point := history.Samples[0]
	if !point.GCClassificationSnapshotAvailable ||
		point.AwaitingGCBlobCount != 1 ||
		point.AwaitingGCBlobBytes != 9 ||
		point.BlockedByUploadBlobCount != 0 ||
		point.PhysicalMissingBlobCount != 1 ||
		point.PhysicalMissingMetadataBytes != 123 ||
		point.DeletingBlobMetadataBytes != 132 {
		t.Fatalf("unexpected GC history point: %+v", point)
	}
	if !point.CASHealthSnapshotAvailable ||
		point.DeletingBlobCount != 2 ||
		point.MissingMetadataCount != 0 ||
		point.RefCountMismatchCount != 0 {
		t.Fatalf("unexpected CAS health history point: %+v", point)
	}
	if history.Decision.Priority != "collecting" || history.SamplingIntervalHours != 24 || history.RetentionDays != 180 {
		t.Fatalf("unexpected storage history decision/config: %+v", history)
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

func storageInventoryItemByKey(inventory storageInventoryDTO, key string) storageInventoryItemDTO {
	for _, item := range inventory.Items {
		if item.Key == key {
			return item
		}
	}
	return storageInventoryItemDTO{}
}

func storageBucketByKey(stats storageStatsDTO, key string) storageSizeBucketDTO {
	for _, bucket := range stats.Buckets {
		if bucket.Key == key {
			return bucket
		}
	}
	return storageSizeBucketDTO{}
}

func storageFileBucketByKey(stats storageStatsDTO, key string) storageSizeBucketDTO {
	for _, bucket := range stats.FileBuckets {
		if bucket.Key == key {
			return bucket
		}
	}
	return storageSizeBucketDTO{}
}

type stagingDeleteFailStore struct {
	*storage.Local
	failKey string
}

func (s *stagingDeleteFailStore) DeleteStaging(ctx context.Context, key string) error {
	if key == s.failKey {
		return fmt.Errorf("forced staging delete failure")
	}
	return s.Local.DeleteStaging(ctx, key)
}
