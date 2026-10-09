//go:build linux

package main

import (
	"context"
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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/transfer"
)

type largeTransferPerformanceServerStats struct {
	mu            sync.Mutex
	uploadBytes   int64
	uploadChunks  int
	uploadStartAt time.Time
	firstChunkAt  time.Time
	finalizeAt    time.Time
	downloadBytes int64
	uploadHash    string
}

type largeTransferPerformanceMetric struct {
	Surface       string  `json:"surface"`
	Scenario      string  `json:"scenario"`
	Sample        string  `json:"sample"`
	SizeBytes     int64   `json:"size_bytes"`
	ElapsedMS     float64 `json:"elapsed_ms"`
	ThroughputMiB float64 `json:"throughput_mib_s"`
	RSSStartKiB   int64   `json:"rss_start_kib"`
	RSSPeakKiB    int64   `json:"rss_peak_kib"`
	RSSDeltaKiB   int64   `json:"rss_delta_kib"`
	PrehashMS     float64 `json:"prehash_ms,omitempty"`
	UploadBytes   int64   `json:"upload_bytes,omitempty"`
	UploadChunks  int     `json:"upload_chunks,omitempty"`
	DownloadBytes int64   `json:"download_bytes,omitempty"`
}

func largeTransferCurrentRSSKiB() int64 {
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		value, _ := strconv.ParseInt(fields[1], 10, 64)
		return value
	}
	return 0
}

func largeTransferSampleRSS(stop <-chan struct{}, ready chan<- struct{}, done chan<- struct{}, peak *atomic.Int64) {
	defer close(done)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		current := largeTransferCurrentRSSKiB()
		for {
			old := peak.Load()
			if current <= old || peak.CompareAndSwap(old, current) {
				break
			}
		}
		if ready != nil {
			close(ready)
			ready = nil
		}
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
	}
}

func largeTransferWriteZeros(w io.Writer, total int64) error {
	block := make([]byte, 1024*1024)
	for remaining := total; remaining > 0; {
		size := int64(len(block))
		if remaining < size {
			size = remaining
		}
		written, err := w.Write(block[:size])
		if err != nil {
			return err
		}
		if int64(written) != size {
			return io.ErrShortWrite
		}
		remaining -= size
	}
	return nil
}

func largeTransferUint64Ptr(value uint64) *uint64 {
	return &value
}

