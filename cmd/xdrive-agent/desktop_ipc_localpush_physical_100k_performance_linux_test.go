//go:build linux

package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
)

const (
	lpP002FileCountFull     = 100000
	lpP002FileCountSmoke    = 1000
	lpP002FilesPerDirectory = 1000
	lpP002SourceID          = uint64(42)
	lpP002SourceRevision    = uint64(7)
	lpP002PhysicalBytes     = 1024
	lpP002MaxRSSKiB         = 524288
)

type lpP002Phase struct {
	WallMS           float64 `json:"wall_ms"`
	UserCPUMS        float64 `json:"user_cpu_ms"`
	SystemCPUMS      float64 `json:"system_cpu_ms"`
	KernelWriteBytes int64   `json:"kernel_write_bytes"`
	MaxRSSKiB        int64   `json:"max_rss_kib"`
}

type lpP002Result struct {
	WorkloadID           string      `json:"workload_id"`
	Sample               string      `json:"sample"`
	Files                int         `json:"physical_file_count"`
	Directories          int         `json:"physical_directory_count"`
	LogicalBytes         int64       `json:"physical_source_logical_bytes"`
	AllocatedBytes       int64       `json:"source_allocated_blocks_bytes"`
	UniqueNativeInodes   int         `json:"unique_native_inodes"`
	SeedSHA256           string      `json:"seed_sha256"`
	Seed                 lpP002Phase `json:"seed"`
	FirstSnapshotHTTP    lpP002Phase `json:"first_snapshot_http"`
	Mutation             lpP002Phase `json:"mutation"`
	SecondSnapshotHTTP   lpP002Phase `json:"second_snapshot_http"`
	DeltaHTTP            lpP002Phase `json:"delta_http"`
	FirstResponseBytes   int         `json:"first_response_bytes"`
	SecondResponseBytes  int         `json:"second_response_bytes"`
	DeltaResponseBytes   int         `json:"delta_response_bytes"`
	ScannedFirst         int64       `json:"scanned_first"`
	ScannedSecond        int64       `json:"scanned_second"`
	DeltaAdded           int64       `json:"delta_added"`
	DeltaChanged         int64       `json:"delta_changed"`
	DeltaStable          int64       `json:"delta_metadata_stable"`
	DeltaAbsent          int64       `json:"delta_absent_candidates"`
	DeltaAuthoritative   bool        `json:"delta_authoritative"`
	MissingInferenceSafe bool        `json:"missing_inference_safe"`
	ManagerKind          string      `json:"manager_kind"`
	MaxRSSKiB            int64       `json:"process_peak_rss_kib"`
	Passed               bool        `json:"passed"`
	ProductionChanged    bool        `json:"production_changed"`
}

type lpP002IPCAdapter struct {
	*fakeDesktopIPCController
	grant     localpush.RootGrant
	configDir string
}

func (a *lpP002IPCAdapter) CloudSaveLocalBoundBackupSnapshot(ctx context.Context, sourceID uint64) (localBackupSnapshotSummary, error) {
	if sourceID != lpP002SourceID || ctx == nil {
		return localBackupSnapshotSummary{}, errors.New("wrong benchmark source")
	}
	snapshot, stats, err := localpush.ScanInventoryToJournal(
		ctx, a.configDir, a.grant,
		localpush.InventoryScanner{BatchSize: localpush.DefaultInventoryBatchSize},
	)
	if err != nil {
		return localBackupSnapshotSummary{}, err
	}
	verified, err := localpush.VerifyInventoryJournal(ctx, a.configDir, a.grant)
	if err != nil || verified.SnapshotSHA256 != snapshot.SnapshotSHA256 ||
		verified.Items != snapshot.Items {
		return localBackupSnapshotSummary{}, errors.New("native journal integrity mismatch")
	}
	previous, prevErr := localpush.VerifyPreviousInventoryJournal(ctx, a.configDir, a.grant)
	return localBackupSnapshotSummary{
		SourceID: sourceID, Revision: lpP002SourceRevision,
		ScannedFiles: stats.ScannedFiles, ScannedDirectories: stats.ScannedDirectories,
		ScannedBytes:        stats.ScannedBytes,
		HasVerifiedPrevious: prevErr == nil && previous.SnapshotName != snapshot.SnapshotName,
		Saved:               true, Complete: stats.Complete, MissingInferenceSafe: false,
	}, nil
}

