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
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// P056 is 100k genuinely different and physically allocated CAS originals,
// not 100k Node-only metadata or CAS-A01's many references to one Blob.
func TestP056Real100KPhysicalCASCopyUndo(t *testing.T) {
	if os.Getenv("XD_P056_REAL_COPY_PERF") != "1" {
		t.Skip("enable actual 100k physical CAS copy and undo performance")
	}
	sample := os.Getenv("XD_P056_SAMPLE")
	if os.Getenv("XD_TEST_DATABASE_URL") == "" ||
		(sample != "sample-1" && sample != "sample-2" && sample != "sample-3") {
		t.Fatal("real PostgreSQL17 and sample-1..3 required")
	}
	count := p047SourceCount
	smoke := os.Getenv("XD_P056_SMOKE") == "1"
	if smoke {
		count = 1000
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, os.Getenv("XD_TEST_DATABASE_URL"))
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.Share{}, &meta.ContentBlob{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileOperation{},
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("p056-native-physical-copy-undo", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	userName := "p056-physical-owner-" + sample
	token := createTestUser(t, db, router, userName, "password-for-test")
	foreignToken := createTestUser(t, db, router, "p056-other-"+sample, "other-password")
	var user meta.User
	if err := db.Where("username = ?", userName).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Node{
		ParentID: &root.ID, Name: "source-100k-physical", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	target := meta.Node{
		ParentID: &root.ID, Name: "target-100k-copy", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	sentinel := meta.Node{
		ParentID: &root.ID, Name: "outside-physical.bin", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	for _, node := range []*meta.Node{&source, &target, &sentinel} {
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at) "+
			"SELECT ?, 'p056-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, NOW(), NOW() "+
			"FROM generate_series(0, ?) AS gs",
		source.ID, user.ID, count-1,
	).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := db.Raw(
		"SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY name",
		source.ID, user.ID,
	).Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, count)
	for rows.Next() {
		var id uint64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rowsErr := rows.Err()
	_ = rows.Close()
	if rowsErr != nil || len(ids) != count {
		t.Fatalf("not all physical source Nodes seeded: %d %v", len(ids), rowsErr)
	}
	aggregate := sha256.New()
	uniques := make(map[string]bool, count)
	blobs := make([]meta.ContentBlob, 0, 250)
	files := make([]meta.File, 0, 250)
	flush := func() {
		if err := db.CreateInBatches(&blobs, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&files, 250).Error; err != nil {
			t.Fatal(err)
		}
		blobs = blobs[:0]
		files = files[:0]
	}
	for i, id := range ids {
		payload := p046Bytes(i, "p056-"+sample)
		digest := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", digest[:])
		if uniques[hash] {
			t.Fatal("100k source originals must have unique complete SHA")
		}
		uniques[hash] = true
		_, _ = aggregate.Write(digest[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		wrote, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || wrote != p047SourceBytes {
			t.Fatalf("physical Local.Put original=%d n=%d err=%v", i, wrote, err)
		}
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: p047SourceBytes,
			RefCount: 1, State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: id, Size: p047SourceBytes, SHA256: hash, StorageKey: key,
		})
		if len(blobs) == 250 {
			flush()
		}
	}
	if len(blobs) > 0 {
		flush()
	}
	outside := p046Bytes(count, "p056-"+sample)
	outsideDigest := sha256.Sum256(outside)
	outsideHash := fmt.Sprintf("%x", outsideDigest[:])
	if uniques[outsideHash] {
		t.Fatal("protected physical sentinel hash duplicate")
	}
	outsideKey, err := storage.ContentAddressedKey(outsideHash)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := store.Put(ctx, outsideKey, bytes.NewReader(outside)); err != nil || n != p047SourceBytes {
		t.Fatalf("physical protected CAS sentinel: n=%d err=%v", n, err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: outsideHash, Size: p047SourceBytes, StorageKey: outsideKey,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: sentinel.ID, Size: p047SourceBytes, SHA256: outsideHash,
		StorageKey: outsideKey,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sourceHash := fmt.Sprintf("%x", aggregate.Sum(nil))
	preCount, preAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || preCount != int64(count+1) || preAllocated < int64(count+1)*4096 {
		t.Fatalf("real original physical CAS inventory=%d allocated=%d err=%v", preCount, preAllocated, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	ids = nil
	uniques = nil
	blobs = nil
	files = nil
	runtime.GC()
	rssBefore, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	previousGoWrite := p055ProcWrites()
	var peakRSS atomic.Int64
	peakRSS.Store(rssBefore)
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
				current, err := p046RSS()
				if err != nil {
					continue
				}
				for {
					old := peakRSS.Load()
					if current <= old || peakRSS.CompareAndSwap(old, current) {
						break
					}
				}
			}
		}
	}()
	defer func() {
		select {
		case <-done:
		default:
			close(stop)
			<-done
		}
	}()
	peer := httptest.NewServer(router)
	defer peer.Close()
	httpClient := &http.Client{Timeout: 20 * time.Minute}
	request := func(token, method, url string, body io.Reader, want int, revision ...uint64) []byte {
		t.Helper()
		req, err := http.NewRequest(method, peer.URL+url, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if len(revision) == 1 {
			req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision[0]))
		}
		if len(revision) > 1 {
			t.Fatal("at most one If-Match revision is allowed")
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		content, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if readErr != nil || resp.StatusCode != want {
			t.Fatalf("%s %s HTTP%d wanted %d: %s err=%v", method, url, resp.StatusCode, want, content, readErr)
		}
		return content
	}
	raw, err := json.Marshal(createFileOperationRequest{
		Type:     meta.FileOperationTypeCopy,
		Items:    []batchNodeRef{{ID: source.ID, Revision: source.Revision}},
		ParentID: target.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	enqueueStart := time.Now()
	out := request(token, http.MethodPost, "/api/v1/file-operations", bytes.NewReader(raw), http.StatusAccepted)
	enqueueMS := float64(time.Since(enqueueStart).Microseconds()) / 1000
	var copyJob fileOperationDTO
	if err := json.Unmarshal(out, &copyJob); err != nil || copyJob.Status != meta.FileOperationStatusQueued {
		t.Fatalf("authentic queued Copy response: %+v %v", copyJob, err)
	}
	request(foreignToken, http.MethodGet, "/api/v1/file-operations/"+copyJob.ID, nil, http.StatusNotFound)
	// P059 only: observe the original 100k COPY Worker without changing production.
	// Unprofiled P056 remains byte-for-byte identical in behavior.
	var copySQLProfile *p059CopySQLProfile
	if os.Getenv("XD_P059_COPY_SQL_PROFILE") == "1" {
		copySQLProfile = &p059CopySQLProfile{Interface: logger.Default.LogMode(logger.Silent)}
		server.DB = db.Session(&gorm.Session{Logger: copySQLProfile})
	}
	copyStart := time.Now()
	processed, copyErr := server.processNextFileOperation(ctx)
	copyMS := float64(time.Since(copyStart).Microseconds()) / 1000
	server.DB = db // Undo, purge and source validation are deliberately unprofiled.
	if copyErr != nil || !processed {
		t.Fatalf("original product physical 100k Copy RED, worker processed=%v err=%v elapsed_ms=%.3f", processed, copyErr, copyMS)
	}
	var finished meta.FileOperation
	if err := db.Where("id = ?", copyJob.ID).First(&finished).Error; err != nil ||
		finished.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("physical Copy did not complete: %+v %v", finished, err)
	}
	var copied meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ? AND name = ?",
		user.ID, target.ID, source.Name).First(&copied).Error; err != nil {
		t.Fatal(err)
	}
	var matching int64
	if err := db.Raw(
		"SELECT COUNT(*) FROM xd_nodes AS n "+
			"JOIN xd_files AS f ON f.node_id = n.id "+
			"JOIN xd_nodes AS orig ON orig.owner_id = ? AND orig.parent_id = ? AND orig.name = n.name "+
			"JOIN xd_files AS sf ON sf.node_id = orig.id "+
			"WHERE n.owner_id = ? AND n.parent_id = ? AND "+
			"f.storage_key = sf.storage_key AND f.sha256 = sf.sha256 AND f.size = sf.size",
		user.ID, source.ID, user.ID, copied.ID,
	).Scan(&matching).Error; err != nil || matching != int64(count) {
		t.Fatalf("copied File metadata does not reuse all original SHA keys: matches=%d err=%v", matching, err)
	}
	var twoRefs int64
	if err := db.Model(&meta.ContentBlob{}).Where("ref_count = ? AND state = ?", 2, meta.ContentBlobStateReady).
		Count(&twoRefs).Error; err != nil || twoRefs != int64(count) {
		t.Fatalf("copied 100k physical objects lack two confirmed references: refs=%d err=%v", twoRefs, err)
	}
	copyCount, copyAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || copyCount != preCount || copyAllocated != preAllocated {
		t.Fatalf("copy wrote duplicate physical CAS: count=%d/%d bytes=%d/%d err=%v", copyCount, preCount, copyAllocated, preAllocated, err)
	}
	undoEnqueueStart := time.Now()
	undoRaw := request(token, http.MethodPost, "/api/v1/file-operations/"+copyJob.ID+"/undo", nil, http.StatusAccepted)
	undoEnqueueMS := float64(time.Since(undoEnqueueStart).Microseconds()) / 1000
	var undoJob fileOperationDTO
	if err := json.Unmarshal(undoRaw, &undoJob); err != nil || undoJob.Status != meta.FileOperationStatusQueued {
		t.Fatalf("authentic Copy undo cannot enqueue: %+v %v", undoJob, err)
	}
	undoStart := time.Now()
	processed, undoErr := server.processNextFileOperation(ctx)
	undoMS := float64(time.Since(undoStart).Microseconds()) / 1000
	if undoErr != nil || !processed {
		t.Fatalf("original 100k Copy-Undo failed: processed=%v err=%v elapsed_ms=%.3f", processed, undoErr, undoMS)
	}
	var undoFinished meta.FileOperation
	if err := db.Where("id = ?", undoJob.ID).First(&undoFinished).Error; err != nil ||
		undoFinished.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("Undo failed: status=%s code=%s reason=%s worker_ms=%.3f query_error=%v", undoFinished.Status, undoFinished.FailureCode, undoFinished.Error, undoMS, err)
	}
	var remainingCopied int64
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", user.ID, target.ID).
		Count(&remainingCopied).Error; err != nil || remainingCopied != 0 {
		t.Fatalf("undo failed to remove copied logical folder: %d %v", remainingCopied, err)
	}
	// Undo moves copied Files to Trash, intentionally pinning their Blobs for Redo.
	var retainedTrashRefs int64
	if err := db.Model(&meta.ContentBlob{}).Where("ref_count = ? AND state = ?", 2, meta.ContentBlobStateReady).
		Count(&retainedTrashRefs).Error; err != nil || retainedTrashRefs != int64(count) {
		t.Fatalf("Undo lost copied Trash Blob references: %d %v", retainedTrashRefs, err)
	}
	var sentinelRefs int64
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ? AND ref_count = ? AND state = ?", outsideHash, 1, meta.ContentBlobStateReady).
		Count(&sentinelRefs).Error; err != nil || sentinelRefs != 1 {
		t.Fatalf("Undo changed protected sentinel: %d %v", sentinelRefs, err)
	}
	var trashedCopiedFiles int64
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND trash_root_id = ? AND deleted_at IS NOT NULL AND type = ?",
		user.ID, copied.ID, meta.NodeTypeFile).Count(&trashedCopiedFiles).Error; err != nil || trashedCopiedFiles != int64(count) {
		t.Fatalf("Undo lost copied Trash files: %d %v", trashedCopiedFiles, err)
	}
	var trashRoot meta.Node
	if err := db.Where("id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = ?",
		copied.ID, user.ID, copied.ID).First(&trashRoot).Error; err != nil {
		t.Fatalf("Undo did not keep revisioned Trash root: %v", err)
	}
	undoCount, undoAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || undoCount != preCount || undoAllocated != preAllocated {
		t.Fatalf("undo removed or recopied genuine original CAS: count=%d/%d allocated=%d/%d err=%v", undoCount, preCount, undoAllocated, preAllocated, err)
	}
	// Only an authorized permanent Trash delete may release the extra references.
	trashURI := fmt.Sprintf("/api/v1/trash/%d", copied.ID)
	request(foreignToken, http.MethodDelete, trashURI, nil, http.StatusNotFound, trashRoot.Revision)
	purgeStart := time.Now()
	request(token, http.MethodDelete, trashURI, nil, http.StatusNoContent, trashRoot.Revision)
	purgeMS := float64(time.Since(purgeStart).Microseconds()) / 1000
	var releasedOriginalRefs int64
	if err := db.Model(&meta.ContentBlob{}).Where("ref_count = ? AND state = ?", 1, meta.ContentBlobStateReady).
		Count(&releasedOriginalRefs).Error; err != nil || releasedOriginalRefs != int64(count+1) {
		t.Fatalf("purge failed to release copied Blob refs: %d %v", releasedOriginalRefs, err)
	}
	var trashSurvivors int64
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND trash_root_id = ?", user.ID, copied.ID).
		Count(&trashSurvivors).Error; err != nil || trashSurvivors != 0 {
		t.Fatalf("purge retained copied Trash nodes: %d %v", trashSurvivors, err)
	}
	purgeCount, purgeAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || purgeCount != preCount || purgeAllocated != preAllocated {
		t.Fatalf("purge damaged original physical CAS: count=%d/%d allocated=%d/%d err=%v",
			purgeCount, preCount, purgeAllocated, preAllocated, err)
	}
	close(stop)
	<-done
	rssAfter, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	if rssAfter > peakRSS.Load() {
		peakRSS.Store(rssAfter)
	}
	cpuAfter, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	writeAfter := p055ProcWrites()
	checkStart := time.Now()
	for i := 0; i <= count; i++ {
		payload := p046Bytes(i, "p056-"+sample)
		digest := sha256.Sum256(payload)
		key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", digest[:]))
		if err != nil {
			t.Fatal(err)
		}
		f, err := store.Open(ctx, key)
		if err != nil {
			t.Fatalf("protected physical CAS %d missing after Undo: %v", i, err)
		}
		actual, readErr := io.ReadAll(io.LimitReader(f, p047SourceBytes+1))
		closeErr := f.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, payload) {
			t.Fatalf("physical CAS %d corrupted following Copy+Undo: readErr=%v closeErr=%v", i, readErr, closeErr)
		}
	}
	verifyMS := float64(time.Since(checkStart).Microseconds()) / 1000
	rssGrowth := max(int64(0), peakRSS.Load()-rssBefore)
	var writes uint64
	if writeAfter >= previousGoWrite {
		writes = writeAfter - previousGoWrite
	}
	passed := enqueueMS <= 120000 && copyMS <= 900000 && undoMS <= 900000 &&
		rssGrowth <= 512<<20 && writes <= 512<<20 && cpuAfter >= cpuBefore
	passed = passed && purgeMS <= 900000
	result := map[string]any{
		"workload": "P056-authenticated-100k-unique-physical-CAS-folder-copy-undo",
		"sample":   sample, "smoke_only": smoke, "physical_sources": count,
		"physical_content_bytes":                          int64(count+1) * p047SourceBytes,
		"source_aggregate_sha256":                         sourceHash,
		"seed_local_cas_and_metadata_ms":                  seedMS,
		"copy_http_enqueue_ms":                            enqueueMS,
		"copy_actual_durable_worker_ms":                   copyMS,
		"undo_http_enqueue_ms":                            undoEnqueueMS,
		"undo_actual_durable_worker_ms":                   undoMS,
		"complete_physical_original_sha_verify_ms":        verifyMS,
		"verified_copied_file_metadata_count":             matching,
		"source_copy_content_blob_ref_count_2":            twoRefs,
		"original_physical_CAS_inodes":                    preCount,
		"physical_allocated_bytes_before":                 preAllocated,
		"physical_allocated_bytes_after_copy":             copyAllocated,
		"physical_allocated_bytes_after_undo":             undoAllocated,
		"go_process_kernel_write_bytes_for_copy_and_undo": writes,
		"go_process_cpu_ticks_for_copy_and_undo":          cpuAfter - cpuBefore,
		"go_process_25ms_peak_rss_growth_bytes":           rssGrowth,
		"passed":                                          passed,
		"scope":                                           "Authentic HTTP enqueue and Go PostgreSQL17 durable worker, physical SHA-distinct Local CAS; not OS-installed client/browser GUI, WAN or true durable upload/sync.",
	}
	result["trash_retained_content_blob_ref_count_2_after_undo"] = retainedTrashRefs
	result["sentinel_content_blob_ref_count_1_after_undo"] = sentinelRefs
	result["trashed_copied_file_count_after_undo"] = trashedCopiedFiles
	result["authenticated_purge_100k_copy_trash_ms"] = purgeMS
	result["original_content_blob_ref_count_after_purge"] = releasedOriginalRefs
	result["physical_allocated_bytes_after_purge"] = purgeAllocated
	result["go_process_kernel_write_bytes_for_all_stages"] = writes
	delete(result, "go_process_kernel_write_bytes_for_copy_and_undo")
	if copySQLProfile != nil {
		result["copy_sql_profile"] = copySQLProfile.snapshot()
	}
	jsonRow, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	t.Logf("P056_REAL_PHYSICAL_COPY_UNDO %s", jsonRow)
	if !passed {
		t.Fatalf("P056 original immutable Copy+Undo frozen performance budget failed: %s", jsonRow)
	}
}