func newLargeTransferPerformanceServer(t *testing.T, stats *largeTransferPerformanceServerStats, largeTransferPerformanceBytes int64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads":
			var init client.UploadInit
			if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
				t.Error(err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			stats.mu.Lock()
			stats.uploadStartAt = time.Now()
			stats.uploadHash = init.SHA256
			stats.mu.Unlock()
			_ = json.NewEncoder(w).Encode(client.UploadSession{
				ID:         "perf-upload",
				ParentID:   init.ParentID,
				Name:       init.Name,
				Size:       init.Size,
				ChunkSize:  init.ChunkSize,
				ChunkCount: len(init.ChunkSHA256),
				SHA256:     init.SHA256,
				ResumeKey:  init.ResumeKey,
				Status:     "active",
				ExpiresAt:  time.Now().Add(time.Hour),
			})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/perf-upload/chunks/"):
			indexText := strings.TrimPrefix(r.URL.Path, "/api/v1/uploads/perf-upload/chunks/")
			index, err := strconv.Atoi(indexText)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			n, err := io.Copy(io.Discard, r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			stats.mu.Lock()
			if stats.firstChunkAt.IsZero() {
				stats.firstChunkAt = time.Now()
			}
			stats.uploadBytes += n
			stats.uploadChunks++
			stats.mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(client.UploadPart{
				Index: index, Size: n, SHA256: r.Header.Get("X-Chunk-SHA256"),
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads/perf-upload/finalize":
			stats.mu.Lock()
			stats.finalizeAt = time.Now()
			hash := stats.uploadHash
			stats.mu.Unlock()
			_ = json.NewEncoder(w).Encode(client.UploadSession{
				ID: "perf-upload", Status: "finalized", SHA256: hash,
				Result: &client.Node{
					ID: 99, ParentID: largeTransferUint64Ptr(1), Name: "large-upload.bin",
					Type: "file", Size: largeTransferPerformanceBytes, Revision: 1, SHA256: hash,
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/files/99/content":
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.FormatInt(largeTransferPerformanceBytes, 10))
			if err := largeTransferWriteZeros(w, largeTransferPerformanceBytes); err != nil {
				return
			}
			stats.mu.Lock()
			stats.downloadBytes += largeTransferPerformanceBytes
			stats.mu.Unlock()
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeLargeTransferPerformanceMetric(t *testing.T, metric largeTransferPerformanceMetric) {
	t.Helper()
	data, err := json.MarshalIndent(metric, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("LARGE_TRANSFER_PERF %s", data)
	output := strings.TrimSpace(os.Getenv("XD_LARGE_TRANSFER_PERF_OUTPUT"))
	if output == "" {
		return
	}
	if err := os.MkdirAll(output, 0o755); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("agent-%s-%s.json", metric.Scenario, metric.Sample)
	if err := os.WriteFile(filepath.Join(output, name), append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLargeTransferPerformanceBaselineLargeFile(t *testing.T) {
	if os.Getenv("XD_LARGE_TRANSFER_PERF") != "1" {
		t.Skip("set XD_LARGE_TRANSFER_PERF=1 to run the large-file transfer baseline")
	}
	sizeText := strings.TrimSpace(os.Getenv("XD_LARGE_TRANSFER_SIZE_GIB"))
	if sizeText == "" {
		sizeText = "1"
	}
	sizeGiB, sizeErr := strconv.ParseInt(sizeText, 10, 64)
	if sizeErr != nil || (sizeGiB != 1 && sizeGiB != 4) {
		t.Fatalf("XD_LARGE_TRANSFER_SIZE_GIB=%q want 1 or 4", sizeText)
	}
	largeTransferPerformanceBytes := sizeGiB << 30

	scenario := strings.TrimSpace(os.Getenv("XD_LARGE_TRANSFER_SCENARIO"))
	if scenario != "upload" && scenario != "download" {
		t.Fatalf("XD_LARGE_TRANSFER_SCENARIO=%q want upload or download", scenario)
	}
	sample := strings.TrimSpace(os.Getenv("XD_LARGE_TRANSFER_SAMPLE"))
	if sample == "" {
		sample = "sample-unknown"
	}

	dir := t.TempDir()
	source := filepath.Join(dir, "large-upload.bin")
	file, err := os.OpenFile(source, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(largeTransferPerformanceBytes); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	stats := &largeTransferPerformanceServerStats{}
	server := newLargeTransferPerformanceServer(t, stats, largeTransferPerformanceBytes)
	defer server.Close()
	cli := client.New(server.URL, "token")
	manager := transfer.NewManager(transfer.DefaultHistoryLimit)

	runtime.GC()
	startRSS := largeTransferCurrentRSSKiB()
	if startRSS <= 0 {
		t.Fatal("process RSS memory metrics are unavailable")
	}
	var peak atomic.Int64
	peak.Store(startRSS)
	stopRSS := make(chan struct{})
	readyRSS := make(chan struct{})
	doneRSS := make(chan struct{})
	go largeTransferSampleRSS(stopRSS, readyRSS, doneRSS, &peak)
	<-readyRSS

	startedAt := time.Now()
	switch scenario {
	case "upload":
		handle, progress := startAgentCloudTransfer(
			manager, transfer.KindUpload, "upload", filepath.Base(source), source,
			largeTransferPerformanceBytes,
		)
		result, uploadErr := cli.UploadFileResumableWithConflictPolicyResult(
			agentUploadTransferContext(context.Background(), handle),
			1, source, filepath.Base(source),
			client.UploadConflictPolicyFail, progress,
		)
		finishAgentCloudTransfer(handle, uploadErr)
		if uploadErr != nil {
			close(stopRSS)
			t.Fatal(uploadErr)
		}
		if result.TransferredBytes != largeTransferPerformanceBytes || result.Skipped {
			close(stopRSS)
			t.Fatalf("upload result=%+v", result)
		}
	case "download":
		destination := filepath.Join(dir, "large-download.bin")
		handle, progress := startAgentCloudTransfer(
			manager, transfer.KindDownload, "download", filepath.Base(destination), destination,
			largeTransferPerformanceBytes,
		)
		downloadErr := downloadAgentCloudFileIntoPath(
			context.Background(), cli, 99, destination, progress,
		)
		finishAgentCloudTransfer(handle, downloadErr)
		if downloadErr != nil {
			close(stopRSS)
			t.Fatal(downloadErr)
		}
		info, statErr := os.Stat(destination)
		if statErr != nil {
			close(stopRSS)
			t.Fatal(statErr)
		}
		if info.Size() != largeTransferPerformanceBytes {
			close(stopRSS)
			t.Fatalf("download size=%d want=%d", info.Size(), largeTransferPerformanceBytes)
		}
	}
	elapsed := time.Since(startedAt)
	close(stopRSS)
	<-doneRSS
	finalRSS := largeTransferCurrentRSSKiB()
	if finalRSS > peak.Load() {
		peak.Store(finalRSS)
	}

	stats.mu.Lock()
	uploadBytes := stats.uploadBytes
	uploadChunks := stats.uploadChunks
	downloadBytes := stats.downloadBytes
	uploadStartAt := stats.uploadStartAt
	stats.mu.Unlock()

	if scenario == "upload" {
		if uploadBytes != largeTransferPerformanceBytes {
			t.Fatalf("upload bytes=%d want=%d", uploadBytes, largeTransferPerformanceBytes)
		}
		if uploadChunks != int(largeTransferPerformanceBytes/client.DefaultUploadChunkSize) {
			t.Fatalf("upload chunks=%d want=%d", uploadChunks, largeTransferPerformanceBytes/client.DefaultUploadChunkSize)
		}
	} else if downloadBytes != largeTransferPerformanceBytes {
		t.Fatalf("download bytes=%d want=%d", downloadBytes, largeTransferPerformanceBytes)
	}

	metric := largeTransferPerformanceMetric{
		Surface:       "desktop-agent-core",
		Scenario:      scenario,
		Sample:        sample,
		SizeBytes:     largeTransferPerformanceBytes,
		ElapsedMS:     float64(elapsed) / float64(time.Millisecond),
		ThroughputMiB: (float64(largeTransferPerformanceBytes) / (1024 * 1024)) / elapsed.Seconds(),
		RSSStartKiB:   startRSS,
		RSSPeakKiB:    peak.Load(),
		RSSDeltaKiB:   max(int64(0), peak.Load()-startRSS),
		UploadBytes:   uploadBytes,
		UploadChunks:  uploadChunks,
		DownloadBytes: downloadBytes,
	}
	if scenario == "upload" && !uploadStartAt.IsZero() {
		metric.PrehashMS = float64(uploadStartAt.Sub(startedAt)) / float64(time.Millisecond)
	}
	writeLargeTransferPerformanceMetric(t, metric)
}