func (a *lpP002IPCAdapter) CloudLocalBoundBackupDelta(ctx context.Context, sourceID uint64) (localBackupDeltaSummary, error) {
	if sourceID != lpP002SourceID || ctx == nil {
		return localBackupDeltaSummary{}, errors.New("wrong benchmark source")
	}
	result, err := localpush.StreamInventoryGenerationDelta(
		ctx, a.configDir, a.grant, localpush.DefaultInventoryBatchSize,
		func(batch []localpush.InventoryDeltaCandidate) error {
			if len(batch) == 0 || len(batch) > localpush.DefaultInventoryBatchSize {
				return errors.New("unbounded native delta IPC batch")
			}
			return ctx.Err()
		},
	)
	if err != nil || result.MissingInferenceSafe {
		return localBackupDeltaSummary{}, errors.New("native delta verification failed")
	}
	return localBackupDeltaSummary{
		SourceID: sourceID, Revision: lpP002SourceRevision,
		PreviousItems: result.Previous.Items, CurrentItems: result.Current.Items,
		Added: result.Added, Changed: result.Changed, MetadataStable: result.MetadataStable,
		AbsentCandidates: result.AbsentCandidates,
		Complete:         true, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}

func lpP002Rusage(t *testing.T) syscall.Rusage {
	t.Helper()
	var r syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func lpP002Ms(tv syscall.Timeval) float64 {
	return float64(tv.Sec)*1000 + float64(tv.Usec)/1000
}

func lpP002KernelWrite(t *testing.T) int64 {
	t.Helper()
	b, err := os.ReadFile("/proc/self/io")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "write_bytes:") {
			v, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "write_bytes:")), 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
	}
	t.Fatal("missing Linux kernel I/O counter")
	return 0
}

func lpP002Measure(t *testing.T, run func() error) lpP002Phase {
	t.Helper()
	before := lpP002Rusage(t)
	writes := lpP002KernelWrite(t)
	start := time.Now()
	if err := run(); err != nil {
		t.Fatal(err)
	}
	after := lpP002Rusage(t)
	return lpP002Phase{
		WallMS:           float64(time.Since(start).Microseconds()) / 1000,
		UserCPUMS:        lpP002Ms(after.Utime) - lpP002Ms(before.Utime),
		SystemCPUMS:      lpP002Ms(after.Stime) - lpP002Ms(before.Stime),
		KernelWriteBytes: lpP002KernelWrite(t) - writes,
		MaxRSSKiB:        after.Maxrss,
	}
}

func lpP002Payload(sample string, index int, changed bool) []byte {
	digest := sha256.Sum256([]byte(fmt.Sprintf("LP-P002/%s/%06d", sample, index)))
	n := lpP002PhysicalBytes
	if changed {
		n += 32
	}
	data := make([]byte, n)
	binary.LittleEndian.PutUint64(data[:8], uint64(index))
	for i := 8; i < n; i++ {
		data[i] = digest[i%len(digest)] ^ byte(i/len(digest))
	}
	return data
}

func lpP002Path(root string, index int) string {
	return filepath.Join(root,
		fmt.Sprintf("folder-%03d", index/lpP002FilesPerDirectory),
		fmt.Sprintf("%06d.bin", index),
	)
}

func lpP002Seed(root, sample string, count int) (string, error) {
	for i := 0; i < count/lpP002FilesPerDirectory; i++ {
		if err := os.Mkdir(filepath.Join(root, fmt.Sprintf("folder-%03d", i)), 0700); err != nil {
			return "", err
		}
	}
	unique := make(map[[32]byte]struct{}, count)
	source := sha256.New()
	for i := 0; i < count; i++ {
		payload := lpP002Payload(sample, i, false)
		hash := sha256.Sum256(payload)
		if _, duplicate := unique[hash]; duplicate {
			return "", fmt.Errorf("duplicate physical source SHA %d", i)
		}
		unique[hash] = struct{}{}
		if _, err := source.Write(hash[:]); err != nil {
			return "", err
		}
		if err := os.WriteFile(lpP002Path(root, i), payload, 0600); err != nil {
			return "", err
		}
	}
	runtime.GC()
	return hex.EncodeToString(source.Sum(nil)), nil
}

func lpP002VerifyPhysical(root, sample string, count int) (int64, int, error) {
	var allocated int64
	seen := make(map[[2]uint64]struct{}, count)
	var num int
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || !info.Mode().IsRegular() || info.Size() != lpP002PhysicalBytes ||
			st.Blocks == 0 || st.Nlink != 1 {
			return fmt.Errorf("non-independent/non-physical native file: %q", path)
		}
		key := [2]uint64{uint64(st.Dev), uint64(st.Ino)}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("hardlinked file in physical fixture: %q", path)
		}
		seen[key] = struct{}{}
		allocated += st.Blocks * 512
		num++
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	if num != count || len(seen) != count || allocated < int64(count*lpP002PhysicalBytes) {
		return 0, 0, fmt.Errorf("real independent originals=%d inode=%d allocated=%d", num, len(seen), allocated)
	}
	for _, i := range []int{0, 1, 101, count / 2, count - 2, count - 1} {
		got, err := os.ReadFile(lpP002Path(root, i))
		if err != nil {
			return 0, 0, err
		}
		want := lpP002Payload(sample, i, false)
		if sha256.Sum256(got) != sha256.Sum256(want) {
			return 0, 0, fmt.Errorf("original file content invalid at %d", i)
		}
	}
	return allocated, len(seen), nil
}

