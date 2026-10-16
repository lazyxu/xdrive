//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/binary"
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

const casA03D3ChunkBytes int64 = 8 << 20

// Each SHA-distinct 8MiB source block is reproducible without allocating a 4GiB file.
// The 1MiB edit is inside one block, at the same offset in both versions.
func casA03D3Chunk(sample, index int, size int64, changed bool) []byte {
	seed := sha256.Sum256([]byte(fmt.Sprintf("cas-a03-d3-physical-%d", sample)))
	block, err := aes.NewCipher(seed[:])
	if err != nil {
		panic(err)
	}
	var iv [aes.BlockSize]byte
	binary.BigEndian.PutUint64(iv[8:], uint64(index)*uint64(casA03D3ChunkBytes/aes.BlockSize))
	payload := make([]byte, int(casA03D3ChunkBytes))
	cipher.NewCTR(block, iv[:]).XORKeyStream(payload, payload)
	editAt := size/2 + (2 << 20)
	offset := int64(index) * casA03D3ChunkBytes
	if changed && editAt >= offset && editAt+(1<<20) <= offset+casA03D3ChunkBytes {
		for i := int64(0); i < 1<<20; i++ {
			payload[int(editAt-offset+i)] ^= 0xa5
		}
	}
	return payload
}

func casA03D3Hashes(sample int, size int64) (string, string, []string, []string, int) {
	ha, hb := sha256.New(), sha256.New()
	n := int(size / casA03D3ChunkBytes)
	a, b := make([]string, n), make([]string, n)
	changedIndex := -1
	for i := 0; i < n; i++ {
		part := casA03D3Chunk(sample, i, size, false)
		_, _ = ha.Write(part)
		original := sha256.Sum256(part)
		a[i] = hex.EncodeToString(original[:])
		editAt := size/2 + (2 << 20)
		if editAt >= int64(i)*casA03D3ChunkBytes && editAt < int64(i+1)*casA03D3ChunkBytes {
			part = casA03D3Chunk(sample, i, size, true)
			changedIndex = i
		}
		_, _ = hb.Write(part)
		changed := sha256.Sum256(part)
		b[i] = hex.EncodeToString(changed[:])
	}
	return hex.EncodeToString(ha.Sum(nil)), hex.EncodeToString(hb.Sum(nil)), a, b, changedIndex
}

func casA03D3Allocated(root, key string) (int64, error) {
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(key)))
	if err != nil {
		return 0, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, fmt.Errorf("missing Linux allocated-block stat")
	}
	return stat.Blocks * 512, nil
}

func casA03D3WriteBytes() uint64 {
	buf, err := os.ReadFile("/proc/self/io")
	if err != nil {
		return 0
	}
	for _, row := range strings.Split(string(buf), "\n") {
		if strings.HasPrefix(row, "write_bytes:") {
			n, _ := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(row, "write_bytes:")), 10, 64)
			return n
		}
	}
	return 0
}

func casA03D3Verify(store *storage.Local, key, expected string, size int64) error {
	f, err := store.Open(context.Background(), key)
	if err != nil {
		return err
	}
	defer f.Close()
	hasher := sha256.New()
	n, err := io.CopyBuffer(hasher, f, make([]byte, 1<<20))
	if err != nil || n != size || hex.EncodeToString(hasher.Sum(nil)) != expected {
		return fmt.Errorf("full physical version SHA mismatch: bytes=%d err=%v", n, err)
	}
	return nil
}

