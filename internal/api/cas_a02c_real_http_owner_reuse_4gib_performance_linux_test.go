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

// CAS-A02c uses the actual authenticated HTTP upload handler and PostgreSQL
// metadata. Only the synthetic high-entropy source is test-owned; bytes sent to
// Go and persisted on disk are real. 64MiB smoke is never a 4GiB result.
func TestCASA02CRealHTTP4GiBSameAndCrossOwnerReuse(t *testing.T) {
	if os.Getenv("XD_CAS_A02C_REAL_HTTP") != "1" {
		t.Skip("opt-in 4GiB CAS-A02c owner reuse benchmark")
	}
	sampleName := os.Getenv("XD_CAS_A02C_SAMPLE")
	sample, err := strconv.Atoi(strings.TrimPrefix(sampleName, "sample-"))
	if os.Getenv("XD_TEST_DATABASE_URL") == "" || sample < 1 || sample > 3 || sampleName != fmt.Sprintf("sample-%d", sample) {
		t.Fatal("independent sample-1..3 and PostgreSQL17 DSN are required")
	}
	smoke := os.Getenv("XD_CAS_A02C_SMOKE") == "1"
	size := int64(4 << 30)
	if smoke {
		size = 64 << 20
	}
	rootDir := t.TempDir()
	var fs syscall.Statfs_t
	if err := syscall.Statfs(rootDir, &fs); err != nil {
		t.Fatal(err)
	}
	if !smoke && uint64(fs.Bavail)*uint64(fs.Bsize) < uint64(2*size+(2<<30)) {
		t.Fatal("Invalid environment: insufficient disk for 4GiB CAS plus staged duplicate")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, os.Getenv("XD_TEST_DATABASE_URL"))
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{},
		&meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.DownloadProgress{}, &meta.LocalPushQuotaHold{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(rootDir)
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("cas-a02c-performance-test-only", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 5 << 30,
	}).Router()
	tokenA := createTestUser(t, db, router, "a02c-a-"+sampleName, "test-password")
	tokenB := createTestUser(t, db, router, "a02c-b-"+sampleName, "test-password")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	var aPuts, bPuts, aBytes, bBytes atomic.Int64
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") && strings.Contains(r.URL.Path, "/chunks/") {
			if r.Header.Get("Authorization") == "Bearer "+tokenA {
				aPuts.Add(1)
				aBytes.Add(r.ContentLength)
			} else if r.Header.Get("Authorization") == "Bearer "+tokenB {
				bPuts.Add(1)
				bBytes.Add(r.ContentLength)
			}
		}
		router.ServeHTTP(w, r)
	}))
	defer peer.Close()
	client := &http.Client{Timeout: 12 * time.Minute}
	call := func(token, method, path string, body io.Reader, status int, headers map[string]string) []byte {
		t.Helper()
		req, err := http.NewRequest(method, peer.URL+path, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if err != nil || res.StatusCode != status {
			t.Fatalf("%s %s got HTTP%d want HTTP%d response=%q err=%v", method, path, res.StatusCode, status, out, err)
		}
		return out
	}
	begin := func(token string, root uint64, name, resume, hash string) uploadSessionDTO {
		t.Helper()
		raw, err := json.Marshal(uploadInitRequest{
			ParentID: &root, Name: name, Size: size,
			ChunkSize: casA03D3ChunkBytes, SHA256: hash, ResumeKey: resume,
		})
		if err != nil {
			t.Fatal(err)
		}
		out := call(token, http.MethodPost, "/api/v1/uploads", bytes.NewReader(raw), http.StatusCreated,
			map[string]string{"Content-Type": "application/json"})
		var session uploadSessionDTO
		if err := json.Unmarshal(out, &session); err != nil {
			t.Fatal(err)
		}
		return session
	}
	finish := func(token, id, expected string) nodeDTO {
		t.Helper()
		out := call(token, http.MethodPost, "/api/v1/uploads/"+id+"/finalize", strings.NewReader("{}"),
			http.StatusOK, map[string]string{"Content-Type": "application/json"})
		var session uploadSessionDTO
		if err := json.Unmarshal(out, &session); err != nil || session.Result == nil || session.Result.SHA256 != expected {
			t.Fatalf("finalize expected correct CAS: %+v err=%v", session, err)
		}
		return *session.Result
	}
	sendAll := func(token, id string, parts []string) {
		t.Helper()
		for i, hash := range parts {
			content := casA03D3Chunk(sample, i, size, false)
			s := sha256.Sum256(content)
			if hex.EncodeToString(s[:]) != hash {
				t.Fatalf("source chunk %d hash mismatch", i)
			}
			call(token, http.MethodPut, fmt.Sprintf("/api/v1/uploads/%s/chunks/%d", id, i),
				bytes.NewReader(content), http.StatusCreated,
				map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": hash})
		}
	}
	hashStart := time.Now()
	hashA, _, partsA, _, _ := casA03D3Hashes(sample, size)
	hashMS := float64(time.Since(hashStart).Microseconds()) / 1000
	count := int(size / casA03D3ChunkBytes)
	key, _ := storage.ContentAddressedKey(hashA)
	firstStart := time.Now()
	a := begin(tokenA, rootA.ID, "original.bin", "owner-a-original-"+sampleName, hashA)
	if a.Status != meta.UploadStatusActive || a.InstantCAS || len(a.Received) != 0 {
		t.Fatalf("first 4GiB upload must be active with no reused source: %+v", a)
	}
	sendAll(tokenA, a.ID, partsA)
	first := finish(tokenA, a.ID, hashA)
	firstMS := float64(time.Since(firstStart).Microseconds()) / 1000
	if aPuts.Load() != int64(count) || aBytes.Load() != size {
		t.Fatalf("first actual HTTP chunk bytes/count=%d/%d", aBytes.Load(), aPuts.Load())
	}
	allocatedA, err := casA03D3Allocated(rootDir, key)
	if err != nil || allocatedA < size {
		t.Fatalf("first 4GiB CAS must be physically allocated: %d %v", allocatedA, err)
	}
	instantWriteBefore := casA03D3WriteBytes()
	instantStart := time.Now()
	same := begin(tokenA, rootA.ID, "instant-copy.bin", "owner-a-instant-"+sampleName, hashA)
	instantMS := float64(time.Since(instantStart).Microseconds()) / 1000
	instantWrite := casA03D3WriteBytes() - instantWriteBefore
	if same.Status != meta.UploadStatusFinalized || !same.InstantCAS ||
		same.Result == nil || same.Result.SHA256 != hashA || aPuts.Load() != int64(count) ||
		instantWrite > 1<<20 {
		t.Fatalf("same-owner instant upload violated zero-new-data contract: %+v writes=%d", same, instantWrite)
	}
	call(tokenB, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d", first.ID), nil, http.StatusNotFound, nil)
	foreignStart := time.Now()
	b := begin(tokenB, rootB.ID, "cross-owner.bin", "owner-b-upload-"+sampleName, hashA)
	if b.Status != meta.UploadStatusActive || b.InstantCAS || len(b.Received) != 0 {
		t.Fatalf("cross-owner cannot instant-upload via known digest: %+v", b)
	}
	rssBefore, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	var peakRSS atomic.Int64
	peakRSS.Store(rssBefore)
	stop := make(chan struct{})
	done := make(chan struct{})
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
				if err != nil {
					continue
				}
				for {
					old := peakRSS.Load()
					if n <= old || peakRSS.CompareAndSwap(old, n) {
						break
					}
				}
			}
		}
	}()
	sendAll(tokenB, b.ID, partsA)
	foreignUploadMS := float64(time.Since(foreignStart).Microseconds()) / 1000
	if bPuts.Load() != int64(count) || bBytes.Load() != size {
		t.Fatalf("cross-owner body must be fully uploaded: PUT=%d bytes=%d", bPuts.Load(), bBytes.Load())
	}
	var stages []meta.UploadPart
	if err := db.Where("session_id = ?", b.ID).Order("part_index ASC").Find(&stages).Error; err != nil || len(stages) != count {
		t.Fatalf("cross-owner genuine staged parts count=%d expected=%d err=%v", len(stages), count, err)
	}
	var stageAllocated int64
	for i, part := range stages {
		if part.PartIndex != i || part.Reused || part.SHA256 != partsA[i] {
			t.Fatalf("staging identity mismatch part %d: %+v", i, part)
		}
		allocated, err := casA03D3Allocated(rootDir, part.StorageKey)
		if err != nil {
			t.Fatalf("missing physically staged part %d: %v", i, err)
		}
		stageAllocated += allocated
	}
	if stageAllocated < size {
		t.Fatalf("cross-owner stage must actually consume 4GiB allocated: %d", stageAllocated)
	}
	writeBefore := casA03D3WriteBytes()
	finalStart := time.Now()
	foreign := finish(tokenB, b.ID, hashA)
	finalMS := float64(time.Since(finalStart).Microseconds()) / 1000
	finalWrite := casA03D3WriteBytes() - writeBefore
	close(stop)
	<-done
	cpuAfter, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	crossRSSGrowth := max(int64(0), peakRSS.Load()-rssBefore)
	if finalWrite > 64<<20 || crossRSSGrowth > 512<<20 {
		t.Fatalf("cross-owner finalize unexpectedly materialized physical duplicate: writes=%d rss=%d", finalWrite, crossRSSGrowth)
	}
	physicalCount, physicalBytes, err := p046PhysicalInventory(context.Background(), store)
	physicalAllocated, allocationErr := casA03D3Allocated(rootDir, key)
	if err != nil || allocationErr != nil || physicalCount != 1 || physicalBytes != size || physicalAllocated != allocatedA {
		t.Fatalf("one unchanged CAS: count=%d logical=%d allocated=%d initial_allocated=%d walkErr=%v statErr=%v", physicalCount, physicalBytes, physicalAllocated, allocatedA, err, allocationErr)
	}
	var remainingStages int64
	if err := db.Model(&meta.UploadPart{}).Where("session_id IN ?", []string{a.ID, b.ID}).Count(&remainingStages).Error; err != nil || remainingStages != 0 {
		t.Fatalf("upload parts retained after finalize: %d %v", remainingStages, err)
	}
	for _, part := range stages {
		if _, err := os.Stat(filepath.Join(rootDir, filepath.FromSlash(part.StorageKey))); !os.IsNotExist(err) {
			t.Fatalf("cross-owner staged file survived finalize: %s %v", part.StorageKey, err)
		}
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", hashA).First(&blob).Error; err != nil || blob.RefCount != 3 || blob.Size != size {
		t.Fatalf("one immutable CAS must have three real logical refs: %+v %v", blob, err)
	}
	verifyStart := time.Now()
	if err := casA03D3Verify(store, key, hashA, size); err != nil {
		t.Fatal(err)
	}
	verifyMS := float64(time.Since(verifyStart).Microseconds()) / 1000
	release := func(token string, node nodeDTO, expectedRefs int64) {
		t.Helper()
		call(token, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", node.ID), nil, http.StatusNoContent,
			map[string]string{"If-Match": strconv.Quote(strconv.FormatUint(node.Revision, 10))})
		data := call(token, http.MethodGet, "/api/v1/trash", nil, http.StatusOK, nil)
		var trash []nodeDTO
		if err := json.Unmarshal(data, &trash); err != nil {
			t.Fatal(err)
		}
		for _, item := range trash {
			if item.ID != node.ID {
				continue
			}
			call(token, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", node.ID), nil, http.StatusNoContent,
				map[string]string{"If-Match": strconv.Quote(strconv.FormatUint(item.Revision, 10))})
			if expectedRefs == 0 {
				var n int64
				if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hashA).Count(&n).Error; err != nil || n != 0 {
					t.Fatalf("last owner GC did not remove Blob row: %d %v", n, err)
				}
			} else {
				if err := db.Where("sha256 = ?", hashA).First(&blob).Error; err != nil || blob.RefCount != expectedRefs {
					t.Fatalf("refcount after delete want=%d got=%d err=%v", expectedRefs, blob.RefCount, err)
				}
			}
			return
		}
		t.Fatalf("missing trash node %d", node.ID)
	}
	gcStart := time.Now()
	release(tokenA, *same.Result, 2)
	release(tokenA, first, 1)
	if err := casA03D3Verify(store, key, hashA, size); err != nil {
		t.Fatalf("cross-owner surviving CAS damaged after owner-A GC: %v", err)
	}
	release(tokenB, foreign, 0)
	gcMS := float64(time.Since(gcStart).Microseconds()) / 1000
	finalCount, finalBytes, err := p046PhysicalInventory(context.Background(), store)
	if err != nil || finalCount != 0 || finalBytes != 0 {
		t.Fatalf("last reference GC must reclaim physical CAS: count=%d bytes=%d err=%v", finalCount, finalBytes, err)
	}
	passed := firstMS <= 360000 && instantMS <= 30000 &&
		foreignUploadMS <= 360000 && finalMS <= 360000 && gcMS <= 180000 &&
		instantWrite <= 1<<20 && finalWrite <= 64<<20 && crossRSSGrowth <= 512<<20 &&
		cpuAfter >= cpuBefore
	result := map[string]any{
		"workload": "CAS-A02c-authenticated-4GiB-same-cross-owner-identical-CAS-reuse",
		"sample":   sampleName, "smoke_only": smoke,
		"source_bytes": size, "source_sha256": hashA, "source_prehash_ms": hashMS,
		"first_owner_http_puts": aPuts.Load(), "first_owner_real_put_body_bytes": aBytes.Load(),
		"first_owner_full_upload_ms":   firstMS,
		"same_owner_instant_http_puts": aPuts.Load() - int64(count),
		"same_owner_instant_ms":        instantMS, "same_owner_instant_kernel_write_bytes": instantWrite,
		"cross_owner_real_http_puts": bPuts.Load(), "cross_owner_body_bytes": bBytes.Load(),
		"cross_owner_upload_ms": foreignUploadMS, "cross_owner_staging_allocated_bytes": stageAllocated,
		"cross_owner_finalize_ms":                        finalMS,
		"cross_owner_finalize_go_write_bytes":            finalWrite,
		"cross_owner_go_cpu_ticks":                       cpuAfter - cpuBefore,
		"cross_owner_peak_go_rss_growth_bytes":           crossRSSGrowth,
		"physical_cas_count_after_both_owners":           physicalCount,
		"physical_cas_logical_bytes_after_both_owners":   physicalBytes,
		"physical_cas_allocated_bytes_after_both_owners": physicalAllocated,
		"full_physical_cas_sha_verify_ms":                verifyMS,
		"all_owner_last_reference_gc_ms":                 gcMS,
		"final_physical_cas_count":                       finalCount, "final_physical_cas_bytes": finalBytes,
		"passed": passed,
		"scope":  "Genuine Gin/PostgreSQL17/Local CAS; not Web/Electron/installed PWA, remote S3, six-client GUI, or WAN.",
	}
	row, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_A02C_REAL_HTTP %s", row)
	if !passed {
		t.Fatalf("frozen CAS-A02c CURRENT budget missed: %s", row)
	}
}