func lpP002Mutate(root, sample string, count int) error {
	n := count / 100
	for i := 0; i < n; i++ {
		if err := os.WriteFile(lpP002Path(root, i), lpP002Payload(sample, i, true), 0600); err != nil {
			return err
		}
	}
	removedStart := count / 2
	targetDir := filepath.Dir(lpP002Path(root, removedStart))
	for i := 0; i < n; i++ {
		if err := os.Remove(lpP002Path(root, removedStart+i)); err != nil {
			return err
		}
		payload := lpP002Payload(sample+"-new", i+count, false)
		dest := filepath.Join(targetDir, fmt.Sprintf("added-%06d.bin", i))
		if err := os.WriteFile(dest, payload, 0600); err != nil {
			return err
		}
	}
	oldTime := time.Now().UTC().Add(-time.Hour)
	return os.Chtimes(targetDir, oldTime, oldTime)
}

func lpP002Request(client *http.Client, base, token, method, path string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), method, base+path, nil)
	if err != nil {
		return 0, nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	r, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer r.Body.Close()
	b, err := io.ReadAll(io.LimitReader(r.Body, 8193))
	if err != nil {
		return 0, nil, err
	}
	if len(b) > 8192 {
		return 0, nil, errors.New("unexpectedly large private IPC response")
	}
	return r.StatusCode, b, nil
}

func lpP002NoPrivateData(payload []byte) error {
	for _, forbidden := range []string{
		"root_id", "root_fingerprint", "device_token", "ignore_rules",
		"local_path", "native_identity", "snapshot_name", "folder-",
		"secret", "item_path", "checkpoint",
	} {
		if strings.Contains(string(payload), forbidden) {
			return fmt.Errorf("IPC body leaked private %q", forbidden)
		}
	}
	return nil
}

