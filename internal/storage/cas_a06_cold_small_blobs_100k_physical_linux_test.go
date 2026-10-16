//go:build linux

package storage

// CAS-A06 measures the same independent physical objects read from the
// existing immutable Local CAS and a TEST-ONLY pack from CAS-A05.
// Linux POSIX_FADV_DONTNEED is only an advisory cold-cache hint. This test
// makes no claims about guaranteed HDD cold-start or online Pack read speed.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

const (
	casA06TotalObjects = 100000
	casA06SmokeObjects = 1000
	casA06ColdQueries  = 2000
	casA06SmokeQueries = 200
)

type casA06ReadPhase struct {
	Requests          int     `json:"requests"`
	WallMS            float64 `json:"wall_ms"`
	UserCPUMS         float64 `json:"user_cpu_ms"`
	SystemCPUMS       float64 `json:"system_cpu_ms"`
	LinuxReadBytes    int64   `json:"linux_read_bytes"`
	LinuxRChar        int64   `json:"linux_rchar"`
	PageFaultsMinor   int64   `json:"page_faults_minor"`
	PageFaultsMajor   int64   `json:"page_faults_major"`
	PerRequestP50US   float64 `json:"per_request_p50_us"`
	PerRequestP95US   float64 `json:"per_request_p95_us"`
	PerRequestP99US   float64 `json:"per_request_p99_us"`
	PerRequestWorstUS float64 `json:"per_request_worst_us"`
	PeakProcessRSSKiB int64   `json:"peak_process_rss_kib"`
}

type casA06ReadArm struct {
	Cold casA06ReadPhase `json:"advisory_cold_read_2000"`
	Warm casA06ReadPhase `json:"warm_read_same_2000"`
}

type casA06Result struct {
	WorkloadID                 string        `json:"workload_id"`
	Sample                     int           `json:"sample"`
	OriginalCount              int           `json:"original_count"`
	UniqueSHA                  int           `json:"unique_sha256"`
	PayloadBytes               int           `json:"payload_bytes"`
	ColdQueries                int           `json:"cold_query_count"`
	SourceIdentitySHA          string        `json:"source_identity_sha256"`
	OriginalPhysicalBytes      int64         `json:"original_allocated_bytes"`
	PackPhysicalBytes          int64         `json:"pack_allocated_bytes"`
	OriginalWriteMS            float64       `json:"original_write_ms_excluded_from_read"`
	PackWriteMS                float64       `json:"pack_write_ms_excluded_from_read"`
	Order                      string        `json:"order"`
	Original                   casA06ReadArm `json:"production_local_cas"`
	OfflinePack                casA06ReadArm `json:"offline_pack"`
	BaselineEvictionsAttempted int           `json:"baseline_file_evictions_attempted"`
	PackEvictionsAttempted     int           `json:"pack_evictions_attempted"`
	FadviseSupported           bool          `json:"linux_fadvise_dontneed_supported"`
	RealReadIOObserved         bool          `json:"physical_read_io_observed"`
	NoSharedFiles              bool          `json:"distinct_storage_roots"`
	MatchedQueries             bool          `json:"matched_exact_bytes_and_ranges"`
	ProcessMaxRSSKiB           int64         `json:"process_max_rss_kib"`
	Passed                     bool          `json:"passed"`
	ProductionChanged          bool          `json:"production_changed"`
	Scope                      string        `json:"scope"`
}

func casA06Rusage(t *testing.T) syscall.Rusage {
	t.Helper()
	var out syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func casA06LinuxIO(t *testing.T, field string) int64 {
	t.Helper()
	content, err := os.ReadFile("/proc/self/io")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(content), "\n") {
		if strings.HasPrefix(line, field+":") {
			v, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, field+":")), 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
	}
	t.Fatalf("Linux /proc/self/io counter unavailable: %s", field)
	return 0
}

func casA06TimevalMS(t syscall.Timeval) float64 {
	return float64(t.Sec)*1000 + float64(t.Usec)/1000
}

func casA06Quantile(samples []float64, q float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	cpy := append([]float64(nil), samples...)
	sort.Float64s(cpy)
	idx := int(float64(len(cpy)-1) * q)
	return cpy[idx]
}

