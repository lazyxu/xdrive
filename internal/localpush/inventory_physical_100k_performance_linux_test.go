//go:build linux

package localpush

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
)

const (
	perfNativeFilesFull       = 100000
	perfNativeFilesSmoke      = 1000
	perfNativeFilesPerDir     = 1000
	perfNativeOriginalBytes   = 1024
	perfNativeOriginalBatch   = 500
	perfNativeRSSLimitKiB     = 524288
	perfNativeScanBudgetMS    = 180000.0
	perfNativeDeltaBudgetMS   = 180000.0
	perfNativeVerifyBudgetMS  = 120000.0
	perfNativeSeedingBudgetMS = 300000.0
)

type perfNativePhase struct {
	WallMS           float64 `json:"wall_ms"`
	UserCPUMS        float64 `json:"user_cpu_ms"`
	SystemCPUMS      float64 `json:"system_cpu_ms"`
	KernelWriteBytes int64   `json:"kernel_write_bytes"`
	MaxProcessRSSKiB int64   `json:"max_process_rss_kib"`
}

type perfNative100KResult struct {
	WorkloadID           string          `json:"workload_id"`
	Sample               string          `json:"sample"`
	Platform             string          `json:"platform"`
	OriginalFileCount    int             `json:"original_file_count"`
	DirectoryCount       int             `json:"physical_directory_count"`
	OriginalLogicalBytes int64           `json:"original_logical_bytes"`
	OriginalBlocksBytes  int64           `json:"original_allocated_blocks_bytes"`
	SeedSHA256           string          `json:"seed_content_sha256"`
	Gen1                 perfNativePhase `json:"scan_and_persist_generation_1"`
	Gen1Verify           perfNativePhase `json:"generation_1_verify"`
	Mutate               perfNativePhase `json:"mutate_second_physical_generation"`
	Gen2                 perfNativePhase `json:"scan_and_persist_generation_2"`
	Gen2Verify           perfNativePhase `json:"both_generations_verify"`
	Delta                perfNativePhase `json:"two_generation_delta"`
	Seed                 perfNativePhase `json:"source_seed"`
	Journal1Bytes        int64           `json:"journal_generation_1_bytes"`
	Journal2Bytes        int64           `json:"journal_generation_2_bytes"`
	ChangedFiles         int             `json:"changed_original_files"`
	AddedFiles           int             `json:"added_original_files"`
	AbsentCandidates     int64           `json:"absent_candidates_not_deletes"`
	MetadataStable       int64           `json:"metadata_stable_not_content_proof"`
	DeltaChanged         int64           `json:"delta_changed_including_directory"`
	DeltaAdded           int64           `json:"delta_added"`
	DeltaBatchCount      int             `json:"delta_callback_batches"`
	DeltaMaxBatch        int             `json:"delta_max_callback_batch"`
	DeltaEmitted         int64           `json:"delta_emitted_records"`
	MissingInferenceSafe bool            `json:"missing_inference_safe"`
	PeakRSSKiB           int64           `json:"process_peak_rss_kib"`
	Passed               bool            `json:"passed"`
	ProductionChanged    bool            `json:"production_changed"`
	Scope                string          `json:"scope"`
}

func perfNativeRusage(t *testing.T) syscall.Rusage {
	t.Helper()
	var r syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func perfNativeCPU(tv syscall.Timeval) float64 {
	return float64(tv.Sec)*1000 + float64(tv.Usec)/1000
}

func perfNativeWriteBytes(t *testing.T) int64 {
	t.Helper()
	body, err := os.ReadFile("/proc/self/io")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(line, "write_bytes:") {
			n, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "write_bytes:")), 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			return n
		}
	}
	t.Fatal("missing /proc/self/io kernel write_bytes")
	return 0
}

func perfNativeMeasure(t *testing.T, fn func() error) perfNativePhase {
	t.Helper()
	beforeWrite := perfNativeWriteBytes(t)
	beforeCPU := perfNativeRusage(t)
	start := time.Now()
	if err := fn(); err != nil {
		t.Fatal(err)
	}
	afterCPU := perfNativeRusage(t)
	return perfNativePhase{
		WallMS:           float64(time.Since(start).Microseconds()) / 1000,
		UserCPUMS:        perfNativeCPU(afterCPU.Utime) - perfNativeCPU(beforeCPU.Utime),
		SystemCPUMS:      perfNativeCPU(afterCPU.Stime) - perfNativeCPU(beforeCPU.Stime),
		KernelWriteBytes: perfNativeWriteBytes(t) - beforeWrite,
		MaxProcessRSSKiB: afterCPU.Maxrss,
	}
}

