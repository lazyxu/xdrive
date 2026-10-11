//go:build linux

package api

import (
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
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// This benchmark deliberately uses the real production Server Router,
// PostgreSQL and Local CAS, not the mock HTTP large-file fixture.
func TestRealServerCASLargeTransferBaseline(t *testing.T) {
	if os.Getenv("XD_REAL_SERVER_CAS_LARGE_PERF") != "1" {
		t.Skip("set XD_REAL_SERVER_CAS_LARGE_PERF=1 for real Server/CAS large-file benchmark")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("native PostgreSQL17 DSN required")
	}
	sizeText := strings.TrimSpace(os.Getenv("XD_REAL_SERVER_CAS_SIZE_GIB"))
	if sizeText == "" {
		sizeText = "1"
	}
	sizeGiB, err := strconv.ParseInt(sizeText, 10, 64)
	if err != nil || (sizeGiB != 1 && sizeGiB != 4) {
		t.Fatalf("XD_REAL_SERVER_CAS_SIZE_GIB=%q must be 1 or 4", sizeText)
	}
	const MiB = int64(1 << 20)
	size := sizeGiB << 30
	sample := strings.TrimSpace(os.Getenv("XD_REAL_SERVER_CAS_SAMPLE"))
	if sample == "" {
		sample = "sample-unset"
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.DownloadProgress{},
		&meta.AuditEvent{},
	); err != nil {
		t.Fatalf("fresh production Postgres schema: %v", err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	capacityBefore, err := local.Capacity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if capacityBefore.AvailableBytes < size*3 {
		t.Fatalf("real Server/CAS needs at least 3x payload temporary disk capacity: available=%d want>=%d",
			capacityBefore.AvailableBytes, size*3)
	}
	server := &Server{
		DB: db, Store: local,
		Auth:           auth.New("real-server-cas-large-perf", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 5 << 30,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "large-cas-"+sample, "native-cas-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var chunkRequests atomic.Int64
	var fileDownloadRequests atomic.Int64
	measuredRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") && strings.Contains(r.URL.Path, "/chunks/") {
			chunkRequests.Add(1)
		}
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/files/") && strings.HasSuffix(r.URL.Path, "/content") {
			fileDownloadRequests.Add(1)
		}
		router.ServeHTTP(w, r)
	})
	peer := httptest.NewServer(measuredRouter)
	defer peer.Close()
	cli := client.New(peer.URL, token)
	cli.HTTP = peer.Client()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	source := filepath.Join(t.TempDir(), "large-source.bin")
	f, err := os.OpenFile(source, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(size); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	// A sparse zero-filled source avoids an unrelated 1/4 GiB data-generator
	// timing, but the real CAS staging and final file bytes are fully written.
	runtime.GC()
	rssStart := realServerCASVmRSS()
	if rssStart <= 0 {
		t.Fatal("native VmRSS baseline unavailable")
	}
	var rssPeak atomic.Int64
	rssPeak.Store(rssStart)
	stopRSS := make(chan struct{})
	doneRSS := make(chan struct{})
	go func() {
		defer close(doneRSS)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopRSS:
				return
			case <-ticker.C:
				if current := realServerCASVmRSS(); current > rssPeak.Load() {
					rssPeak.Store(current)
				}
			}
		}
	}()
	stopOnce := false
	shutdownSampler := func() {
		if !stopOnce {
			close(stopRSS)
			<-doneRSS
			stopOnce = true
		}
	}
	defer shutdownSampler()
	cpuStart := realServerCASCPUTime(t)
	uploadStart := time.Now()
	var lastProgress int64
	result, err := cli.UploadFileResumableResult(ctx, root.ID, source, fmt.Sprintf("real-%d-gib.bin", sizeGiB),
		func(done, total int64) {
			lastProgress = done
			if total != size || done < 0 || done > total {
				t.Errorf("invalid actual Server upload progress=%d/%d, want total=%d", done, total, size)
			}
		})
	uploadElapsed := time.Since(uploadStart)
	cpuAfterUpload := realServerCASCPUTime(t)
	if err != nil {
		t.Fatalf("authentic Client -> Gin/Postgres/CAS resumable upload: %v", err)
	}
	if result.Skipped || result.TransferredBytes != size || lastProgress != size ||
		result.Node.Size != size || result.Node.ID == 0 || result.Node.SHA256 != result.SHA256 {
		t.Fatalf("large source transfer integrity: transferred=%d progress=%d node=%+v, hash=%s",
			result.TransferredBytes, lastProgress, result.Node, result.SHA256)
	}
	var stored meta.File
	if err := db.First(&stored, "node_id = ?", result.Node.ID).Error; err != nil {
		t.Fatalf("real persisted file metadata missing: %v", err)
	}
	var blob meta.ContentBlob
	if err := db.First(&blob, "sha256 = ?", result.SHA256).Error; err != nil {
		t.Fatalf("real content-addressed PostgreSQL blob row missing: %v", err)
	}
	wantKey, err := storage.ContentAddressedKey(result.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Size != size || stored.SHA256 != result.SHA256 ||
		blob.Size != size || blob.StorageKey != wantKey || blob.RefCount < 1 {
		t.Fatalf("real persisted CAS mismatch: file=%+v blob=%+v", stored, blob)
	}
	cas, err := local.Open(ctx, wantKey)
	if err != nil {
		t.Fatalf("genuine CAS source missing: %v", err)
	}
	info, statErr := cas.Stat()
	_ = cas.Close()
	if statErr != nil || info.Size() != size {
		t.Fatalf("genuine CAS physical size mismatch: stat=%v size=%d", statErr, info.Size())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api/v1/files/%d/content", peer.URL, result.Node.ID), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	downloadStart := time.Now()
	response, err := peer.Client().Do(req)
	if err != nil {
		t.Fatalf("real Gin/CAS HTTP GET failed: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		t.Fatalf("real download returned HTTP %d, want 200", response.StatusCode)
	}
	hash := sha256.New()
	received, copyErr := io.CopyBuffer(hash, response.Body, make([]byte, 256<<10))
	closeErr := response.Body.Close()
	downloadElapsed := time.Since(downloadStart)
	cpuAfterDownload := realServerCASCPUTime(t)
	shutdownSampler()
	rssEnd := realServerCASVmRSS()
	if rssEnd <= 0 {
		t.Fatal("native VmRSS after transfer unavailable")
	}
	if rssEnd > rssPeak.Load() {
		rssPeak.Store(rssEnd)
	}
	if copyErr != nil || closeErr != nil {
		t.Fatalf("real CAS HTTP response read: copy=%v close=%v", copyErr, closeErr)
	}
	if received != size || hex.EncodeToString(hash.Sum(nil)) != result.SHA256 ||
		response.Header.Get("X-Content-SHA256") != result.SHA256 {
		t.Fatalf("real CAS download corrupted: bytes=%d/%d digest=%s expected=%s header=%s",
			received, size, hex.EncodeToString(hash.Sum(nil)), result.SHA256,
			response.Header.Get("X-Content-SHA256"))
	}
	if response.ContentLength >= 0 && response.ContentLength != size {
		t.Fatalf("trusted HTTP Content-Length=%d want=%d", response.ContentLength, size)
	}
	if chunkRequests.Load() != size/client.DefaultUploadChunkSize || fileDownloadRequests.Load() != 1 {
		t.Fatalf("unexpected real route request count: PUT chunks=%d expected=%d, download GET=%d",
			chunkRequests.Load(), size/client.DefaultUploadChunkSize, fileDownloadRequests.Load())
	}
	const maxPeakGrowth = int64(256 << 20)
	peakIncrease := max(int64(0), rssPeak.Load()-rssStart)
	metric := map[string]any{
		"name":                         "real-server-postgres-cas-1gib-upload-download",
		"status":                       "CURRENT-BEFORE / native production Server API and local CAS",
		"sample":                       sample,
		"size_gib":                     sizeGiB,
		"size_bytes":                   size,
		"upload_bytes":                 result.TransferredBytes,
		"upload_chunk_size":            client.DefaultUploadChunkSize,
		"upload_expected_chunks":       size / client.DefaultUploadChunkSize,
		"upload_http_put_count":        chunkRequests.Load(),
		"download_http_get_count":      fileDownloadRequests.Load(),
		"upload_elapsed_ms":            float64(uploadElapsed.Microseconds()) / 1000,
		"upload_mib_s":                 float64(size/MiB) / uploadElapsed.Seconds(),
		"download_bytes":               received,
		"download_elapsed_ms":          float64(downloadElapsed.Microseconds()) / 1000,
		"download_mib_s":               float64(size/MiB) / downloadElapsed.Seconds(),
		"cpu_upload_ms":                float64((cpuAfterUpload - cpuStart).Microseconds()) / 1000,
		"cpu_download_ms":              float64((cpuAfterDownload - cpuAfterUpload).Microseconds()) / 1000,
		"rss_start_bytes":              rssStart,
		"rss_peak_bytes":               rssPeak.Load(),
		"rss_end_bytes":                rssEnd,
		"rss_peak_delta_bytes":         peakIncrease,
		"disk_available_before":        capacityBefore.AvailableBytes,
		"cas_key":                      wantKey,
		"cas_ref_count":                blob.RefCount,
		"download_content_length":      response.ContentLength,
		"download_header_hash_matches": response.Header.Get("X-Content-SHA256") == result.SHA256,
		"correct":                      true,
		"scope":                        "real Client.UploadFileResumableResult and authenticated Gin UploadSession/part SHA/finalize/PostgreSQL/physical local CAS plus real Gin HTTP GET streaming/checksum; NOT desktop Electron IPC, Web browser, WAN, live 4GiB download, or actual varying file content",
		"frozen_budget": map[string]any{
			"upload_ms_1gib":            180000,
			"download_ms_1gib":          120000,
			"max_peak_rss_growth_bytes": maxPeakGrowth,
		},
	}
	payload, err := json.Marshal(metric)
	if err != nil {
		t.Fatal(err)
	}
	if out := strings.TrimSpace(os.Getenv("XD_REAL_SERVER_CAS_LARGE_OUTPUT")); out != "" {
		if err := os.MkdirAll(filepath.Dir(out), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(out, append(payload, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("REAL_SERVER_CAS_LARGE_SAMPLE %s", payload)
	if sizeGiB == 1 && (uploadElapsed > 180*time.Second || downloadElapsed > 120*time.Second || peakIncrease > maxPeakGrowth) {
		t.Errorf("valid real Server/CAS baseline breached frozen performance budget: upload=%s download=%s RSS peak growth=%d",
			uploadElapsed, downloadElapsed, peakIncrease)
	}
}

func realServerCASVmRSS() int64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) > 1 {
			kib, parseErr := strconv.ParseInt(fields[1], 10, 64)
			if parseErr == nil && kib > 0 {
				return kib * 1024
			}
		}
	}
	return 0
}

func realServerCASCPUTime(t *testing.T) time.Duration {
	t.Helper()
	var r syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &r); err != nil {
		t.Fatal(err)
	}
	micros := r.Utime.Sec*1000000 + r.Utime.Usec + r.Stime.Sec*1000000 + r.Stime.Usec
	return time.Duration(micros) * time.Microsecond
}