func casA06MeasureRead(t *testing.T, indices []int, read func(int) error) casA06ReadPhase {
	t.Helper()
	startUsage := casA06Rusage(t)
	startReadBytes := casA06LinuxIO(t, "read_bytes")
	startRChar := casA06LinuxIO(t, "rchar")
	start := time.Now()
	samples := make([]float64, 0, len(indices))
	for _, i := range indices {
		now := time.Now()
		if err := read(i); err != nil {
			t.Fatal(err)
		}
		samples = append(samples, float64(time.Since(now).Microseconds()))
	}
	totalMS := float64(time.Since(start).Microseconds()) / 1000
	end := casA06Rusage(t)
	return casA06ReadPhase{
		Requests: len(indices), WallMS: totalMS,
		UserCPUMS:         casA06TimevalMS(end.Utime) - casA06TimevalMS(startUsage.Utime),
		SystemCPUMS:       casA06TimevalMS(end.Stime) - casA06TimevalMS(startUsage.Stime),
		LinuxReadBytes:    casA06LinuxIO(t, "read_bytes") - startReadBytes,
		LinuxRChar:        casA06LinuxIO(t, "rchar") - startRChar,
		PageFaultsMinor:   end.Minflt - startUsage.Minflt,
		PageFaultsMajor:   end.Majflt - startUsage.Majflt,
		PerRequestP50US:   casA06Quantile(samples, .50),
		PerRequestP95US:   casA06Quantile(samples, .95),
		PerRequestP99US:   casA06Quantile(samples, .99),
		PerRequestWorstUS: casA06Quantile(samples, 1),
		PeakProcessRSSKiB: end.Maxrss,
	}
}

func casA06Indices(sample, count, queries int) ([]int, error) {
	list := make([]int, 0, queries)
	seen := make(map[int]bool, queries)
	for trial := 0; trial < queries; trial++ {
		idx := ((trial * 49157) + sample*73) % count
		if seen[idx] {
			return nil, fmt.Errorf("repeated random query %d", idx)
		}
		seen[idx] = true
		list = append(list, idx)
	}
	return list, nil
}

func casA06Populate(t *testing.T, originalRoot, packRoot string, sample, count int) (*Local, []casA05IndexRecord, *os.File, int64, int64, float64, float64) {
	t.Helper()
	store, err := NewLocal(originalRoot)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	for i := 0; i < count; i++ {
		key, err := casA05FullIdentityKey(sample, i)
		if err != nil {
			t.Fatal(err)
		}
		got, err := store.Put(context.Background(), key, bytes.NewReader(casA05ActualPayload(sample, i)))
		if err != nil || got != casA05PayloadSize {
			t.Fatalf("production CAS original #%d: %d, %v", i, got, err)
		}
	}
	originalMS := float64(time.Since(start).Microseconds()) / 1000
	originalBytes, nfiles, err := casA05Allocated(originalRoot)
	if err != nil || nfiles < count || originalBytes < int64(count*4096) {
		t.Fatalf("invalid original disk blocks and 100k inodes: %d/%d/%v", originalBytes, nfiles, err)
	}
	if err := os.Mkdir(packRoot, 0700); err != nil {
		t.Fatal(err)
	}
	start = time.Now()
	if err := casA05WritePack(packRoot, 1, sample, count, nil, nil); err != nil {
		t.Fatal(err)
	}
	packMS := float64(time.Since(start).Microseconds()) / 1000
	head, rows, file, err := casA05LoadPack(packRoot)
	if err != nil || head.Count != count || len(rows) != count {
		t.Fatalf("invalid offline actual Pack + persisted index: %+v/%d/%v", head, len(rows), err)
	}
	packBytes, packedFiles, err := casA05Allocated(packRoot)
	if err != nil || packedFiles != 3 || packBytes < int64(count*casA05PayloadSize) {
		t.Fatalf("invalid pack objects/bytes: %d/%d/%v", packBytes, packedFiles, err)
	}
	return store, rows, file, originalBytes, packBytes, originalMS, packMS
}

func casA06DropOriginal(t *testing.T, store *Local, sample int, indices []int) int {
	t.Helper()
	dropped := 0
	for _, i := range indices {
		key, err := casA05FullIdentityKey(sample, i)
		if err != nil {
			t.Fatal(err)
		}
		f, err := store.Open(context.Background(), key)
		if err != nil {
			t.Fatal(err)
		}
		err = unix.Fadvise(int(f.Fd()), 0, 0, unix.FADV_DONTNEED)
		closeErr := f.Close()
		if err != nil || closeErr != nil {
			t.Fatalf("Linux FADV_DONTNEED original failed: %v/%v", err, closeErr)
		}
		dropped++
	}
	return dropped
}

func casA06DropPack(t *testing.T, pack *os.File) int {
	t.Helper()
	if err := unix.Fadvise(int(pack.Fd()), 0, 0, unix.FADV_DONTNEED); err != nil {
		t.Fatalf("Linux FADV_DONTNEED packed original failed: %v", err)
	}
	return 1
}

func casA06ReadPack(pack *os.File, rows []casA05IndexRecord, sample, idx int) error {
	if idx < 0 || idx >= len(rows) {
		return errors.New("invalid offline pack offset")
	}
	return casA05PackVerifyRead(pack, rows[idx], casA05ActualPayload(sample, idx))
}

func casA06ReadOriginal(store *Local, sample, idx int) error {
	return casA05ReadOriginal(store, sample, idx)
}