func TestLP002DesktopAgentLoopbackIPCPhysical100KPerformance(t *testing.T) {
	if os.Getenv("XD_LP_P002_AGENT_IPC_PERF") != "1" {
		t.Skip("opt-in real Linux physical 100k Agent loopback HTTP performance")
	}
	sample := os.Getenv("XD_LP_P002_SAMPLE")
	if sample != "sample-1" && sample != "sample-2" && sample != "sample-3" {
		t.Fatal("explicit independent sample-1/2/3 required")
	}
	count := lpP002FileCountFull
	if os.Getenv("XD_LP_P002_SMOKE") == "1" {
		count = lpP002FileCountSmoke
	}
	root := filepath.Join(t.TempDir(), "real-native-source")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	data := lpP002Result{
		WorkloadID: "LP-P002-go-agent-ipc-native-100k-physical-inventory-delta",
		Sample:     sample, Files: count, Directories: count / lpP002FilesPerDirectory,
		LogicalBytes: int64(count * lpP002PhysicalBytes),
		ManagerKind:  "test-only IPC controller adapter to production localpush; NOT actual userconfig/Server-owner authentication",
	}
	data.Seed = lpP002Measure(t, func() error {
		var err error
		data.SeedSHA256, err = lpP002Seed(root, sample, count)
		return err
	})
	var err error
	data.AllocatedBytes, data.UniqueNativeInodes, err = lpP002VerifyPhysical(root, sample, count)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := localpush.PrepareRootGrant("https://test.invalid", "test-owner", lpP002SourceID, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	manager := &lpP002IPCAdapter{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		grant:                    grant, configDir: t.TempDir(),
	}
	loopback := httptest.NewServer(newDesktopIPCHandler(manager, "lp-p002-token", func() {}))
	defer loopback.Close()
	client := &http.Client{Timeout: 190 * time.Second}
	snapshotPath := "/v1/device-backups/local-snapshot?source_id=42"
	deltaPath := "/v1/device-backups/local-delta?source_id=42"
	for _, path := range []string{snapshotPath, deltaPath} {
		method := http.MethodPost
		if path == deltaPath {
			method = http.MethodGet
		}
		code, _, err := lpP002Request(client, loopback.URL, "", method, path)
		if err != nil || code != http.StatusUnauthorized {
			t.Fatalf("anonymous loopback IPC unexpectedly authorized: path=%s status=%d err=%v", path, code, err)
		}
	}
	var first, second localBackupSnapshotSummary
	data.FirstSnapshotHTTP = lpP002Measure(t, func() error {
		code, body, err := lpP002Request(client, loopback.URL, "lp-p002-token", http.MethodPost, snapshotPath)
		if err != nil || code != http.StatusOK {
			return fmt.Errorf("real loopback IPC first snapshot status=%d err=%v response=%s", code, err, body)
		}
		data.FirstResponseBytes = len(body)
		if err := lpP002NoPrivateData(body); err != nil {
			return err
		}
		return json.Unmarshal(body, &first)
	})
	data.Mutation = lpP002Measure(t, func() error {
		return lpP002Mutate(root, sample, count)
	})
	data.SecondSnapshotHTTP = lpP002Measure(t, func() error {
		code, body, err := lpP002Request(client, loopback.URL, "lp-p002-token", http.MethodPost, snapshotPath)
		if err != nil || code != http.StatusOK {
			return fmt.Errorf("real loopback IPC second snapshot status=%d err=%v response=%s", code, err, body)
		}
		data.SecondResponseBytes = len(body)
		if err := lpP002NoPrivateData(body); err != nil {
			return err
		}
		return json.Unmarshal(body, &second)
	})
	if first.SourceID != lpP002SourceID || second.SourceID != lpP002SourceID ||
		first.ScannedFiles != int64(count) || second.ScannedFiles != int64(count) ||
		first.ScannedDirectories != int64(data.Directories) ||
		second.ScannedDirectories != int64(data.Directories) ||
		first.ScannedBytes != int64(count*lpP002PhysicalBytes) ||
		second.ScannedBytes != int64(count*lpP002PhysicalBytes+count/100*32) ||
		first.HasVerifiedPrevious || !second.HasVerifiedPrevious ||
		!first.Saved || !second.Saved || !first.Complete || !second.Complete ||
		first.MissingInferenceSafe || second.MissingInferenceSafe {
		t.Fatalf("actual IPC snapshot data inaccurate: first=%+v second=%+v", first, second)
	}
	data.ScannedFirst, data.ScannedSecond = first.ScannedFiles, second.ScannedFiles
	var delta localBackupDeltaSummary
	data.DeltaHTTP = lpP002Measure(t, func() error {
		code, body, err := lpP002Request(client, loopback.URL, "lp-p002-token", http.MethodGet, deltaPath)
		if err != nil || code != http.StatusOK {
			return fmt.Errorf("real loopback IPC delta status=%d err=%v response=%s", code, err, body)
		}
		data.DeltaResponseBytes = len(body)
		if err := lpP002NoPrivateData(body); err != nil {
			return err
		}
		return json.Unmarshal(body, &delta)
	})
	data.DeltaAdded, data.DeltaChanged = delta.Added, delta.Changed
	data.DeltaStable, data.DeltaAbsent = delta.MetadataStable, delta.AbsentCandidates
	data.DeltaAuthoritative, data.MissingInferenceSafe = delta.Authoritative, delta.MissingInferenceSafe
	if !delta.Complete || delta.SourceID != lpP002SourceID || delta.Revision != lpP002SourceRevision ||
		delta.PreviousItems != int64(count+data.Directories) ||
		delta.CurrentItems != delta.PreviousItems ||
		delta.Added != int64(count/100) || delta.Changed != int64(count/100+1) ||
		delta.MetadataStable != int64(count+data.Directories-2*(count/100)-1) ||
		delta.AbsentCandidates != int64(count/100) ||
		delta.Authoritative || delta.MissingInferenceSafe {
		t.Fatalf("wrong or over-authoritative real IPC delta: %+v", delta)
	}
	data.MaxRSSKiB = lpP002Rusage(t).Maxrss
	if data.AllocatedBytes < int64(count*lpP002PhysicalBytes) ||
		data.UniqueNativeInodes != count || data.FirstResponseBytes > 4096 ||
		data.SecondResponseBytes > 4096 || data.DeltaResponseBytes > 4096 ||
		data.FirstSnapshotHTTP.WallMS > 180000 ||
		data.SecondSnapshotHTTP.WallMS > 180000 ||
		data.DeltaHTTP.WallMS > 180000 ||
		data.MaxRSSKiB > lpP002MaxRSSKiB {
		t.Fatalf("frozen native IPC physical/performance budget failed: %+v", data)
	}
	data.Passed = true
	jsonData, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("LP_P002_AUTHENTIC_LOOPBACK_PHYSICAL_100K %s", jsonData)
}