// CAS-A03-d3 is the genuine authenticated Gin/PostgreSQL17/upload API path,
// unlike the accepted CAS-A03-d1 Local.Put and d2 offline fixed-block model.
// The optional 64MiB smoke is NOT a valid 4GiB performance sample.
func TestCASA03D3RealHTTP4GiBSmallEditVersion(t *testing.T) {
	if os.Getenv("XD_CAS_A03_D3_REAL_HTTP") != "1" {
		t.Skip("opt in to genuine CAS-A03-d3 HTTP/PG/CAS benchmark")
	}
	sampleName := os.Getenv("XD_CAS_A03_D3_SAMPLE")
	sample, err := strconv.Atoi(strings.TrimPrefix(sampleName, "sample-"))
	if os.Getenv("XD_TEST_DATABASE_URL") == "" || sampleName != fmt.Sprintf("sample-%d", sample) || sample < 1 || sample > 3 {
		t.Fatal("real PostgreSQL17 DSN and independent sample-1..3 required")
	}
	smoke := os.Getenv("XD_CAS_A03_D3_SMOKE") == "1"
	size := int64(4 << 30)
	if smoke {
		size = 64 << 20
	}
	rootDir := t.TempDir()
	var fs syscall.Statfs_t
	if err := syscall.Statfs(rootDir, &fs); err != nil {
		t.Fatal(err)
	}
	if !smoke && uint64(fs.Bavail)*uint64(fs.Bsize) < uint64(3*size+(1<<30)) {
		t.Fatal("Invalid environment: insufficient physical runner disk, not product RED")
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
	server := &Server{
		DB: db, Store: store, Auth: auth.New("cas-a03-d3-test-only", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 5 << 30,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "cas-a03-d3-"+sampleName, "test-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var realPutCount atomic.Int64
	var realPutBodyBytes atomic.Int64
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut &&
			strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") &&
			strings.Contains(r.URL.Path, "/chunks/") {
			realPutCount.Add(1)
			if r.ContentLength > 0 {
				realPutBodyBytes.Add(r.ContentLength)
			}
		}
		router.ServeHTTP(w, r)
	}))
	defer peer.Close()
	client := &http.Client{Timeout: 12 * time.Minute}
	call := func(method, path string, body io.Reader, status int, headers map[string]string) []byte {
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
		data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if err != nil || res.StatusCode != status {
			t.Fatalf("%s %s expected=%d actual=%d response=%q err=%v", method, path, status, res.StatusCode, data, err)
		}
		return data
	}
	begin := func(init uploadInitRequest) uploadSessionDTO {
		t.Helper()
		body, err := json.Marshal(init)
		if err != nil {
			t.Fatal(err)
		}
		out := call(http.MethodPost, "/api/v1/uploads", bytes.NewReader(body), http.StatusCreated,
			map[string]string{"Content-Type": "application/json"})
		var session uploadSessionDTO
		if err := json.Unmarshal(out, &session); err != nil || session.Status != meta.UploadStatusActive {
			t.Fatalf("upload init is not active: %+v %v", session, err)
		}
		return session
	}
	send := func(id string, index int, patched bool, expected string) {
		t.Helper()
		part := casA03D3Chunk(sample, index, size, patched)
		actual := sha256.Sum256(part)
		if hex.EncodeToString(actual[:]) != expected {
			t.Fatalf("changed local source part %d SHA mismatch", index)
		}
		call(http.MethodPut, fmt.Sprintf("/api/v1/uploads/%s/chunks/%d", id, index),
			bytes.NewReader(part), http.StatusCreated,
			map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": expected})
	}
	finish := func(id, hash string, revision uint64) nodeDTO {
		t.Helper()
		data := call(http.MethodPost, "/api/v1/uploads/"+id+"/finalize",
			strings.NewReader("{}"), http.StatusOK, map[string]string{"Content-Type": "application/json"})
		var session uploadSessionDTO
		if err := json.Unmarshal(data, &session); err != nil || session.Result == nil ||
			session.Result.Revision != revision || session.Result.SHA256 != hash {
			t.Fatalf("finalized physical version incorrect: %+v %v", session, err)
		}
		return *session.Result
	}
	hashStart := time.Now()
	hashA, hashB, partsA, partsB, changedIndex := casA03D3Hashes(sample, size)
	prehashMS := float64(time.Since(hashStart).Microseconds()) / 1000
	count := int(size / casA03D3ChunkBytes)
	if hashA == hashB || changedIndex < 0 {
		t.Fatal("source A and 1MiB-patched B must differ")
	}
	seedStart := time.Now()
	a := begin(uploadInitRequest{ParentID: &root.ID, Name: "versioned.bin", Size: size,
		ChunkSize: casA03D3ChunkBytes, SHA256: hashA, ResumeKey: "a-" + sampleName})
	for i := 0; i < count; i++ {
		send(a.ID, i, false, partsA[i])
	}
	first := finish(a.ID, hashA, 1)
	seedHTTPPutCount := realPutCount.Load()
	seedHTTPPutBytes := realPutBodyBytes.Load()
	if seedHTTPPutCount != int64(count) || seedHTTPPutBytes != size {
		t.Fatalf("A authenticated HTTP payload count=%d bytes=%d, want=%d/%d", seedHTTPPutCount, seedHTTPPutBytes, count, size)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	keyA, _ := storage.ContentAddressedKey(hashA)
	beforeAllocated, err := casA03D3Allocated(rootDir, keyA)
	if err != nil || beforeAllocated < size {
		t.Fatalf("original full CAS not physically allocated: %d %v", beforeAllocated, err)
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
	stopPeak := make(chan struct{})
	peakDone := make(chan struct{})
	go func() {
		defer close(peakDone)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopPeak:
				return
			case <-ticker.C:
				n, err := p046RSS()
				if err != nil {
					continue
				}
				for {
					prev := peakRSS.Load()
					if n <= prev || peakRSS.CompareAndSwap(prev, n) {
						break
					}
				}
			}
		}
	}()
	writeBefore := casA03D3WriteBytes()
	initStart := time.Now()
	b := begin(uploadInitRequest{NodeID: &first.ID, ExpectedRevision: first.Revision,
		Size: size, ChunkSize: casA03D3ChunkBytes, SHA256: hashB,
		ChunkSHA256: partsB, ResumeKey: "b-" + sampleName})
	initMS := float64(time.Since(initStart).Microseconds()) / 1000
	if len(b.Received) != count-1 {
		t.Fatalf("received reuse count=%d, expected=%d", len(b.Received), count-1)
	}
	for _, part := range b.Received {
		if part.Index < 0 || part.Index >= count || part.Index == changedIndex ||
			!part.Reused || part.SHA256 != partsB[part.Index] {
			t.Fatalf("invalid prefilled reused part: %+v", part)
		}
	}
	putStart := time.Now()
	send(b.ID, changedIndex, true, partsB[changedIndex])
	putMS := float64(time.Since(putStart).Microseconds()) / 1000
	finalStart := time.Now()
	newNode := finish(b.ID, hashB, 2)
	finalMS := float64(time.Since(finalStart).Microseconds()) / 1000
	changedHTTPPutCount := realPutCount.Load() - seedHTTPPutCount
	changedHTTPPutBytes := realPutBodyBytes.Load() - seedHTTPPutBytes
	if changedHTTPPutCount != 1 || changedHTTPPutBytes != casA03D3ChunkBytes {
		t.Fatalf("B authenticated actual HTTP PUT count=%d bytes=%d", changedHTTPPutCount, changedHTTPPutBytes)
	}
	writeAfter := casA03D3WriteBytes()
	rssAfter, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuAfter, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	close(stopPeak)
	<-peakDone
	for {
		prev := peakRSS.Load()
		if rssAfter <= prev || peakRSS.CompareAndSwap(prev, rssAfter) {
			break
		}
	}
	keyB, _ := storage.ContentAddressedKey(hashB)
	newAllocated, err := casA03D3Allocated(rootDir, keyB)
	if err != nil || newAllocated < size {
		t.Fatalf("changed full CAS not physically allocated: %d %v", newAllocated, err)
	}
	var file meta.File
	if err := db.Where("node_id = ?", first.ID).First(&file).Error; err != nil || file.SHA256 != hashB {
		t.Fatalf("new version current File incorrect: %+v %v", file, err)
	}
	var history []meta.FileVersion
	if err := db.Where("node_id = ?", first.ID).Find(&history).Error; err != nil ||
		len(history) != 1 || history[0].SHA256 != hashA || history[0].Revision != 1 {
		t.Fatalf("old FileVersion incorrect: %+v %v", history, err)
	}
	for _, h := range []string{hashA, hashB} {
		var blob meta.ContentBlob
		if err := db.Where("sha256 = ?", h).First(&blob).Error; err != nil || blob.RefCount != 1 {
			t.Fatalf("historical/current ContentBlob ref incorrect: %+v %v", blob, err)
		}
	}
	var partRows int64
	if err := db.Model(&meta.UploadPart{}).Where("session_id IN ?", []string{a.ID, b.ID}).Count(&partRows).Error; err != nil || partRows != 0 {
		t.Fatalf("finalization leaked upload stages: %d %v", partRows, err)
	}
	verifyStart := time.Now()
	if err := casA03D3Verify(store, keyA, hashA, size); err != nil {
		t.Fatal(err)
	}
	if err := casA03D3Verify(store, keyB, hashB, size); err != nil {
		t.Fatal(err)
	}
	verifyMS := float64(time.Since(verifyStart).Microseconds()) / 1000
	gcStart := time.Now()
	call(http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", newNode.ID), nil, http.StatusNoContent,
		map[string]string{"If-Match": fmt.Sprintf("%q", strconv.FormatUint(newNode.Revision, 10))})
	rawTrash := call(http.MethodGet, "/api/v1/trash", nil, http.StatusOK, nil)
	var trash []nodeDTO
	if err := json.Unmarshal(rawTrash, &trash); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range trash {
		if item.ID == newNode.ID {
			call(http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", item.ID), nil, http.StatusNoContent,
				map[string]string{"If-Match": fmt.Sprintf("%q", strconv.FormatUint(item.Revision, 10))})
			found = true
		}
	}
	if !found {
		t.Fatal("missing owned item in trash")
	}
	gcMS := float64(time.Since(gcStart).Microseconds()) / 1000
	physicalCount, physicalBytes, err := p046PhysicalInventory(context.Background(), store)
	if err != nil || physicalCount != 0 || physicalBytes != 0 {
		t.Fatalf("both physical versions not GCed: count=%d bytes=%d err=%v", physicalCount, physicalBytes, err)
	}
	var remaining int64
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 IN ?", []string{hashA, hashB}).Count(&remaining).Error; err != nil || remaining != 0 {
		t.Fatalf("ContentBlob final rows=%d err=%v", remaining, err)
	}
	rssGrowth := max(int64(0), peakRSS.Load()-rssBefore)
	passed := seedMS <= 360000 && initMS <= 180000 && putMS <= 120000 &&
		finalMS <= 360000 && gcMS <= 180000 && rssGrowth <= 512<<20 &&
		writeAfter > writeBefore && cpuAfter >= cpuBefore
	result := map[string]any{
		"workload": "CAS-A03-d3-authenticated-HTTP-4GiB-one-MiB-version-physical-GC",
		"sample":   sampleName, "smoke_only": smoke,
		"source_bytes_per_version": size, "changed_bytes": 1 << 20,
		"chunk_bytes": casA03D3ChunkBytes, "chunk_count": count,
		"hash_A": hashA, "hash_B": hashB, "changed_chunk_index": changedIndex,
		"first_upload_real_http_puts": seedHTTPPutCount, "first_upload_body_bytes": seedHTTPPutBytes,
		"B_reused_parts": len(b.Received), "B_real_http_puts": changedHTTPPutCount,
		"B_real_http_put_body_bytes": changedHTTPPutBytes,
		"source_prehash_ms":          prehashMS, "first_upload_seed_ms": seedMS,
		"B_init_old_blob_scan_ms": initMS, "B_changed_part_put_ms": putMS,
		"B_full_cas_finalize_ms":           finalMS,
		"two_versions_full_sha_restore_ms": verifyMS, "http_permanent_delete_gc_ms": gcMS,
		"A_allocated_bytes": beforeAllocated, "B_allocated_bytes": newAllocated,
		"two_versions_allocated_bytes":            beforeAllocated + newAllocated,
		"B_init_through_final_kernel_write_bytes": writeAfter - writeBefore,
		"B_go_cpu_ticks":                          cpuAfter - cpuBefore, "B_postseed_rss_growth_bytes": rssGrowth,
		"final_physical_cas_count": physicalCount, "final_physical_cas_bytes": physicalBytes,
		"passed": passed,
		"scope":  "Real authenticated Gin/PostgreSQL/Local CAS upload version with chunk SHA reuse; not real Web/Electron/OS-installed PWA, WAN or production delta-storage.",
	}
	row, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_A03_D3_REAL_HTTP %s", row)
	if !passed {
		t.Fatalf("CAS-A03-d3 frozen original budget missed: %s", row)
	}
}
