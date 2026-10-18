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

// P057 is 100k genuinely different and physically allocated CAS originals,
// not 100k Node-only metadata or CAS-A01's many references to one Blob.
func TestP057Real100KPhysicalCASDeleteUndo(t *testing.T) {
	if os.Getenv("XD_P057_REAL_DELETE_UNDO_PERF") != "1" {
		t.Skip("enable actual 100k physical CAS copy and undo performance")
	}
	sample := os.Getenv("XD_P057_SAMPLE")
	if os.Getenv("XD_TEST_DATABASE_URL") == "" ||
		(sample != "sample-1" && sample != "sample-2" && sample != "sample-3") {
		t.Fatal("real PostgreSQL17 and sample-1..3 required")
	}
	count := p047SourceCount
	smoke := os.Getenv("XD_P057_SMOKE") == "1"
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
		DB: db, Store: store, Auth: auth.New("p057-native-physical-copy-undo", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	userName := "p057-physical-owner-" + sample
	token := createTestUser(t, db, router, userName, "password-for-test")
	foreignToken := createTestUser(t, db, router, "p057-other-"+sample, "other-password")
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
			"SELECT ?, 'p057-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, NOW(), NOW() "+
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
		payload := p046Bytes(i, "p057-"+sample)
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
	outside := p046Bytes(count, "p057-"+sample)
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
		Type:  meta.FileOperationTypeDelete,
		Items: []batchNodeRef{{ID: source.ID, Revision: source.Revision}},
	})
	if err != nil {
		t.Fatal(err)
	}
	enqueueStarted := time.Now()
	out := request(token, http.MethodPost, "/api/v1/file-operations", bytes.NewReader(raw), http.StatusAccepted)
	enqueueMS := float64(time.Since(enqueueStarted).Microseconds()) / 1000
	var deleteJob fileOperationDTO
	if err := json.Unmarshal(out, &deleteJob); err != nil || deleteJob.Status != meta.FileOperationStatusQueued ||
		deleteJob.Type != meta.FileOperationTypeDelete {
		t.Fatalf("P057 authentic queued DELETE failed: job=%+v err=%v", deleteJob, err)
	}
	request(foreignToken, http.MethodGet, "/api/v1/file-operations/"+deleteJob.ID, nil, http.StatusNotFound)
	deleteStarted := time.Now()
	processed, deleteErr := server.processNextFileOperation(ctx)
	deleteMS := float64(time.Since(deleteStarted).Microseconds()) / 1000
	if deleteErr != nil || !processed {
		t.Fatalf("P057 genuine 100k physical DELETE worker failed: processed=%v err=%v duration_ms=%.3f", processed, deleteErr, deleteMS)
	}
	var deleteFinished meta.FileOperation
	if err := db.Where("id = ?", deleteJob.ID).First(&deleteFinished).Error; err != nil ||
		deleteFinished.Status != meta.FileOperationStatusCompleted || deleteFinished.UndoPlanJSON == "" {
		t.Fatalf("DELETE must be durable and undoable: job=%+v err=%v", deleteFinished, err)
	}
	var trashRoot meta.Node
	if err := db.First(&trashRoot, source.ID).Error; err != nil ||
		trashRoot.DeletedAt == nil || trashRoot.TrashRootID == nil ||
		*trashRoot.TrashRootID != source.ID || trashRoot.Revision != source.Revision+1 {
		t.Fatalf("DELETE did not preserve revisioned Trash root: root=%+v err=%v", trashRoot, err)
	}
	var trashChildren int64
	if err := db.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND trash_root_id = ? AND deleted_at IS NOT NULL",
		user.ID, source.ID, source.ID,
	).Count(&trashChildren).Error; err != nil || trashChildren != int64(count) {
		t.Fatalf("DELETE did not soft-delete all 100k originals: %d %v", trashChildren, err)
	}
	var protectedAfterDelete meta.Node
	if err := db.First(&protectedAfterDelete, sentinel.ID).Error; err != nil ||
		protectedAfterDelete.DeletedAt != nil || protectedAfterDelete.Revision != sentinel.Revision {
		t.Fatalf("DELETE modified protected outside Node: %+v %v", protectedAfterDelete, err)
	}
	var referencedAfterDelete int64
	if err := db.Model(&meta.ContentBlob{}).
		Where("ref_count = ? AND state = ?", 1, meta.ContentBlobStateReady).
		Count(&referencedAfterDelete).Error; err != nil || referencedAfterDelete != int64(count+1) {
		t.Fatalf("DELETE must preserve Trash-held original Blob references: %d %v", referencedAfterDelete, err)
	}
	countAfterDelete, allocatedAfterDelete, err := p055RealCASAllocated(ctx, store)
	if err != nil || countAfterDelete != preCount || allocatedAfterDelete != preAllocated {
		t.Fatalf("DELETE prematurely freed original CAS: count=%d/%d bytes=%d/%d error=%v",
			countAfterDelete, preCount, allocatedAfterDelete, preAllocated, err)
	}
	var retainedFileRows int64
	if err := db.Model(&meta.File{}).Count(&retainedFileRows).Error; err != nil || retainedFileRows != int64(count+1) {
		t.Fatalf("soft DELETE unexpectedly removed original File rows: %d %v", retainedFileRows, err)
	}
	undoEnqueueStarted := time.Now()
	undoOut := request(token, http.MethodPost, "/api/v1/file-operations/"+deleteJob.ID+"/undo", nil, http.StatusAccepted)
	undoEnqueueMS := float64(time.Since(undoEnqueueStarted).Microseconds()) / 1000
	var undoJob fileOperationDTO
	if err := json.Unmarshal(undoOut, &undoJob); err != nil ||
		undoJob.Status != meta.FileOperationStatusQueued ||
		undoJob.Type != meta.FileOperationTypeUndo || undoJob.UndoOfID == nil ||
		*undoJob.UndoOfID != deleteJob.ID {
		t.Fatalf("P057 cannot enqueue original authenticated DELETE Undo: %+v %v", undoJob, err)
	}
	request(foreignToken, http.MethodGet, "/api/v1/file-operations/"+undoJob.ID, nil, http.StatusNotFound)
	undoStarted := time.Now()
	processed, undoErr := server.processNextFileOperation(ctx)
	undoMS := float64(time.Since(undoStarted).Microseconds()) / 1000
	if undoErr != nil || !processed {
		t.Fatalf("P057 durable Undo worker failed: processed=%v err=%v duration_ms=%.3f", processed, undoErr, undoMS)
	}
	var undoFinished meta.FileOperation
	if err := db.Where("id = ?", undoJob.ID).First(&undoFinished).Error; err != nil ||
		undoFinished.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("Undo must be durable completed: %+v %v", undoFinished, err)
	}
	var restoredRoot meta.Node
	if err := db.First(&restoredRoot, source.ID).Error; err != nil ||
		restoredRoot.DeletedAt != nil || restoredRoot.TrashRootID != nil ||
		restoredRoot.Revision != source.Revision+2 {
		t.Fatalf("Undo did not restore original root revision: %+v %v", restoredRoot, err)
	}
	var restoredChildren int64
	if err := db.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND trash_root_id IS NULL AND revision = ?",
		user.ID, source.ID, uint64(1),
	).Count(&restoredChildren).Error; err != nil || restoredChildren != int64(count) {
		t.Fatalf("Undo did not restore all 100k original children: %d %v", restoredChildren, err)
	}
	var retainedRefsAfterUndo int64
	if err := db.Model(&meta.ContentBlob{}).
		Where("ref_count = ? AND state = ?", 1, meta.ContentBlobStateReady).
		Count(&retainedRefsAfterUndo).Error; err != nil || retainedRefsAfterUndo != int64(count+1) {
		t.Fatalf("Undo damaged one-ref physical originals: %d %v", retainedRefsAfterUndo, err)
	}
	countAfterUndo, allocatedAfterUndo, err := p055RealCASAllocated(ctx, store)
	if err != nil || countAfterUndo != preCount || allocatedAfterUndo != preAllocated {
		t.Fatalf("Undo changed real source physical CAS: count=%d/%d allocated=%d/%d err=%v",
			countAfterUndo, preCount, allocatedAfterUndo, preAllocated, err)
	}
	var protectedAfterUndo meta.Node
	if err := db.First(&protectedAfterUndo, sentinel.ID).Error; err != nil ||
		protectedAfterUndo.DeletedAt != nil || protectedAfterUndo.Revision != sentinel.Revision {
		t.Fatalf("Undo changed unselected protected sibling: %+v %v", protectedAfterUndo, err)
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
	verifyStarted := time.Now()
	for i := 0; i <= count; i++ {
		payload := p046Bytes(i, "p057-"+sample)
		digest := sha256.Sum256(payload)
		key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", digest[:]))
		if err != nil {
			t.Fatal(err)
		}
		original, err := store.Open(ctx, key)
		if err != nil {
			t.Fatalf("source CAS %d missing after DELETE/Undo: %v", i, err)
		}
		actual, readErr := io.ReadAll(io.LimitReader(original, p047SourceBytes+1))
		closeErr := original.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, payload) {
			t.Fatalf("CAS source %d corrupted after Undo: read=%v close=%v", i, readErr, closeErr)
		}
	}
	verifyMS := float64(time.Since(verifyStarted).Microseconds()) / 1000
	rssGrowth := max(int64(0), peakRSS.Load()-rssBefore)
	var writtenBytes uint64
	if writeAfter >= previousGoWrite {
		writtenBytes = writeAfter - previousGoWrite
	}
	passed := enqueueMS <= 30000 && deleteMS <= 900000 &&
		undoEnqueueMS <= 30000 && undoMS <= 900000 &&
		rssGrowth <= 512<<20 && writtenBytes <= 512<<20 && cpuAfter >= cpuBefore
	result := map[string]any{
		"workload":                                    "P057-authenticated-queued-100k-distinct-original-CAS-DELETE-Undo",
		"sample":                                      sample,
		"smoke_only":                                  smoke,
		"physical_sources":                            count,
		"source_aggregate_sha256":                     sourceHash,
		"physical_content_bytes":                      int64(count+1) * p047SourceBytes,
		"seed_cas_and_sql_excluded_ms":                seedMS,
		"delete_http_enqueue_ms":                      enqueueMS,
		"delete_actual_durable_worker_ms":             deleteMS,
		"undo_http_enqueue_ms":                        undoEnqueueMS,
		"undo_actual_durable_worker_ms":               undoMS,
		"complete_original_physical_sha_verify_ms":    verifyMS,
		"deleted_trash_children":                      trashChildren,
		"restored_children":                           restoredChildren,
		"original_ready_refcount_1_after_delete":      referencedAfterDelete,
		"original_ready_refcount_1_after_undo":        retainedRefsAfterUndo,
		"original_physical_cas_inodes":                preCount,
		"physical_allocated_bytes_before":             preAllocated,
		"physical_allocated_bytes_after_delete":       allocatedAfterDelete,
		"physical_allocated_bytes_after_undo":         allocatedAfterUndo,
		"go_process_kernel_write_bytes":               writtenBytes,
		"go_process_cpu_ticks_for_both_worker_stages": cpuAfter - cpuBefore,
		"go_25ms_peak_rss_growth_bytes":               rssGrowth,
		"passed":                                      passed,
		"scope":                                       "Genuine owner-authenticated HTTP enqueue and PostgreSQL17 durable DELETE+Undo workers with independent SHA-distinct LocalCAS originals; not actual Web/Desktop GUI, installed PWA, permanent deletion, or task cancellation",
	}
	row, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("P057_REAL_100K_PHYSICAL_DELETE_UNDO %s", row)
	if !passed {
		t.Fatalf("P057 original product DELETE+Undo exceeded frozen budget: %s", row)
	}
}