func perfNativePayload(sample string, index int) []byte {
	identity := sha256.Sum256([]byte(fmt.Sprintf("xdrive-localpush-100k-physical-v1/%s/%06d", sample, index)))
	body := make([]byte, perfNativeOriginalBytes)
	for i := range body {
		body[i] = identity[i%len(identity)] ^ byte(i/len(identity))
	}
	return body
}

func perfNativeFilePath(root string, index int) string {
	return filepath.Join(root, fmt.Sprintf("folder-%03d", index/perfNativeFilesPerDir), fmt.Sprintf("%06d.bin", index))
}

func perfNativeSeed(root, sample string, count int) (int64, string, error) {
	dirs := count / perfNativeFilesPerDir
	for i := 0; i < dirs; i++ {
		if err := os.Mkdir(filepath.Join(root, fmt.Sprintf("folder-%03d", i)), 0700); err != nil {
			return 0, "", err
		}
	}
	unique := make(map[[32]byte]struct{}, count)
	seedID := sha256.New()
	for i := 0; i < count; i++ {
		data := perfNativePayload(sample, i)
		hash := sha256.Sum256(data)
		if _, exists := unique[hash]; exists {
			return 0, "", fmt.Errorf("duplicate source physical byte identity %d", i)
		}
		unique[hash] = struct{}{}
		if _, err := seedID.Write(hash[:]); err != nil {
			return 0, "", err
		}
		if err := os.WriteFile(perfNativeFilePath(root, i), data, 0600); err != nil {
			return 0, "", err
		}
	}
	for i := 0; i < dirs; i++ {
		fd, err := os.Open(filepath.Join(root, fmt.Sprintf("folder-%03d", i)))
		if err != nil {
			return 0, "", err
		}
		err = fd.Sync()
		closeErr := fd.Close()
		if err != nil {
			return 0, "", err
		}
		if closeErr != nil {
			return 0, "", closeErr
		}
	}
	runtime.GC()
	return int64(count * perfNativeOriginalBytes), hex.EncodeToString(seedID.Sum(nil)), nil
}

func perfNativePhysicalAllocated(root, sample string, count int) (int64, error) {
	var allocated int64
	var files int
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 || !d.Type().IsRegular() {
			return fmt.Errorf("not an independent regular physical file: %q", path)
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || st.Blocks == 0 || info.Size() != perfNativeOriginalBytes {
			return fmt.Errorf("nonallocated or unexpectedly sized original file %q", path)
		}
		allocated += st.Blocks * 512
		files++
		return nil
	})
	if err != nil {
		return 0, err
	}
	if files != count || allocated < int64(count*perfNativeOriginalBytes) {
		return 0, fmt.Errorf("physical original files/allocated blocks: %d/%d want %d", files, allocated, count)
	}
	for _, index := range []int{0, 1, 101, count / 2, count - 2, count - 1} {
		actual, err := os.ReadFile(perfNativeFilePath(root, index))
		if err != nil {
			return 0, err
		}
		if !bytes.Equal(actual, perfNativePayload(sample, index)) {
			return 0, fmt.Errorf("sample original SHA contents mismatched at %d", index)
		}
	}
	return allocated, nil
}

func perfNativeSecondGeneration(root, sample string, count int) error {
	changed := count / 100
	for i := 0; i < changed; i++ {
		hash := sha256.Sum256([]byte(fmt.Sprintf("patch-%s-%06d", sample, i)))
		data := append(perfNativePayload(sample, i), hash[:]...)
		if err := os.WriteFile(perfNativeFilePath(root, i), data, 0600); err != nil {
			return err
		}
	}
	removeStart := count / 2
	dir := filepath.Dir(perfNativeFilePath(root, removeStart))
	for i := 0; i < changed; i++ {
		if err := os.Remove(perfNativeFilePath(root, removeStart+i)); err != nil {
			return err
		}
		hash := sha256.Sum256([]byte(fmt.Sprintf("added-%s-%06d", sample, i)))
		path := filepath.Join(dir, fmt.Sprintf("added-%06d.bin", i))
		body := make([]byte, perfNativeOriginalBytes)
		for j := range body {
			body[j] = hash[j%len(hash)] ^ byte(j/len(hash))
		}
		if err := os.WriteFile(path, body, 0600); err != nil {
			return err
		}
	}
	// For this named workload, one changed directory is deliberately made
	// visibly different so its metadata classification is reproducible.
	modified := time.Now().UTC().Add(-time.Hour)
	return os.Chtimes(dir, modified, modified)
}

