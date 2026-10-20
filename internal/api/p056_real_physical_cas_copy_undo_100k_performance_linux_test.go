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
	// P065 is an explicit test-only diagnostic of the ORIGINAL authenticated
	// 100k owner HTTP admission. It never changes the product SQL or accepted
	// P056 completion/Cancel behavior when the opt-in flag is absent.
	var p065Trace *p065AdmissionSQLTrace
	var p065PG *p065AdmissionPGActivity
	if os.Getenv("XD_P065_ORIGINAL_ENQUEUE") == "1" {
		p065Trace = &p065AdmissionSQLTrace{Interface: logger.Default.LogMode(logger.Silent)}
		server.DB = db.Session(&gorm.Session{Logger: p065Trace})
		p065PG = p065StartAdmissionPGActivity(db)
		defer p065PG.snapshotAndStop()
	}
	enqueueStart := time.Now()
	out := request(token, http.MethodPost, "/api/v1/file-operations", bytes.NewReader(raw), http.StatusAccepted)
	enqueueMS := float64(time.Since(enqueueStart).Microseconds()) / 1000
	if p065Trace != nil {
		server.DB = db
		waits := p065PG.snapshotAndStop()
		tables, statsErr := p065PostseedStats(ctx, db)
		var explain map[string]any
		if os.Getenv("XD_P065_POSTFLIGHT_EXPLAIN") == "1" {
			explain = p065PostflightExplain(ctx, db, source.ID, user.ID)
		}
		profile := map[string]any{
			"workload":    "P065-original-100k-physical-CAS-Owner-Copy-HTTP-enqueue",
			"source_kind": "ORIGINAL_PRODUCT_SQL_NO_WORKER_TUNING",
			"sample":      sample, "physical_sources": count, "smoke_only": smoke,
			"seed_ms_excluded":                            seedMS,
			"source_aggregate_sha256":                     sourceHash,
			"original_physical_cas_inodes":                preCount,
			"original_physical_allocated_bytes":           preAllocated,
			"original_http_enqueue_ms":                    enqueueMS,
			"frozen_120s_admission_budget_met":            enqueueMS <= 120000,
			"gorm_trace_by_sql_family":                    p065Trace.snapshot(),
			"postgres_wait_type_samples":                  waits,
			"pg_relation_statistics":                      tables,
			"pg_stats_query_failed":                       statsErr != nil,
			"postflight_original_recursive_query_explain": explain,
			"product_copy_worker_executed":                false,
			"scope":                                       "test-only isolated real Gin authenticated original 100k physical Owner POST; not Copy worker, not 100k native GUI; PostgreSQL wait sampling is not PID-exact",
		}
		jsonDiag, err := json.Marshal(profile)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("P065_ORIGINAL_ADMISSION_PROFILE %s", jsonDiag)
		return
	}
	var copyJob fileOperationDTO
	if err := json.Unmarshal(out, &copyJob); err != nil || copyJob.Status != meta.FileOperationStatusQueued {
		t.Fatalf("authentic queued Copy response: %+v %v", copyJob, err)
	}
	request(foreignToken, http.MethodGet, "/api/v1/file-operations/"+copyJob.ID, nil, http.StatusNotFound)

	// P062 is opt-in real Owner HTTP durable Copy cancellation only.
	if os.Getenv("XD_P062_REAL_CANCEL") == "1" {
		topology := os.Getenv("XD_P062_TOPOLOGY")
		if topology != "local" && topology != "remote" {
			t.Fatalf("invalid P062 topology: %s", topology)
		}
		request(foreignToken, http.MethodPost, "/api/v1/file-operations/"+copyJob.ID+"/cancel", nil, http.StatusNotFound)
		cancelURL := peer.URL
		if topology == "remote" {
			other := &Server{DB: db, Store: store, Auth: server.Auth,
				RefreshTTL: server.RefreshTTL, AllowedOrigin: server.AllowedOrigin}
			external := httptest.NewServer(other.Router())
			defer external.Close()
			cancelURL = external.URL
		}
		type receipt struct {
			start time.Time
			end   time.Time
			item  string
			err   error
		}
		issued := make(chan receipt, 1)
		watchCtx, stopWatch := context.WithCancel(ctx)
		defer stopWatch()
		go func() {
			tick := time.NewTicker(10 * time.Millisecond)
			defer tick.Stop()
			timeout := time.NewTimer(45 * time.Second)
			defer timeout.Stop()
			for {
				select {
				case <-watchCtx.Done():
					issued <- receipt{err: watchCtx.Err()}
					return
				case <-timeout.C:
					issued <- receipt{err: fmt.Errorf("no genuine in-flight index >=256 before timeout")}
					return
				case <-tick.C:
				}
				var observed meta.FileOperation
				if err := db.WithContext(watchCtx).Select("status", "current_item").
					Where("id = ?", copyJob.ID).First(&observed).Error; err != nil {
					issued <- receipt{err: err}
					return
				}
				if observed.Status != meta.FileOperationStatusRunning {
					continue
				}
				offset := strings.LastIndex(observed.CurrentItem, "p056-")
				if offset < 0 {
					continue
				}
				number, err := strconv.Atoi(strings.TrimSuffix(observed.CurrentItem[offset+5:], ".bin"))
				if err != nil || number < 256 {
					continue
				}
				start := time.Now()
				cancelCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				req, err := http.NewRequestWithContext(cancelCtx, http.MethodPost,
					cancelURL+"/api/v1/file-operations/"+copyJob.ID+"/cancel", nil)
				if err != nil {
					cancel()
					issued <- receipt{start: start, err: err}
					return
				}
				req.Header.Set("Authorization", "Bearer "+token)
				resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
				if err != nil {
					cancel()
					issued <- receipt{start: start, err: err}
					return
				}
				_, readErr := io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
				closeErr := resp.Body.Close()
				cancel()
				end := time.Now()
				if resp.StatusCode != http.StatusOK || readErr != nil || closeErr != nil {
					err = fmt.Errorf("cancel HTTP%d read=%v close=%v", resp.StatusCode, readErr, closeErr)
				}
				issued <- receipt{start: start, end: end, item: observed.CurrentItem, err: err}
				return
			}
		}()
		copyStarted := time.Now()
		processed, copyErr := server.processNextFileOperation(ctx)
		copyEnded := time.Now()
		var got receipt
		select {
		case got = <-issued:
		case <-time.After(15 * time.Second):
			t.Fatal("no owner HTTP cancel receipt")
		}
		stopWatch()
		if got.err != nil || got.start.IsZero() {
			t.Fatalf("real P062 HTTP cancel failed: %v", got.err)
		}
		if !processed || copyErr != nil {
			t.Fatalf("cancelled Worker failed: processed=%t err=%v", processed, copyErr)
		}
		var finished meta.FileOperation
		if err := db.Where("id = ?", copyJob.ID).First(&finished).Error; err != nil {
			t.Fatal(err)
		}
		if finished.Status != meta.FileOperationStatusCancelled ||
			finished.ProcessedItems != 0 || finished.ProcessedBytes != 0 || finished.CurrentItem != "" {
			t.Fatalf("cancelled Worker left invalid status/progress: %+v", finished)
		}
		var targetCount, oneRefs int64
		if err := db.Unscoped().Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ?", user.ID, target.ID).
			Count(&targetCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.ContentBlob{}).
			Where("ref_count = ? AND state = ?", 1, meta.ContentBlobStateReady).Count(&oneRefs).Error; err != nil {
			t.Fatal(err)
		}
		casCount, casAllocated, err := p055RealCASAllocated(ctx, store)
		if err != nil || targetCount != 0 || oneRefs != int64(count+1) ||
			casCount != preCount || casAllocated != preAllocated {
			t.Fatalf("cancel leaked data: targets=%d refs=%d physical=%d/%d allocated=%d/%d err=%v",
				targetCount, oneRefs, casCount, preCount, casAllocated, preAllocated, err)
		}
		for i := 0; i <= count; i++ {
			original := p046Bytes(i, "p056-"+sample)
			sha := sha256.Sum256(original)
			key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", sha[:]))
			if err != nil {
				t.Fatal(err)
			}
			f, err := store.Open(ctx, key)
			if err != nil {
				t.Fatalf("original CAS %d missing: %v", i, err)
			}
			data, readErr := io.ReadAll(io.LimitReader(f, p047SourceBytes+1))
			closeErr := f.Close()
			if readErr != nil || closeErr != nil || !bytes.Equal(data, original) {
				t.Fatalf("original CAS %d changed: read=%v close=%v", i, readErr, closeErr)
			}
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
		exitMS := float64(copyEnded.Sub(got.start).Microseconds()) / 1000
		httpMS := float64(got.end.Sub(got.start).Microseconds()) / 1000
		rssGrowth := max(int64(0), peakRSS.Load()-rssBefore)
		passed := exitMS >= 0 && exitMS <= 1000 && httpMS <= 1000 && rssGrowth <= 512<<20
		row := map[string]any{
			"workload": "P062-authenticated-100k-physical-CAS-owner-copy-cancel",
			"topology": topology, "sample": sample, "smoke_only": smoke,
			"physical_sources": count, "source_aggregate_sha256": sourceHash,
			"observed_current_item":          got.item,
			"cancel_start_to_worker_exit_ms": exitMS, "cancel_http_ms": httpMS,
			"worker_until_cancel_ms": float64(copyEnded.Sub(copyStarted).Microseconds()) / 1000,
			"remaining_target_nodes": targetCount, "original_one_ref_count": oneRefs,
			"physical_CAS_object_count":       casCount,
			"physical_allocated_bytes_before": preAllocated, "physical_allocated_bytes_after": casAllocated,
			"go_rss_growth_bytes": rssGrowth, "passed": passed,
		}
		output, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("P062_REAL_100K_CANCEL %s", output)
		if !passed {
			t.Fatalf("P062 real user Cancel latency/resource budget failed: %s", output)
		}
		return
	}

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

	// P066 original-only second admission AFTER genuine physical 100k Copy,
	// Undo, authenticated Trash purge and exhaustive original SHA readback.
	if os.Getenv("XD_P066_POST_LIFECYCLE_REENQUEUE") == "1" {
		rssBeforePost, err := p046RSS()
		if err != nil {
			t.Fatal(err)
		}
		cpuBeforePost, err := p046CPUTicks()
		if err != nil {
			t.Fatal(err)
		}
		trace := &p065AdmissionSQLTrace{Interface: logger.Default.LogMode(logger.Silent)}
		server.DB = db.Session(&gorm.Session{Logger: trace})
		activity := p065StartAdmissionPGActivity(db)
		defer activity.snapshotAndStop()
		secondStart := time.Now()
		secondRaw := request(token, http.MethodPost, "/api/v1/file-operations", bytes.NewReader(raw), http.StatusAccepted)
		secondMS := float64(time.Since(secondStart).Microseconds()) / 1000
		server.DB = db
		waits := activity.snapshotAndStop()
		rssAfterPost, err := p046RSS()
		if err != nil {
			t.Fatal(err)
		}
		cpuAfterPost, err := p046CPUTicks()
		if err != nil {
			t.Fatal(err)
		}
		var secondJob fileOperationDTO
		if err := json.Unmarshal(secondRaw, &secondJob); err != nil ||
			secondJob.Status != meta.FileOperationStatusQueued {
			t.Fatalf("P066 original repeat Copy not queued: %+v %v", secondJob, err)
		}
		request(foreignToken, http.MethodGet, "/api/v1/file-operations/"+secondJob.ID, nil, http.StatusNotFound)
		cancelRaw := request(token, http.MethodPost, "/api/v1/file-operations/"+secondJob.ID+"/cancel", nil, http.StatusOK)
		var canceled fileOperationDTO
		if err := json.Unmarshal(cancelRaw, &canceled); err != nil ||
			canceled.Status != meta.FileOperationStatusCancelled {
			t.Fatalf("P066 queued repeat Copy cancellation failed: %+v %v", canceled, err)
		}
		var op meta.FileOperation
		if err := db.Where("id = ? AND owner_id = ?", secondJob.ID, user.ID).
			First(&op).Error; err != nil || op.Status != meta.FileOperationStatusCancelled {
			t.Fatalf("P066 queued repeat Copy not durably canceled: %+v %v", op, err)
		}
		var remaining int64
		if err := db.Model(&meta.Node{}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", user.ID, target.ID).
			Count(&remaining).Error; err != nil || remaining != 0 {
			t.Fatalf("P066 queued request mutated target: %d %v", remaining, err)
		}
		casCount, casAllocated, err := p055RealCASAllocated(ctx, store)
		if err != nil || casCount != preCount || casAllocated != preAllocated {
			t.Fatalf("P066 physical originals changed: count=%d/%d allocated=%d/%d err=%v",
				casCount, preCount, casAllocated, preAllocated, err)
		}
		statistics, statsErr := p065PostseedStats(ctx, db)
		var explain map[string]any
		if os.Getenv("XD_P066_POSTFLIGHT_EXPLAIN") == "1" {
			explain = p065PostflightExplain(ctx, db, source.ID, user.ID)
		}
		ok := passed && enqueueMS <= 120000 && secondMS <= 120000
		proof := map[string]any{}
		proof["workload"] = "P066-original-100k-physical-Copy-Undo-Trash-second-Owner-POST"
		proof["sample"] = sample
		proof["smoke_only"] = smoke
		proof["physical_sources"] = count
		proof["source_aggregate_sha256"] = sourceHash
		proof["original_physical_cas_inodes"] = preCount
		proof["original_physical_allocated_bytes"] = preAllocated
		proof["first_original_http_enqueue_ms"] = enqueueMS
		proof["original_copy_worker_ms"] = copyMS
		proof["original_undo_worker_ms"] = undoMS
		proof["original_trash_purge_ms"] = purgeMS
		proof["second_original_http_enqueue_ms"] = secondMS
		proof["second_post_gorm_trace_by_sql_family"] = trace.snapshot()
		proof["second_post_pg_wait_type_samples"] = waits
		proof["postflight_pg_relation_statistics"] = statistics
		proof["postflight_pg_stats_query_failed"] = statsErr != nil
		proof["postflight_original_recursive_query_explain"] = explain
		proof["second_post_go_rss_growth_bytes"] = max(int64(0), rssAfterPost-rssBeforePost)
		proof["second_post_go_cpu_ticks"] = cpuAfterPost - cpuBeforePost
		proof["second_queued_operation_cancelled"] = true
		proof["second_post_physical_cas_inodes"] = casCount
		proof["second_post_physical_allocated_bytes"] = casAllocated
		proof["first_full_lifecycle_passed"] = passed
		proof["frozen_120s_both_admissions_passed"] = enqueueMS <= 120000 && secondMS <= 120000
		proof["passed"] = ok
		proof["scope"] = "test-only second real authenticated POST after fully verified physical Copy+Undo+Trash; canceled pending repeat, no production change"
		encoded, err := json.Marshal(proof)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("P066_ORIGINAL_POST_LIFECYCLE_REENQUEUE %s", encoded)
		if !ok {
			t.Fatalf("P066 frozen original admission RED: %s", encoded)
		}
	}

	if !passed {
		t.Fatalf("P056 original immutable Copy+Undo frozen performance budget failed: %s", jsonRow)
	}
}