func TestCASA06Physical100KOriginalCASVersusOfflinePackAdvisoryColdReads(t *testing.T) {
	if os.Getenv("XD_CAS_A06_COLD_READ_100K_PERF") != "1" {
		t.Skip("requires real physical Linux CAS cold-cache read opt-in")
	}
	ntext := os.Getenv("XD_CAS_A06_SAMPLE")
	if ntext != "sample-1" && ntext != "sample-2" && ntext != "sample-3" {
		t.Fatal("one independent sample-1..3 must be specified")
	}
	sample, _ := strconv.Atoi(strings.TrimPrefix(ntext, "sample-"))
	count, queries := casA06TotalObjects, casA06ColdQueries
	if os.Getenv("XD_CAS_A06_SMOKE") == "1" {
		count, queries = casA06SmokeObjects, casA06SmokeQueries
	}
	identity, err := casA05OrderedIdentity(sample, count)
	if err != nil || len(identity) != 64 {
		t.Fatalf("source SHA identity invalid: %v", err)
	}
	indices, err := casA06Indices(sample, count, queries)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	store, rows, pack, originalBytes, packBytes, origMS, packMS :=
		casA06Populate(t, root+"/original", root+"/pack", sample, count)
	defer pack.Close()
	result := casA06Result{
		WorkloadID: "CAS-A06-100k-distinct-1KiB-advisory-cold-warm-original-CAS-vs-offline-pack",
		Sample:     sample, OriginalCount: count, UniqueSHA: count,
		PayloadBytes: casA05PayloadSize, ColdQueries: queries,
		SourceIdentitySHA: identity, OriginalPhysicalBytes: originalBytes,
		PackPhysicalBytes: packBytes, OriginalWriteMS: origMS, PackWriteMS: packMS,
		FadviseSupported: true, NoSharedFiles: true, MatchedQueries: true,
		ProductionChanged: false,
		Scope:             "100k true 1KiB distinct physical Local.Put objects vs independent offline pack; Linux POSIX_FADV_DONTNEED advisory eviction before 2k SHA-correct byte+Range reads then repeated warm reads. Does not prove guaranteed disk coldness/HDD, online Pack, PostgreSQL Owner, Remote Range, Desktop/Web/PWA.",
	}
	runBaseline := func() {
		result.BaselineEvictionsAttempted = casA06DropOriginal(t, store, sample, indices)
		result.Original.Cold = casA06MeasureRead(t, indices, func(i int) error { return casA06ReadOriginal(store, sample, i) })
		result.Original.Warm = casA06MeasureRead(t, indices, func(i int) error { return casA06ReadOriginal(store, sample, i) })
	}
	runPack := func() {
		result.PackEvictionsAttempted = casA06DropPack(t, pack)
		result.OfflinePack.Cold = casA06MeasureRead(t, indices, func(i int) error { return casA06ReadPack(pack, rows, sample, i) })
		result.OfflinePack.Warm = casA06MeasureRead(t, indices, func(i int) error { return casA06ReadPack(pack, rows, sample, i) })
	}
	if sample%2 == 1 {
		result.Order = "production_first"
		runBaseline()
		runPack()
	} else {
		result.Order = "offline_pack_first"
		runPack()
		runBaseline()
	}
	result.ProcessMaxRSSKiB = casA06Rusage(t).Maxrss
	result.RealReadIOObserved = result.Original.Cold.LinuxReadBytes > 0 && result.OfflinePack.Cold.LinuxReadBytes > 0
	if count == casA06TotalObjects {
		if result.BaselineEvictionsAttempted != queries || result.PackEvictionsAttempted != 1 ||
			result.OriginalPhysicalBytes < 409600000 ||
			result.PackPhysicalBytes*100 >= result.OriginalPhysicalBytes*35 ||
			result.ProcessMaxRSSKiB > 524288 {
			t.Fatalf("invalid physical original/offline Pack resources: %+v", result)
		}
	}
	if !result.RealReadIOObserved {
		t.Fatalf("INVALID ENVIRONMENT: FADV_DONTNEED hints did not produce independently measurable Linux physical read IO: %+v", result)
	}
	for _, phase := range []casA06ReadPhase{
		result.Original.Cold, result.Original.Warm,
		result.OfflinePack.Cold, result.OfflinePack.Warm,
	} {
		if phase.Requests != queries || phase.WallMS <= 0 || phase.WallMS > 180000 ||
			phase.PerRequestP50US < 0 || phase.PerRequestP95US < phase.PerRequestP50US ||
			phase.PerRequestP99US < phase.PerRequestP95US ||
			phase.PeakProcessRSSKiB > 524288 {
			t.Fatalf("cold/warm read original correctness/resource budget failed: %+v", phase)
		}
	}
	result.Passed = true
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_A06_REAL_100K_COLD_READS %s", payload)
}