func perfNativeJournalBytes(config string, grant RootGrant, snapshot InventoryJournalSnapshot) (int64, error) {
	dir, err := inventoryJournalDir(config, grant)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(filepath.Join(dir, snapshot.SnapshotName))
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func TestLocalPushNativeReal100KPhysicalInventoryAndDeltaPerformance(t *testing.T) {
	if os.Getenv("XD_LOCALPUSH_NATIVE_100K_PHYSICAL_PERF") != "1" {
		t.Skip("requires explicit native physical 100k performance opt-in")
	}
	sample := strings.TrimSpace(os.Getenv("XD_LOCALPUSH_NATIVE_100K_SAMPLE"))
	if sample != "sample-1" && sample != "sample-2" && sample != "sample-3" {
		t.Fatal("independent native sample-1..3 required")
	}
	count := perfNativeFilesFull
	if os.Getenv("XD_LOCALPUSH_NATIVE_100K_SMOKE") == "1" {
		count = perfNativeFilesSmoke
	}
	root := filepath.Join(t.TempDir(), "source")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	config := t.TempDir()
	result := perfNative100KResult{
		WorkloadID: "LP-P001-native-100k-real-physical-files-two-inventory-generations-and-delta",
		Sample:     sample, Platform: "Linux native file system + Go localpush, no Desktop IPC",
		OriginalFileCount: count, DirectoryCount: count / perfNativeFilesPerDir,
		ChangedFiles: count / 100, AddedFiles: count / 100,
		Scope: "100k physical distinct 1KiB .bin originals, verified RootGrant and native identity, complete CURRENT/PREVIOUS persisted journals and bounded advisory delta. NO actual Push upload, CAS or GUI/installed-PWA evidence.",
	}
	result.Seed = perfNativeMeasure(t, func() error {
		var err error
		result.OriginalLogicalBytes, result.SeedSHA256, err = perfNativeSeed(root, sample, count)
		return err
	})
	var err error
	result.OriginalBlocksBytes, err = perfNativePhysicalAllocated(root, sample, count)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://perf.local.invalid", "perf-account", 1, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	scanner := InventoryScanner{BatchSize: perfNativeOriginalBatch}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	var first, second InventoryJournalSnapshot
	var firstSummary, secondSummary InventorySummary
	result.Gen1 = perfNativeMeasure(t, func() error {
		first, firstSummary, err = ScanInventoryToJournal(ctx, config, grant, scanner)
		return err
	})
	result.Gen1Verify = perfNativeMeasure(t, func() error {
		snapshot, err := VerifyInventoryJournal(ctx, config, grant)
		if err != nil {
			return err
		}
		if snapshot.SnapshotSHA256 != first.SnapshotSHA256 {
			return fmt.Errorf("initial journal SHA is not persisted correctly")
		}
		return nil
	})
	result.Mutate = perfNativeMeasure(t, func() error {
		return perfNativeSecondGeneration(root, sample, count)
	})
	result.Gen2 = perfNativeMeasure(t, func() error {
		second, secondSummary, err = ScanInventoryToJournal(ctx, config, grant, scanner)
		return err
	})
	result.Gen2Verify = perfNativeMeasure(t, func() error {
		previous, err := VerifyPreviousInventoryJournal(ctx, config, grant)
		if err != nil {
			return err
		}
		current, err := VerifyInventoryJournal(ctx, config, grant)
		if err != nil {
			return err
		}
		if previous.SnapshotSHA256 != first.SnapshotSHA256 ||
			current.SnapshotSHA256 != second.SnapshotSHA256 {
			return fmt.Errorf("verified journals are not two independent preserved generations")
		}
		return nil
	})
	if firstSummary.ScannedFiles != int64(count) || secondSummary.ScannedFiles != int64(count) ||
		firstSummary.ScannedDirectories != int64(result.DirectoryCount) ||
		secondSummary.ScannedDirectories != int64(result.DirectoryCount) ||
		!firstSummary.Complete || !secondSummary.Complete ||
		firstSummary.MissingInferenceSafe || secondSummary.MissingInferenceSafe ||
		first.SnapshotSHA256 == second.SnapshotSHA256 {
		t.Fatalf("real native two-generation inventory correctness: first=%+v second=%+v", firstSummary, secondSummary)
	}
	if first.Items != int64(count+result.DirectoryCount) || second.Items != first.Items ||
		first.Bytes != int64(count*perfNativeOriginalBytes) ||
		second.Bytes != int64(count*perfNativeOriginalBytes+result.ChangedFiles*32) ||
		first.WithNativeIdentity != first.Items || second.WithNativeIdentity != second.Items {
		t.Fatalf("journal identity counts and logical physical bytes mismatch: first=%+v second=%+v", first, second)
	}
	result.Journal1Bytes, err = perfNativeJournalBytes(config, grant, first)
	if err != nil {
		t.Fatal(err)
	}
	result.Journal2Bytes, err = perfNativeJournalBytes(config, grant, second)
	if err != nil {
		t.Fatal(err)
	}
	if result.Journal1Bytes <= 0 || result.Journal2Bytes <= 0 {
		t.Fatal("real durable two-generation journal bytes missing")
	}
	var delta InventoryDeltaSummary
	result.Delta = perfNativeMeasure(t, func() error {
		var deltaErr error
		delta, deltaErr = StreamInventoryGenerationDelta(ctx, config, grant, perfNativeOriginalBatch,
			func(candidates []InventoryDeltaCandidate) error {
				result.DeltaBatchCount++
				if len(candidates) > result.DeltaMaxBatch {
					result.DeltaMaxBatch = len(candidates)
				}
				result.DeltaEmitted += int64(len(candidates))
				for _, c := range candidates {
					switch c.Kind {
					case InventoryDeltaAdded:
						if c.Current == nil || !strings.HasPrefix(filepath.Base(c.Current.Path), "added-") {
							return fmt.Errorf("not a genuine new file candidate")
						}
					case InventoryDeltaAbsent:
						if c.Previous == nil || c.Current != nil {
							return fmt.Errorf("unsafe/invalid absent candidate identity")
						}
					case InventoryDeltaStable:
						if c.Previous == nil || c.Current == nil {
							return fmt.Errorf("metadata stable lacks both authenticated generations")
						}
					case InventoryDeltaChanged:
						if c.Previous == nil || c.Current == nil {
							return fmt.Errorf("changed record lacks both generation identities")
						}
					default:
						return fmt.Errorf("unknown advisory delta classification %q", c.Kind)
					}
				}
				return nil
			})
		return deltaErr
	})
	result.AbsentCandidates = delta.AbsentCandidates
	result.MetadataStable = delta.MetadataStable
	result.DeltaChanged = delta.Changed
	result.DeltaAdded = delta.Added
	result.MissingInferenceSafe = delta.MissingInferenceSafe
	if delta.Added != int64(result.AddedFiles) ||
		delta.AbsentCandidates != int64(result.ChangedFiles) ||
		delta.Changed != int64(result.ChangedFiles+1) ||
		delta.MetadataStable != int64(count+result.DirectoryCount-2*result.ChangedFiles-1) ||
		result.DeltaEmitted != int64(count+result.DirectoryCount+result.ChangedFiles) ||
		result.DeltaMaxBatch > perfNativeOriginalBatch || result.DeltaMaxBatch == 0 ||
		delta.MissingInferenceSafe {
		t.Fatalf("false 100k native inventory/delta claims, delta=%+v maxBatch=%d emitted=%d",
			delta, result.DeltaMaxBatch, result.DeltaEmitted)
	}
	result.PeakRSSKiB = perfNativeRusage(t).Maxrss
	if result.Seed.WallMS > perfNativeSeedingBudgetMS ||
		result.Gen1.WallMS > perfNativeScanBudgetMS ||
		result.Gen2.WallMS > perfNativeScanBudgetMS ||
		result.Gen1Verify.WallMS > perfNativeVerifyBudgetMS ||
		result.Gen2Verify.WallMS > perfNativeVerifyBudgetMS ||
		result.Delta.WallMS > perfNativeDeltaBudgetMS ||
		result.PeakRSSKiB > perfNativeRSSLimitKiB {
		t.Fatalf("original workload exceeded frozen capacity/performance budget: %+v", result)
	}
	result.Passed = true
	machine, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("LOCALPUSH_NATIVE_PHYSICAL_100K_N3 %s", machine)
}
