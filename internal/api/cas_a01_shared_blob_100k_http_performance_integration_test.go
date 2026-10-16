//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const (
	casA01NodeCount     = 100000
	casA01BlobSize      = 1024
	casA01HTTPMaxMS     = 1200000
	casA01RSSGrowthMaxB = 536870912
)

// CAS-A01 uses P046's deterministic real SHA-checked 1KiB CAS payload,
// but unlike distinct-physical P047, 100k Nodes and 100k FileVersions share
// precisely ONE immutable original inode. Check cross-owner quota and last GC.
func TestCASA01SharedBlob100KActualHTTP(t *testing.T) {
	if os.Getenv("XD_CAS_A01_SHARED_BLOB_PERF") != "1" {
		t.Skip("enable XD_CAS_A01_SHARED_BLOB_PERF")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	sample := os.Getenv("XD_CAS_A01_SAMPLE")
	if dsn == "" || !strings.HasPrefix(sample, "sample-") {
		t.Fatal("native PG17 and independent CAS-A01 sample required")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{},
		&meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.LocalPushQuotaHold{}, // production per-owner quota CTE dependency
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("P047-native-physical-HTTP", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "cas-a01-owner-"+sample, "native-physical-password")
	other := createTestUser(t, db, router, "cas-a01-other-"+sample, "other-owner-password")
	var user meta.User
	if err := db.Where("username = ?", "cas-a01-owner-"+sample).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	selected := meta.Node{
		ParentID: &root.ID, Name: "selected-physical-100k", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 2,
	}
	outside := meta.Node{
		ParentID: &root.ID, Name: "protected-outside-original.bin", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outside).Error; err != nil {
		t.Fatal(err)
	}
	deletedAt := time.Now().UTC().Add(-time.Hour)
	if err := db.Model(&selected).Updates(map[string]any{
		"deleted_at": deletedAt, "trash_root_id": selected.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, deleted_at, trash_root_id, created_at, updated_at) "+
			"SELECT ?, 'cas-a01-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, ?, ?, NOW(), NOW() FROM generate_series(0, ?) AS gs",
		selected.ID, user.ID, deletedAt, selected.ID, casA01NodeCount-1,
	).Error; err != nil {
		t.Fatal(err)
	}
	nodes, err := db.Raw(
		"SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY name ASC",
		selected.ID, user.ID,
	).Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, casA01NodeCount)
	for nodes.Next() {
		var id uint64
		if err := nodes.Scan(&id); err != nil {
			_ = nodes.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rowsErr := nodes.Err()
	_ = nodes.Close()
	if rowsErr != nil || len(ids) != casA01NodeCount {
		t.Fatalf("expected 100k unique physical Node identities: %d err=%v", len(ids), rowsErr)
	}
	// Different logical files and historical versions all reference one
	// actual verified immutable physical CAS file. No 100k-object physical
	// seeding: P047 already accepted that separate workload.
	sharedPayload := p046Bytes(0, "cas-a01-"+sample)
	sharedSHA := sha256.Sum256(sharedPayload)
	hash := fmt.Sprintf("%x", sharedSHA[:])
	key, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	physicalWriteCount := 0
	if n, writeErr := store.Put(ctx, key, bytes.NewReader(sharedPayload)); writeErr != nil || n != casA01BlobSize {
		t.Fatalf("CAS-A01 one actual immutable shared original: size=%d error=%v", n, writeErr)
	}
	physicalWriteCount++
	// 100k File references + 100k FileVersion refs + 1 same-owner
	// keeper + 1 other-owner keeper.
	const sharedRefCount int64 = 2*casA01NodeCount + 2
	if err := db.Create(&meta.ContentBlob{
		SHA256: hash, StorageKey: key, Size: casA01BlobSize,
		RefCount: sharedRefCount, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if result := db.Exec("INSERT INTO xd_files (node_id,size,storage_key,sha256,created_at,updated_at) "+
		"SELECT id, ?, ?, ?, NOW(), NOW() FROM xd_nodes WHERE parent_id = ? AND owner_id = ?",
		casA01BlobSize, key, hash, selected.ID, user.ID); result.Error != nil || result.RowsAffected != casA01NodeCount {
		t.Fatalf("CAS-A01 100k distinct File metadata rows: %d %v", result.RowsAffected, result.Error)
	}
	if result := db.Exec("INSERT INTO xd_file_versions (node_id,revision,size,storage_key,sha256,created_at) "+
		"SELECT id, 0, ?, ?, ?, NOW() FROM xd_nodes WHERE parent_id = ? AND owner_id = ?",
		casA01BlobSize, key, hash, selected.ID, user.ID); result.Error != nil || result.RowsAffected != casA01NodeCount {
		t.Fatalf("CAS-A01 100k historical FileVersion rows: %d %v", result.RowsAffected, result.Error)
	}
	if err := db.Create(&meta.File{
		NodeID: outside.ID, Size: casA01BlobSize, SHA256: hash, StorageKey: key,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// Extra real owner can use the SAME server CAS but must retain an
	// independent logical and quota-owning reference.
	var foreignUser meta.User
	if err := db.Where("username = ?", "cas-a01-other-"+sample).First(&foreignUser).Error; err != nil {
		t.Fatal(err)
	}
	var foreignRoot meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", foreignUser.ID).First(&foreignRoot).Error; err != nil {
		t.Fatal(err)
	}
	foreign := meta.Node{
		ParentID: &foreignRoot.ID, Name: "foreign-owner-shared.bin",
		Type: meta.NodeTypeFile, OwnerID: foreignUser.ID, Revision: 1,
	}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: foreign.ID, Size: casA01BlobSize, SHA256: hash, StorageKey: key,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// A distinct name or a different account must not trigger another
	// Local.Put or a second canonical inode for the same content.
	physicalCASCountBefore, physicalCASBytesBefore, invErr := p046PhysicalInventory(ctx, store)
	if invErr != nil || physicalCASCountBefore != 1 ||
		physicalCASBytesBefore != casA01BlobSize || physicalWriteCount != 1 {
		t.Fatalf("CAS-A01 storage unexpectedly duplicated: count=%d bytes=%d writes=%d err=%v",
			physicalCASCountBefore, physicalCASBytesBefore, physicalWriteCount, invErr)
	}
	var blobBefore meta.ContentBlob
	if err := db.Where("sha256 = ?", hash).First(&blobBefore).Error; err != nil ||
		blobBefore.RefCount != sharedRefCount || blobBefore.StorageKey != key {
		t.Fatalf("CAS-A01 shared ref preflight: %+v err=%v", blobBefore, err)
	}
	const logicalOriginalBytes int64 = casA01NodeCount * casA01BlobSize
	beforeCount, beforeBytes := physicalCASCountBefore, physicalCASBytesBefore
	protectedKey, protectedPayload := key, sharedPayload
	// The quota is unique-storage-key scoped per user, not 200001 times 1KiB.
	quotaStarted := time.Now()
	userQuotaBefore, quotaErr := server.loadQuotaUsage(db, user.ID, false)
	otherQuotaBefore, otherQuotaErr := server.loadQuotaUsage(db, foreignUser.ID, false)
	quotaPreflightMS := float64(time.Since(quotaStarted).Microseconds()) / 1000
	if quotaErr != nil || otherQuotaErr != nil ||
		userQuotaBefore.PhysicalUsedBytes != casA01BlobSize ||
		otherQuotaBefore.PhysicalUsedBytes != casA01BlobSize ||
		userQuotaBefore.TrashBytes != logicalOriginalBytes ||
		userQuotaBefore.HistoryBytes != logicalOriginalBytes ||
		userQuotaBefore.LogicalFileBytes != casA01BlobSize {
		t.Fatalf("CAS-A01 true per-owner quota before: %+v %+v errs=%v/%v",
			userQuotaBefore, otherQuotaBefore, quotaErr, otherQuotaErr)
	}
	insideShare := meta.Share{OwnerID: user.ID, NodeID: ids[0], TokenHash: strings.Repeat("a", 64)}
	outsideShare := meta.Share{OwnerID: user.ID, NodeID: outside.ID, TokenHash: strings.Repeat("b", 64)}
	if err := db.Create(&insideShare).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outsideShare).Error; err != nil {
		t.Fatal(err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	ids = nil
	runtime.GC()
	rssBefore, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(router)
	defer host.Close()
	httpClient := &http.Client{Timeout: 25 * time.Minute}
	uri := fmt.Sprintf("%s/api/v1/trash/%d", host.URL, selected.ID)
	perform := func(bearer string, revision uint64) (int, int, error) {
		req, err := http.NewRequest(http.MethodDelete, uri, nil)
		if err != nil {
			return 0, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
		resp, err := httpClient.Do(req)
		if err != nil {
			return 0, 0, err
		}
		defer resp.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, len(payload), err
	}
	foreignCode, _, foreignErr := perform(other, 2)
	staleCode, _, staleErr := perform(token, 999)
	if foreignErr != nil || staleErr != nil || foreignCode != http.StatusNotFound || staleCode != http.StatusConflict {
		t.Fatalf("HTTP owner and revision guards failed: %d %d %v %v", foreignCode, staleCode, foreignErr, staleErr)
	}
	var peak atomic.Int64
	peak.Store(rssBefore)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				n, err := p046RSS()
				if err == nil {
					for {
						last := peak.Load()
						if n <= last || peak.CompareAndSwap(last, n) {
							break
						}
					}
				}
			}
		}
	}()
	started := time.Now()
	status, responseBytes, httpErr := perform(token, 2)
	httpMS := float64(time.Since(started).Microseconds()) / 1000
	close(stop)
	<-done
	if last, err := p046RSS(); err == nil && last > peak.Load() {
		peak.Store(last)
	}
	cpuAfter, cpuErr := p046CPUTicks()
	if cpuErr != nil {
		t.Fatal(cpuErr)
	}
	rssGrowth := max(int64(0), peak.Load()-rssBefore)
	auditStarted := time.Now()
	afterCount, afterBytes, afterErr := p046PhysicalInventory(ctx, store)
	var selectedNodes, fileRows, versionRows, blobRows, inShares, outShares, auditRows int64
	e1 := db.Model(&meta.Node{}).Where("id = ? OR parent_id = ?", selected.ID, selected.ID).Count(&selectedNodes).Error
	e2 := db.Model(&meta.File{}).Count(&fileRows).Error
	e3 := db.Model(&meta.FileVersion{}).Count(&versionRows).Error
	e4 := db.Model(&meta.ContentBlob{}).Count(&blobRows).Error
	e5 := db.Model(&meta.Share{}).Where("id = ?", insideShare.ID).Count(&inShares).Error
	e6 := db.Model(&meta.Share{}).Where("id = ?", outsideShare.ID).Count(&outShares).Error
	e7 := db.Model(&meta.AuditEvent{}).Where(
		"actor_user_id = ? AND target_id = ?", user.ID, strconv.FormatUint(selected.ID, 10),
	).Count(&auditRows).Error
	var sibling meta.Node
	e8 := db.First(&sibling, outside.ID).Error
	untouchedSibling := e8 == nil && sibling.Revision == 1 && sibling.DeletedAt == nil
	f, openErr := store.Open(ctx, protectedKey)
	protectedOriginalUnchanged := openErr == nil
	if openErr == nil {
		data, readErr := io.ReadAll(f)
		closeErr := f.Close()
		protectedOriginalUnchanged = readErr == nil && closeErr == nil && bytes.Equal(data, protectedPayload)
	}
	onlyProtectedPhysical := afterCount == 1 && afterBytes == casA01BlobSize &&
		protectedOriginalUnchanged
	auditMS := float64(time.Since(auditStarted).Microseconds()) / 1000
	passed := httpErr == nil && status == http.StatusNoContent && responseBytes == 0 &&
		afterErr == nil && e1 == nil && e2 == nil && e3 == nil && e4 == nil &&
		e5 == nil && e6 == nil && e7 == nil && e8 == nil &&
		foreignCode == http.StatusNotFound && staleCode == http.StatusConflict &&
		selectedNodes == 0 && fileRows == 2 && versionRows == 0 && blobRows == 1 &&
		inShares == 0 && outShares == 1 && auditRows == 1 && untouchedSibling &&
		onlyProtectedPhysical && beforeCount == 1 && afterCount == 1 &&
		beforeBytes == casA01BlobSize && afterBytes == casA01BlobSize &&
		cpuAfter >= cpuBefore && httpMS > 0 && httpMS <= casA01HTTPMaxMS &&
		rssGrowth <= casA01RSSGrowthMaxB
	var blobAfter meta.ContentBlob
	refErr := db.Where("sha256 = ?", hash).First(&blobAfter).Error
	afterQuotaStarted := time.Now()
	userQuotaAfter, quotaAfterErr := server.loadQuotaUsage(db, user.ID, false)
	quotaAfterMS := float64(time.Since(afterQuotaStarted).Microseconds()) / 1000
	passed = passed && refErr == nil && blobAfter.RefCount == 2 &&
		blobAfter.State == meta.ContentBlobStateReady &&
		quotaAfterErr == nil && userQuotaAfter.PhysicalUsedBytes == casA01BlobSize &&
		userQuotaAfter.TrashBytes == 0 && userQuotaAfter.HistoryBytes == 0 &&
		userQuotaAfter.LogicalFileBytes == casA01BlobSize
	// Final reference removal is deliberately timed separately from the
	// 100k selected subtree deletion, so GC semantics are not hidden.
	finalGCStarted := time.Now()
	permanentlyDeleteTestNode(t, router, token, nodeDTO{ID: outside.ID, Revision: 1})
	var finalKeeper meta.ContentBlob
	oneLeftErr := db.Where("sha256 = ?", hash).First(&finalKeeper).Error
	if oneLeftErr != nil || finalKeeper.RefCount != 1 {
		t.Fatalf("CAS-A01 other owner's last reference disappeared early: %+v %v",
			finalKeeper, oneLeftErr)
	}
	permanentlyDeleteTestNode(t, router, other, nodeDTO{ID: foreign.ID, Revision: 1})
	lastReferenceGCMS := float64(time.Since(finalGCStarted).Microseconds()) / 1000
	finalPhysicalCount, finalPhysicalBytes, finalInventoryErr := p046PhysicalInventory(ctx, store)
	var finalBlobCount int64
	finalDBErr := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Count(&finalBlobCount).Error
	passed = passed && finalInventoryErr == nil && finalDBErr == nil &&
		finalPhysicalCount == 0 && finalPhysicalBytes == 0 && finalBlobCount == 0 &&
		lastReferenceGCMS > 0 && lastReferenceGCMS <= 120000
	result := map[string]any{
		"workload":                              "CAS-A01-real-signed-HTTP-100k-File-and-Version-shared-one-physical-Blob",
		"sample":                                sample,
		"original_CAS_SHA_unique_count":         1,
		"original_logical_file_count":           casA01NodeCount,
		"original_FileVersion_count":            casA01NodeCount,
		"shared_blob_ref_count_before":          sharedRefCount,
		"physical_write_count_before":           physicalWriteCount,
		"other_owner_physical_quota_B":          otherQuotaBefore.PhysicalUsedBytes,
		"owner_physical_quota_B":                userQuotaBefore.PhysicalUsedBytes,
		"quota_read_before_ms":                  quotaPreflightMS,
		"quota_read_after_ms":                   quotaAfterMS,
		"owner_after_physical_quota_B":          userQuotaAfter.PhysicalUsedBytes,
		"owner_after_trash_B":                   userQuotaAfter.TrashBytes,
		"owner_after_history_B":                 userQuotaAfter.HistoryBytes,
		"final_other_owner_one_ref_count":       int64(1),
		"final_physical_CAS_count":              finalPhysicalCount,
		"final_physical_CAS_bytes":              finalPhysicalBytes,
		"final_ContentBlob_rows":                finalBlobCount,
		"two_keeper_last_reference_delete_ms":   lastReferenceGCMS,
		"original_physical_CAS_count":           beforeCount,
		"original_payload_bytes":                logicalOriginalBytes,
		"physical_CAS_unlinked_count":           beforeCount - afterCount,
		"unlinked_CAS_logical_bytes":            beforeBytes - afterBytes,
		"remaining_CAS_originals":               afterCount,
		"remaining_CAS_bytes":                   afterBytes,
		"protected_outside_file_complete_bytes": protectedOriginalUnchanged,
		"selected_nodes_remaining":              selectedNodes,
		"File_rows_after":                       fileRows,
		"FileVersion_rows_after":                versionRows,
		"ContentBlob_rows_after":                blobRows,
		"deleted_share_rows_remaining":          inShares,
		"protected_share_rows_remaining":        outShares,
		"auth_audit_rows":                       auditRows,
		"outside_sibling_unchanged":             untouchedSibling,
		"foreign_owner_HTTP":                    foreignCode,
		"stale_revision_HTTP":                   staleCode,
		"owner_delete_HTTP":                     status,
		"HTTP_response_bytes":                   responseBytes,
		"HTTP_error":                            fmt.Sprint(httpErr),
		"seed_ms_excluded":                      seedMS,
		"physical_Blob_count_before":            beforeCount,
		"physical_Blob_count_after_selection":   afterCount,
		"physical_Bytes_before":                 beforeBytes,
		"physical_Bytes_after_selection":        afterBytes,
		"shared_Blob_ref_count_after_selection": int64(2),
		"HTTP_delete_ms":                        httpMS,
		"post_timer_audit_ms":                   auditMS,
		"Go_CPU_ticks":                          cpuAfter - cpuBefore,
		"Go_RSS_growth_B":                       rssGrowth,
		"HTTP_budget_ms":                        casA01HTTPMaxMS,
		"RSS_growth_budget_B":                   casA01RSSGrowthMaxB,
		"passed":                                passed,
		"scope":                                 "CAS-A01 real signed Gin HTTP 100k File + 100k FileVersion references to SAME one genuine physical 1KiB SHA Blob, owner separation/physical/quota correctness, then last-reference GC; NOT P047 100k distinct physical CAS objects or UI/PWA.",
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_A01_SHARED_REFS_REAL_HTTP %s", encoded)
	if !passed {
		t.Fatalf("CAS-A01 real HTTP 100k full original CAS current failed: %s", encoded)
	}
}
