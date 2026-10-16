//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// P055 reuses P047's proven genuine 100k distinct physical CAS seed only.
// It measures owner-authenticated Trash RESTORE rather than deletion; the
// original SHA contents and allocated physical inode bytes must not change.
func TestP055TrashRestore100KPhysicalCASHTTP(t *testing.T) {
	if os.Getenv("XD_P055_REAL_PHYSICAL_RESTORE_PERF") != "1" {
		t.Skip("enable XD_P055_REAL_PHYSICAL_RESTORE_PERF")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	sample := os.Getenv("XD_P055_SAMPLE")
	if dsn == "" || !strings.HasPrefix(sample, "sample-") {
		t.Fatal("native PG17 and independent P055 sample required")
	}

	sourceCount := p047SourceCount
	smoke := os.Getenv("XD_P055_SMOKE") == "1"
	if smoke {
		sourceCount = 1000
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{},
		&meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("P055-native-physical-HTTP", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "p055-owner-"+sample, "native-physical-password")
	other := createTestUser(t, db, router, "p055-other-"+sample, "other-owner-password")
	var user meta.User
	if err := db.Where("username = ?", "p055-owner-"+sample).First(&user).Error; err != nil {
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
			"SELECT ?, 'p055-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, ?, ?, NOW(), NOW() FROM generate_series(0, ?) AS gs",
		selected.ID, user.ID, deletedAt, selected.ID, sourceCount-1,
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
	ids := make([]uint64, 0, sourceCount)
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
	if rowsErr != nil || len(ids) != sourceCount {
		t.Fatalf("expected 100k unique physical Node identities: %d err=%v", len(ids), rowsErr)
	}
	unique := make(map[string]struct{}, sourceCount)
	blobs := make([]meta.ContentBlob, 0, 250)
	files := make([]meta.File, 0, 250)
	versions := make([]meta.FileVersion, 0, 250)
	flush := func() {
		if err := db.CreateInBatches(&blobs, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&files, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&versions, 250).Error; err != nil {
			t.Fatal(err)
		}
		blobs = blobs[:0]
		files = files[:0]
		versions = versions[:0]
	}
	sourceHash := sha256.New()
	var logicalOriginalBytes int64
	for index, nodeID := range ids {
		payload := p046Bytes(index, "p055-"+sample)
		sum := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", sum[:])
		if _, found := unique[hash]; found {
			t.Fatal("P055 actual original CAS SHA collision")
		}
		unique[hash] = struct{}{}
		_, _ = sourceHash.Write(sum[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		n, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || n != int64(p047SourceBytes) {
			t.Fatalf("P055 Local.Put source %d: n=%d err=%v", index, n, err)
		}
		logicalOriginalBytes += n
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: n, RefCount: 2,
			State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: nodeID, Size: n, SHA256: hash, StorageKey: key,
		})
		versions = append(versions, meta.FileVersion{
			NodeID: nodeID, Revision: 0, Size: n, SHA256: hash, StorageKey: key,
		})
		if len(files) == 250 {
			flush()
		}
	}
	if len(files) > 0 {
		flush()
	}
	if len(unique) != sourceCount || logicalOriginalBytes != int64(sourceCount*p047SourceBytes) {
		t.Fatal("P055 originals are not 100k distinct real 1KiB CAS payloads")
	}
	protectedPayload := p046Bytes(sourceCount, "p055-"+sample)
	protectedSum := sha256.Sum256(protectedPayload)
	protectedHash := fmt.Sprintf("%x", protectedSum[:])
	protectedKey, err := storage.ContentAddressedKey(protectedHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, repeated := unique[protectedHash]; repeated {
		t.Fatal("outside physical sentinel collided with selected originals")
	}
	if n, err := store.Put(ctx, protectedKey, bytes.NewReader(protectedPayload)); err != nil || n != p047SourceBytes {
		t.Fatalf("outside CAS protected original Put failed n=%d err=%v", n, err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: protectedHash, StorageKey: protectedKey, Size: p047SourceBytes,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: outside.ID, SHA256: protectedHash, StorageKey: protectedKey, Size: p047SourceBytes,
	}).Error; err != nil {
		t.Fatal(err)
	}
	insideShare := meta.Share{OwnerID: user.ID, NodeID: ids[0], TokenHash: strings.Repeat("a", 64)}
	outsideShare := meta.Share{OwnerID: user.ID, NodeID: outside.ID, TokenHash: strings.Repeat("b", 64)}
	if err := db.Create(&insideShare).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outsideShare).Error; err != nil {
		t.Fatal(err)
	}
	beforeCount, beforeBytes, err := p046PhysicalInventory(ctx, store)
	if err != nil || beforeCount != int64(sourceCount+1) || beforeBytes != int64((sourceCount+1)*p047SourceBytes) {
		t.Fatalf("P055 physical CAS preflight count=%d bytes=%d err=%v", beforeCount, beforeBytes, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	unique = nil
	ids = nil
	blobs, files, versions = nil, nil, nil
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
	client := &http.Client{Timeout: 5 * time.Minute}
	url := fmt.Sprintf("%s/api/v1/trash/%d/restore", host.URL, selected.ID)
	perform := func(bearer string, revision uint64) (int, []byte, error) {
		req, err := http.NewRequest(http.MethodPost, url, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
		resp, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer resp.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, payload, err
	}
	foreignCode, _, foreignErr := perform(other, 2)
	staleCode, _, staleErr := perform(token, 999)
	if foreignErr != nil || staleErr != nil ||
		foreignCode != http.StatusNotFound || staleCode != http.StatusConflict {
		t.Fatalf("owner 404/stale 409 restore preflight=%d/%d errs=%v/%v",
			foreignCode, staleCode, foreignErr, staleErr)
	}
	beforeAllocatedCount, beforeAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || beforeAllocatedCount != int64(sourceCount+1) ||
		beforeAllocated < int64(sourceCount+1)*4096 {
		t.Fatalf("P055 original inode allocation: count=%d allocated=%d err=%v",
			beforeAllocatedCount, beforeAllocated, err)
	}
	beforeWrite := p055ProcWrites()
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
				value, err := p046RSS()
				if err == nil {
					for {
						prior := peak.Load()
						if value <= prior || peak.CompareAndSwap(prior, value) {
							break
						}
					}
				}
			}
		}
	}()
	started := time.Now()
	status, response, httpErr := perform(token, 2)
	httpMS := float64(time.Since(started).Microseconds()) / 1000
	close(stop)
	<-done
	if value, err := p046RSS(); err == nil {
		for {
			prior := peak.Load()
			if value <= prior || peak.CompareAndSwap(prior, value) {
				break
			}
		}
	}
	afterWrite := p055ProcWrites()
	cpuAfter, cpuErr := p046CPUTicks()
	if cpuErr != nil {
		t.Fatal(cpuErr)
	}
	rssGrowth := max(int64(0), peak.Load()-rssBefore)
	writeDelta := uint64(0)
	if afterWrite >= beforeWrite {
		writeDelta = afterWrite - beforeWrite
	}
	verifyStart := time.Now()
	var returned nodeDTO
	if status == http.StatusOK {
		if err := json.Unmarshal(response, &returned); err != nil {
			t.Fatalf("restore response not a real Node: %v %q", err, response)
		}
	}
	var restored, incorrectlyDeleted, fileRows, versionRows, blobRows, shareRows int64
	if err := db.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND trash_root_id IS NULL AND revision = 1",
		user.ID, selected.ID,
	).Count(&restored).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ?", user.ID, selected.ID).
		Where("deleted_at IS NOT NULL OR trash_root_id IS NOT NULL OR revision <> 1").
		Count(&incorrectlyDeleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Count(&fileRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileVersion{}).Count(&versionRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.ContentBlob{}).Count(&blobRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Share{}).Where("id IN ?", []uint64{insideShare.ID, outsideShare.ID}).
		Count(&shareRows).Error; err != nil {
		t.Fatal(err)
	}
	var rootAfter, sibling meta.Node
	if err := db.First(&rootAfter, selected.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&sibling, outside.ID).Error; err != nil {
		t.Fatal(err)
	}
	rootRestored := rootAfter.DeletedAt == nil && rootAfter.TrashRootID == nil &&
		rootAfter.Revision == 3
	siblingUnchanged := sibling.DeletedAt == nil && sibling.TrashRootID == nil &&
		sibling.Revision == 1
	physicalCount, physicalBytes, inventoryErr := p046PhysicalInventory(ctx, store)
	afterAllocatedCount, afterAllocated, allocatedErr := p055RealCASAllocated(ctx, store)
	if inventoryErr != nil || allocatedErr != nil ||
		beforeCount != physicalCount || beforeBytes != physicalBytes ||
		beforeAllocatedCount != afterAllocatedCount || beforeAllocated != afterAllocated {
		t.Fatalf("100k real CAS allocation changed on restore: count=%d/%d bytes=%d/%d allocated=%d/%d errs=%v/%v",
			beforeCount, physicalCount, beforeBytes, physicalBytes,
			beforeAllocated, afterAllocated, inventoryErr, allocatedErr)
	}
	var incorrectRefs int64
	if err := db.Model(&meta.ContentBlob{}).Where(
		"(sha256 <> ? AND (ref_count <> 2 OR state <> ?)) OR (sha256 = ? AND (ref_count <> 1 OR state <> ?))",
		protectedHash, meta.ContentBlobStateReady,
		protectedHash, meta.ContentBlobStateReady,
	).Count(&incorrectRefs).Error; err != nil {
		t.Fatal(err)
	}
	var fullyVerified int
	for i := 0; i < sourceCount; i++ {
		expected := p046Bytes(i, "p055-"+sample)
		digest := sha256.Sum256(expected)
		key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", digest[:]))
		if err != nil {
			t.Fatal(err)
		}
		handle, err := store.Open(ctx, key)
		if err != nil {
			t.Fatalf("restored inode %d vanished: %v", i, err)
		}
		var actual [p047SourceBytes]byte
		n, err := io.ReadFull(handle, actual[:])
		if err != nil || n != p047SourceBytes || !bytes.Equal(actual[:], expected) {
			_ = handle.Close()
			t.Fatalf("restored original CAS %d SHA/bytes mismatch: n=%d err=%v", i, n, err)
		}
		var one [1]byte
		extra, readErr := handle.Read(one[:])
		closeErr := handle.Close()
		if extra != 0 || readErr != io.EOF || closeErr != nil {
			t.Fatalf("unexpected trailing bytes for %d: extra=%d read=%v close=%v", i, extra, readErr, closeErr)
		}
		fullyVerified++
	}
	f, err := store.Open(ctx, protectedKey)
	if err != nil {
		t.Fatal(err)
	}
	externalBytes, readErr := io.ReadAll(f)
	closeErr := f.Close()
	protectedIntact := readErr == nil && closeErr == nil &&
		bytes.Equal(externalBytes, protectedPayload)
	verifyMS := float64(time.Since(verifyStart).Microseconds()) / 1000
	passed := httpErr == nil && status == http.StatusOK && returned.ID == selected.ID &&
		returned.Revision == 3 && restored == int64(sourceCount) &&
		incorrectlyDeleted == 0 && rootRestored && siblingUnchanged &&
		fileRows == int64(sourceCount+1) && versionRows == int64(sourceCount) &&
		blobRows == int64(sourceCount+1) && shareRows == 2 && incorrectRefs == 0 &&
		fullyVerified == sourceCount && protectedIntact &&
		foreignCode == http.StatusNotFound && staleCode == http.StatusConflict &&
		physicalCount == int64(sourceCount+1) && physicalBytes == int64(sourceCount+1)*p047SourceBytes &&
		beforeAllocated == afterAllocated && writeDelta <= 1<<20 &&
		cpuAfter >= cpuBefore && rssGrowth <= 512<<20 && httpMS > 0 && httpMS <= 8000
	result := map[string]any{
		"workload": "P055-authenticated-HTTP-100k-distinct-physical-CAS-trash-restore",
		"sample":   sample, "smoke_only": smoke,
		"physical_source_count": sourceCount, "unique_cas_sha_count": sourceCount,
		"physical_original_bytes":         logicalOriginalBytes,
		"original_source_identity_sha256": hex.EncodeToString(sourceHash.Sum(nil)),
		"source_seed_ms_excluded":         seedMS,
		"restore_http_ms":                 httpMS,
		"restore_http_status":             status, "restore_http_response_bytes": len(response),
		"foreign_owner_http_status": foreignCode, "stale_revision_http_status": staleCode,
		"restored_node_count": restored, "still_deleted_nodes": incorrectlyDeleted,
		"live_file_rows": fileRows, "historical_version_rows": versionRows,
		"content_blob_rows": blobRows, "incorrect_blob_refcounts": incorrectRefs,
		"physical_cas_objects_before": beforeCount, "physical_cas_objects_after": physicalCount,
		"physical_cas_logical_bytes_before": beforeBytes, "physical_cas_logical_bytes_after": physicalBytes,
		"physical_cas_allocated_bytes_before":       beforeAllocated,
		"physical_cas_allocated_bytes_after":        afterAllocated,
		"go_process_kernel_write_bytes_during_http": writeDelta,
		"go_cpu_ticks_during_http":                  cpuAfter - cpuBefore,
		"go_rss_peak_growth_bytes":                  rssGrowth,
		"full_100k_cas_sha_verified":                fullyVerified,
		"protected_outside_sha_valid":               protectedIntact,
		"post_timer_physical_sha_audit_ms":          verifyMS,
		"http_budget_ms":                            8000, "rss_growth_budget_bytes": 512 << 20,
		"passed": passed,
		"scope":  "Native Linux genuine Gin authenticated HTTP restore of a trashed directory with 100k SHA-distinct actual physical 1KiB immutable CAS objects, File+FileVersion+ContentBlob+Share; excludes fixture seeding and full post-restoration verification from HTTP timer. No GUI, WAN, installed PWA, media decoders, durable task cancel or production code changes.",
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("P055_REAL_HTTP_PHYSICAL_100K_RESTORE %s", encoded)
	if !passed {
		t.Fatalf("P055 source-exact native physical restore budget failed: %s", encoded)
	}
}

// p055RealCASAllocated measures disk allocation, not a logical metadata size.
func p055RealCASAllocated(ctx context.Context, store *storage.Local) (int64, int64, error) {
	var count, allocated int64
	err := store.WalkManagedFiles(ctx, func(f storage.ManagedFile) error {
		if !strings.HasPrefix(f.Key, storage.ContentBlobDir+"/sha256/") {
			return nil
		}
		path := filepath.Join(store.FilesystemRoot(), filepath.FromSlash(f.Key))
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || !info.Mode().IsRegular() || stat.Nlink != 1 {
			return fmt.Errorf("physical nonregular/multilink CAS object %q", f.Key)
		}
		count++
		allocated += stat.Blocks * 512
		return nil
	})
	return count, allocated, err
}

func p055ProcWrites() uint64 {
	buf, err := os.ReadFile("/proc/self/io")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(buf), "\n") {
		if strings.HasPrefix(line, "write_bytes:") {
			n, _ := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, "write_bytes:")), 10, 64)
			return n
		}
	}
	return 0
}
