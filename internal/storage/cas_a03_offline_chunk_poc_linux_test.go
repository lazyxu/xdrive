//go:build linux

package storage

// CAS-A03-d2 is an opt-in, offline, benchmark-only comparison. It does not
// change the production Local, database FileVersion, GC or transfer paths.
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
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"testing"
	"time"
)

const (
	casA03D2RangeSize         = 64 << 10
	casA03D2MaxExtraAllocated = 10 << 20
)

type casA03D2Manifest struct {
	FullSHA    string   `json:"full_sha"`
	Length     int64    `json:"length"`
	ChunkBytes int64    `json:"chunk_bytes"`
	Blocks     []string `json:"blocks"`
}

type casA03D2Phase struct {
	OriginalPutMs                  float64 `json:"original_put_ms"`
	ChangedPutMs                   float64 `json:"changed_put_ms"`
	FirstPhysicalBytes             int64   `json:"first_physical_bytes"`
	BothPhysicalBytes              int64   `json:"both_physical_bytes"`
	ChangedAdditionalPhysicalBytes int64   `json:"changed_additional_physical_bytes"`
	KernelWriteBytes               uint64  `json:"kernel_write_bytes"`
	WriteUserCPUMs                 float64 `json:"write_user_cpu_ms"`
	VerifyBothSHAms                float64 `json:"verify_both_sha_ms"`
	RangeQueries                   int     `json:"range_queries"`
	Range64KiBMs                   float64 `json:"range_64kib_ms"`
	BMaterializeAndVerifyMs        float64 `json:"b_materialize_and_verify_ms,omitempty"`
	AfterDeleteBBytes              int64   `json:"after_delete_b_bytes"`
	AfterDeleteAllBytes            int64   `json:"after_delete_all_bytes"`
	UniqueBlocks                   int     `json:"unique_blocks,omitempty"`
	SharedBlocks                   int     `json:"shared_blocks,omitempty"`
}

type casA03D2Result struct {
	Workload            string        `json:"workload"`
	Sample              int           `json:"sample"`
	Order               string        `json:"order"`
	SourceBytes         int64         `json:"source_bytes"`
	PatchedBytes        int64         `json:"patched_bytes"`
	HashA               string        `json:"hash_a"`
	HashB               string        `json:"hash_b"`
	Baseline            casA03D2Phase `json:"baseline_local_put"`
	Candidate           casA03D2Phase `json:"candidate_offline_fixed_8mib"`
	ProcessMaxRSSKiB    int64         `json:"process_max_rss_kib"`
	ExtraBytesSaved     int64         `json:"actual_additional_physical_bytes_saved"`
	CandidateExtraRatio float64       `json:"candidate_extra_to_baseline_ratio"`
	Passed              bool          `json:"passed"`
	Scope               string        `json:"scope"`
}

func casA03D2CPU(t *testing.T) syscall.Rusage {
	t.Helper()
	var r syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &r); err != nil {
		t.Fatal(err)
	}
	return r
}
func casA03D2UserMs(start, end syscall.Rusage) float64 {
	return float64(end.Utime.Sec-start.Utime.Sec)*1000 + float64(end.Utime.Usec-start.Utime.Usec)/1000
}
func casA03D2WriteBytes(t *testing.T, before, after map[string]uint64) uint64 {
	t.Helper()
	if before == nil || after == nil || after["write_bytes"] < before["write_bytes"] {
		t.Fatal("invalid Linux /proc/self/io counters: harness invalid, not production RED")
	}
	return after["write_bytes"] - before["write_bytes"]
}
func casA03D2Allocated(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, fmt.Errorf("missing Linux stat on %s", path)
	}
	return st.Blocks * 512, nil
}
func casA03D2TreePhysical(root string) (int64, int, error) {
	var bytesTotal int64
	var files int
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected nonregular object %q", path)
		}
		physical, e := casA03D2Allocated(path)
		if e != nil {
			return e
		}
		bytesTotal += physical
		files++
		return nil
	})
	return bytesTotal, files, err
}
func casA03D2Ranges() []int64 {
	limit := casA03FileBytes - casA03D2RangeSize
	a := []int64{0, 1 << 20, (8 << 20) - 32768, 8 << 20, casA03PatchStart - 32768,
		casA03PatchStart, casA03PatchStart + (1 << 19), casA03PatchStart + casA03PatchBytes - 32768,
		casA03PatchStart + casA03PatchBytes, limit}
	for i := int64(0); i < 10; i++ {
		off := ((i*43+7)*casA03ChunkBytes + casA03ChunkBytes - 32768) % limit
		a = append(a, off)
	}
	return a
}

// Independent random-offset AES-CTR oracle; unlike the sequential source reader,
// this oracle does not regenerate all preceding gigabytes for each range.
func casA03D2OracleRange(sample int, changed bool, off int64, length int) []byte {
	if off < 0 || off+int64(length) > casA03FileBytes {
		panic("out of range oracle")
	}
	seed := sha256.Sum256([]byte(fmt.Sprintf("xdrive-cas-a03-high-entropy-sample-%d", sample)))
	block, e := aes.NewCipher(seed[:])
	if e != nil {
		panic(e)
	}
	var iv [aes.BlockSize]byte
	binary.BigEndian.PutUint64(iv[8:], uint64(off/16))
	skip := int(off % 16)
	data := make([]byte, skip+length)
	cipher.NewCTR(block, iv[:]).XORKeyStream(data, data)
	out := data[skip:]
	if changed {
		for i := range out {
			absolute := off + int64(i)
			if absolute >= casA03PatchStart && absolute < casA03PatchStart+casA03PatchBytes {
				out[i] ^= 0xa5
			}
		}
	}
	return out
}
func casA03D2VerifyRanges(sample int, changed bool, readAt func([]byte, int64) (int, error)) error {
	buf := make([]byte, casA03D2RangeSize)
	for _, off := range casA03D2Ranges() {
		n, e := readAt(buf, off)
		if e != nil || n != len(buf) {
			return fmt.Errorf("Range offset %d n=%d err=%v", off, n, e)
		}
		if !bytes.Equal(buf, casA03D2OracleRange(sample, changed, off, len(buf))) {
			return fmt.Errorf("random independent AES-CTR Range mismatch at offset=%d modified=%v", off, changed)
		}
	}
	return nil
}
func casA03D2FullRanges(path string, sample int, changed bool) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return casA03D2VerifyRanges(sample, changed, f.ReadAt)
}

func casA03D2Baseline(t *testing.T, root string, sample int, shaA, shaB string) casA03D2Phase {
	t.Helper()
	s, e := NewLocal(root)
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	keyA, e := ContentAddressedKey(shaA)
	if e != nil {
		t.Fatal(e)
	}
	keyB, e := ContentAddressedKey(shaB)
	if e != nil {
		t.Fatal(e)
	}
	before := casA03ProcessBytes()
	cpuBefore := casA03D2CPU(t)
	start := time.Now()
	n, e := s.Put(ctx, keyA, newCASA03ContentReader(sample, false))
	if e != nil || n != casA03FileBytes {
		t.Fatalf("baseline A Put n=%d: %v", n, e)
	}
	firstMs := float64(time.Since(start).Microseconds()) / 1000
	first, e := casA03Allocated(root, keyA)
	if e != nil {
		t.Fatal(e)
	}
	start = time.Now()
	n, e = s.Put(ctx, keyB, newCASA03ContentReader(sample, true))
	if e != nil || n != casA03FileBytes {
		t.Fatalf("baseline B Put n=%d: %v", n, e)
	}
	bMs := float64(time.Since(start).Microseconds()) / 1000
	cpuAfter := casA03D2CPU(t)
	write := casA03D2WriteBytes(t, before, casA03ProcessBytes())
	aBytes, e := casA03Allocated(root, keyA)
	if e != nil {
		t.Fatal(e)
	}
	bBytes, e := casA03Allocated(root, keyB)
	if e != nil {
		t.Fatal(e)
	}
	phase := casA03D2Phase{OriginalPutMs: firstMs, ChangedPutMs: bMs, FirstPhysicalBytes: first,
		BothPhysicalBytes: aBytes + bBytes, ChangedAdditionalPhysicalBytes: bBytes,
		KernelWriteBytes: write, WriteUserCPUMs: casA03D2UserMs(cpuBefore, cpuAfter)}
	start = time.Now()
	diff, shared, e := casA03VerifyPair(ctx, s, keyA, keyB)
	if e != nil || diff != casA03PatchBytes || shared != 511 {
		t.Fatalf("baseline full restored SHA/diff=%d shared=%d err=%v", diff, shared, e)
	}
	phase.VerifyBothSHAms = float64(time.Since(start).Microseconds()) / 1000
	start = time.Now()
	for _, input := range []struct {
		key     string
		changed bool
	}{{keyA, false}, {keyB, true}} {
		if e := casA03D2FullRanges(filepath.Join(root, filepath.FromSlash(input.key)), sample, input.changed); e != nil {
			t.Fatal(e)
		}
	}
	phase.Range64KiBMs = float64(time.Since(start).Microseconds()) / 1000
	phase.RangeQueries = 2 * len(casA03D2Ranges())
	if e := s.Delete(ctx, keyB); e != nil {
		t.Fatal(e)
	}
	probe, e := s.Open(ctx, keyA)
	if e != nil {
		t.Fatalf("baseline A disappeared when B deleted: %v", e)
	}
	if e := probe.Close(); e != nil {
		t.Fatal(e)
	}
	phase.AfterDeleteBBytes, e = casA03Allocated(root, keyA)
	if e != nil {
		t.Fatal(e)
	}
	if e := s.Delete(ctx, keyA); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Open(ctx, keyA); !os.IsNotExist(e) {
		t.Fatalf("baseline original remains after final delete: %v", e)
	}
	phase.AfterDeleteAllBytes = 0
	if phase.BothPhysicalBytes < 2*casA03FileBytes || phase.AfterDeleteBBytes < casA03FileBytes || write < 2*uint64(casA03FileBytes) {
		t.Fatalf("invalid baseline real physical full file CAS: %+v", phase)
	}
	return phase
}

func casA03D2ChunkPath(root, sha string) string { return filepath.Join(root, "chunks", sha[:2], sha) }
func casA03D2ManifestPath(root, which string) string {
	return filepath.Join(root, "manifest-"+which+".json")
}
func casA03D2ReadManifest(root, which string) (casA03D2Manifest, error) {
	var m casA03D2Manifest
	raw, e := os.ReadFile(casA03D2ManifestPath(root, which))
	if e != nil {
		return m, e
	}
	if e = json.Unmarshal(raw, &m); e != nil {
		return m, e
	}
	if m.Length != casA03FileBytes || m.ChunkBytes != casA03ChunkBytes || len(m.Blocks) != int(casA03FileBytes/casA03ChunkBytes) || len(m.FullSHA) != 64 {
		return m, fmt.Errorf("invalid offline manifest for %s", which)
	}
	return m, nil
}
func casA03D2WriteManifest(root, which string, m casA03D2Manifest) error {
	raw, e := json.Marshal(m)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(root, ".manifest-*.tmp")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(raw); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), casA03D2ManifestPath(root, which)); e != nil {
		return e
	}
	dir, e := os.Open(root)
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}

// Materialize immutable hash-named independent 8MiB block objects with actual fsync.
// No production manifest or safety contract is adopted by this benchmark.
func casA03D2WriteChunk(path string, data []byte) (bool, error) {
	if info, e := os.Stat(path); e == nil {
		if info.Size() != int64(len(data)) {
			return false, fmt.Errorf("existing block wrong length %s", path)
		}
		return false, nil
	} else if !os.IsNotExist(e) {
		return false, e
	}
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return false, e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".chunk-*.tmp")
	if e != nil {
		return false, e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(data); e != nil {
		f.Close()
		return false, e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return false, e
	}
	if e = f.Close(); e != nil {
		return false, e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return false, e
	}
	return true, nil
}
func casA03D2WriteVersion(root string, sample int, which string, changed bool, expectedSHA string) (int, error) {
	r := newCASA03ContentReader(sample, changed)
	data := make([]byte, casA03ChunkBytes)
	manifest := casA03D2Manifest{FullSHA: expectedSHA, Length: casA03FileBytes, ChunkBytes: casA03ChunkBytes,
		Blocks: make([]string, 0, casA03FileBytes/casA03ChunkBytes)}
	created := 0
	for index := 0; index < int(casA03FileBytes/casA03ChunkBytes); index++ {
		n, e := io.ReadFull(r, data)
		if e != nil || n != len(data) {
			return 0, fmt.Errorf("source interrupted index %d n=%d: %v", index, n, e)
		}
		hash := sha256.Sum256(data)
		hexKey := hex.EncodeToString(hash[:])
		fresh, e := casA03D2WriteChunk(casA03D2ChunkPath(root, hexKey), data)
		if e != nil {
			return 0, e
		}
		if fresh {
			created++
		}
		manifest.Blocks = append(manifest.Blocks, hexKey)
	}
	var extra [1]byte
	if n, e := r.Read(extra[:]); n != 0 || e != io.EOF {
		return 0, fmt.Errorf("source exceeds 4GiB: n=%d err=%v", n, e)
	}
	return created, casA03D2WriteManifest(root, which, manifest)
}
func casA03D2Stream(root string, m casA03D2Manifest, dst io.Writer) error {
	buf := make([]byte, casA03ChunkBytes)
	full := sha256.New()
	for index, key := range m.Blocks {
		f, e := os.Open(casA03D2ChunkPath(root, key))
		if e != nil {
			return e
		}
		n, e := io.ReadFull(f, buf)
		if e != nil || n != len(buf) {
			f.Close()
			return fmt.Errorf("corrupt truncated block %d: %v", index, e)
		}
		var eof [1]byte
		if n, e := f.Read(eof[:]); n != 0 || e != io.EOF {
			f.Close()
			return fmt.Errorf("extra block content at %d", index)
		}
		if e := f.Close(); e != nil {
			return e
		}
		sha := sha256.Sum256(buf)
		if hex.EncodeToString(sha[:]) != key {
			return fmt.Errorf("block SHA mismatch index %d", index)
		}
		full.Write(buf)
		if dst != nil {
			if _, e := dst.Write(buf); e != nil {
				return e
			}
		}
	}
	if hex.EncodeToString(full.Sum(nil)) != m.FullSHA {
		return fmt.Errorf("full 4GiB SHA mismatch")
	}
	return nil
}
func casA03D2BlockReadAt(root string, m casA03D2Manifest, buf []byte, off int64) (int, error) {
	if off < 0 || off >= m.Length {
		return 0, io.EOF
	}
	total := 0
	for total < len(buf) && off < m.Length {
		chunk := int(off / casA03ChunkBytes)
		inChunk := off % casA03ChunkBytes
		n := min(len(buf)-total, int(casA03ChunkBytes-inChunk))
		f, e := os.Open(casA03D2ChunkPath(root, m.Blocks[chunk]))
		if e != nil {
			return total, e
		}
		read, err := f.ReadAt(buf[total:total+n], inChunk)
		ce := f.Close()
		if err != nil {
			return total + read, err
		}
		if ce != nil {
			return total + read, ce
		}
		if read != n {
			return total + read, io.ErrUnexpectedEOF
		}
		total += read
		off += int64(read)
	}
	if total < len(buf) {
		return total, io.EOF
	}
	return total, nil
}
func casA03D2Sweep(root string, keep []casA03D2Manifest) (int, error) {
	live := make(map[string]bool)
	for _, m := range keep {
		for _, sha := range m.Blocks {
			live[sha] = true
		}
	}
	gone := 0
	err := filepath.WalkDir(filepath.Join(root, "chunks"), func(path string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected block type %s", path)
		}
		if !live[filepath.Base(path)] {
			if e := os.Remove(path); e != nil {
				return e
			}
			gone++
		}
		return nil
	})
	return gone, err
}
func casA03D2Candidate(t *testing.T, root string, sample int, shaA, shaB string) casA03D2Phase {
	t.Helper()
	if e := os.MkdirAll(filepath.Join(root, "chunks"), 0755); e != nil {
		t.Fatal(e)
	}
	before := casA03ProcessBytes()
	cpuBefore := casA03D2CPU(t)
	start := time.Now()
	freshA, e := casA03D2WriteVersion(root, sample, "A", false, shaA)
	if e != nil {
		t.Fatal(e)
	}
	msA := float64(time.Since(start).Microseconds()) / 1000
	onlyA, filesA, e := casA03D2TreePhysical(root)
	if e != nil {
		t.Fatal(e)
	}
	start = time.Now()
	freshB, e := casA03D2WriteVersion(root, sample, "B", true, shaB)
	if e != nil {
		t.Fatal(e)
	}
	msB := float64(time.Since(start).Microseconds()) / 1000
	cpuAfter := casA03D2CPU(t)
	write := casA03D2WriteBytes(t, before, casA03ProcessBytes())
	both, filesBoth, e := casA03D2TreePhysical(root)
	if e != nil {
		t.Fatal(e)
	}
	phase := casA03D2Phase{OriginalPutMs: msA, ChangedPutMs: msB, FirstPhysicalBytes: onlyA,
		BothPhysicalBytes: both, ChangedAdditionalPhysicalBytes: both - onlyA,
		KernelWriteBytes: write, WriteUserCPUMs: casA03D2UserMs(cpuBefore, cpuAfter),
		UniqueBlocks: freshA + freshB, SharedBlocks: int(casA03FileBytes/casA03ChunkBytes) - freshB}
	// Manifest A/B must have 512 blocks; physically only B's one edited block is new.
	if freshA != 512 || freshB != 1 || filesA != 513 || filesBoth != 515 {
		t.Fatalf("offline block identities: freshA=%d freshB=%d filesA=%d filesBoth=%d", freshA, freshB, filesA, filesBoth)
	}
	a, e := casA03D2ReadManifest(root, "A")
	if e != nil {
		t.Fatal(e)
	}
	b, e := casA03D2ReadManifest(root, "B")
	if e != nil {
		t.Fatal(e)
	}
	if a.FullSHA != shaA || b.FullSHA != shaB {
		t.Fatal("manifest versions missing logical 4GiB SHA")
	}
	start = time.Now()
	if e := casA03D2Stream(root, a, nil); e != nil {
		t.Fatalf("A SHA stream: %v", e)
	}
	if e := casA03D2Stream(root, b, nil); e != nil {
		t.Fatalf("B SHA stream: %v", e)
	}
	phase.VerifyBothSHAms = float64(time.Since(start).Microseconds()) / 1000
	start = time.Now()
	if e := casA03D2VerifyRanges(sample, false, func(p []byte, o int64) (int, error) { return casA03D2BlockReadAt(root, a, p, o) }); e != nil {
		t.Fatal(e)
	}
	if e := casA03D2VerifyRanges(sample, true, func(p []byte, o int64) (int, error) { return casA03D2BlockReadAt(root, b, p, o) }); e != nil {
		t.Fatal(e)
	}
	phase.Range64KiBMs = float64(time.Since(start).Microseconds()) / 1000
	phase.RangeQueries = 2 * len(casA03D2Ranges())
	// Materialize a *real* full changed 4GiB version, fsync, close and read
	// it back for SHA proof. Exclude this optional restore output from stored
	// version byte accounting; measure its temporary write cost separately.
	start = time.Now()
	output := filepath.Join(root, "reconstructed-changed-B.bin")
	f, e := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	if e := casA03D2Stream(root, b, f); e != nil {
		f.Close()
		t.Fatalf("offline materialize: %v", e)
	}
	if e := f.Sync(); e != nil {
		f.Close()
		t.Fatal(e)
	}
	if e := f.Close(); e != nil {
		t.Fatal(e)
	}
	info, e := os.Stat(output)
	if e != nil {
		t.Fatal(e)
	}
	if info.Size() != casA03FileBytes {
		t.Fatalf("restored size=%d", info.Size())
	}
	restoredPhysical, e := casA03D2Allocated(output)
	if e != nil {
		t.Fatal(e)
	}
	if restoredPhysical < casA03FileBytes {
		t.Fatal("full B restored output is sparse")
	}
	restored, e := os.Open(output)
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.New()
	count, e := io.CopyBuffer(hash, restored, make([]byte, 1<<20))
	ce := restored.Close()
	if e != nil || ce != nil || count != casA03FileBytes || hex.EncodeToString(hash.Sum(nil)) != shaB {
		t.Fatalf("full restored physical 4GiB B failed n=%d read=%v close=%v", count, e, ce)
	}
	phase.BMaterializeAndVerifyMs = float64(time.Since(start).Microseconds()) / 1000
	if e := os.Remove(output); e != nil {
		t.Fatal(e)
	}
	// Offline reference sweep is *not* the actual database/owner/GC path.
	if e := os.Remove(casA03D2ManifestPath(root, "B")); e != nil {
		t.Fatal(e)
	}
	n, e := casA03D2Sweep(root, []casA03D2Manifest{a})
	if e != nil || n != 1 {
		t.Fatalf("changed-only block GC n=%d: %v", n, e)
	}
	phase.AfterDeleteBBytes, _, e = casA03D2TreePhysical(root)
	if e != nil {
		t.Fatal(e)
	}
	if e := casA03D2Stream(root, a, nil); e != nil {
		t.Fatalf("A must survive B deletion: %v", e)
	}
	if e := os.Remove(casA03D2ManifestPath(root, "A")); e != nil {
		t.Fatal(e)
	}
	n, e = casA03D2Sweep(root, nil)
	if e != nil || n != 512 {
		t.Fatalf("last-reference GC n=%d: %v", n, e)
	}
	phase.AfterDeleteAllBytes, n, e = casA03D2TreePhysical(root)
	if e != nil || n != 0 || phase.AfterDeleteAllBytes != 0 {
		t.Fatalf("offline final physical sweep bytes=%d files=%d err=%v", phase.AfterDeleteAllBytes, n, e)
	}
	return phase
}
func TestCASA03OfflinePhysicalFixedChunksVersusLocal4GiBSmallEdit(t *testing.T) {
	if os.Getenv("XD_CAS_A03_D2_OFFLINE_CHUNK_PERF") != "1" {
		t.Skip("opt-in 4GiB physical local CAS vs offline block PoC")
	}
	sample, e := strconv.Atoi(os.Getenv("XD_CAS_A03_SAMPLE"))
	if e != nil || sample < 1 || sample > 3 {
		t.Fatal("sample must be 1..3")
	}
	root := t.TempDir()
	var fs syscall.Statfs_t
	if e = syscall.Statfs(root, &fs); e != nil {
		t.Fatal(e)
	}
	free := uint64(fs.Bavail) * uint64(fs.Bsize)
	if free < 11<<30 {
		t.Fatalf("real 4GiB A/B inadequate free capacity %dB <11GiB: Invalid harness, not product RED", free)
	}
	digestA, e := casA03PreHash(sample, false)
	if e != nil {
		t.Fatal(e)
	}
	digestB, e := casA03PreHash(sample, true)
	if e != nil {
		t.Fatal(e)
	}
	if digestA == digestB {
		t.Fatal("same logical SHA for different versions")
	}
	var original, prototype casA03D2Phase
	order := "fullfile_then_chunk"
	if sample%2 == 0 {
		order = "chunk_then_fullfile"
		prototype = casA03D2Candidate(t, filepath.Join(root, "offline-8mib"), sample, digestA, digestB)
		original = casA03D2Baseline(t, filepath.Join(root, "fullfile"), sample, digestA, digestB)
	} else {
		original = casA03D2Baseline(t, filepath.Join(root, "fullfile"), sample, digestA, digestB)
		prototype = casA03D2Candidate(t, filepath.Join(root, "offline-8mib"), sample, digestA, digestB)
	}
	var resource syscall.Rusage
	if e = syscall.Getrusage(syscall.RUSAGE_SELF, &resource); e != nil {
		t.Fatal(e)
	}
	saved := original.ChangedAdditionalPhysicalBytes - prototype.ChangedAdditionalPhysicalBytes
	result := casA03D2Result{Workload: "CAS-A03/S001-d2/REAL-4GIB-SMALL-EDIT-FULL-CAS-VS-OFFLINE-8MIB-BLOCKS", Sample: sample, Order: order,
		SourceBytes: casA03FileBytes, PatchedBytes: casA03PatchBytes, HashA: digestA, HashB: digestB,
		Baseline: original, Candidate: prototype, ProcessMaxRSSKiB: resource.Maxrss, ExtraBytesSaved: saved,
		CandidateExtraRatio: float64(prototype.ChangedAdditionalPhysicalBytes) / float64(original.ChangedAdditionalPhysicalBytes),
		Passed:              true, Scope: "Same real generated 4GiB SHA original and 1MiB-edited B, source accurate: production storage.Local.Put vs isolated fixed 8MiB offline content hash blocks. No online CAS chunking, CDC, owner auth, PostgreSQL FileVersion, HTTP upload, Client/PWA or production GC."}
	blob, e := json.Marshal(result)
	if e != nil {
		t.Fatal(e)
	}
	t.Log("CAS_A03_D2_OFFLINE_REAL_4GIB " + string(blob))
	if original.BothPhysicalBytes < 2*casA03FileBytes || original.ChangedAdditionalPhysicalBytes < casA03FileBytes ||
		prototype.FirstPhysicalBytes < casA03FileBytes || prototype.ChangedAdditionalPhysicalBytes <= casA03ChunkBytes ||
		prototype.ChangedAdditionalPhysicalBytes > casA03D2MaxExtraAllocated ||
		prototype.BothPhysicalBytes > original.BothPhysicalBytes*6/10 ||
		prototype.KernelWriteBytes > original.KernelWriteBytes*6/10 ||
		prototype.UniqueBlocks != 513 || prototype.SharedBlocks != 511 ||
		resource.Maxrss > 512*1024 || saved <= 0 ||
		original.RangeQueries != 40 || prototype.RangeQueries != 40 ||
		original.AfterDeleteAllBytes != 0 || prototype.AfterDeleteAllBytes != 0 ||
		original.OriginalPutMs > 360000 || original.ChangedPutMs > 360000 ||
		prototype.OriginalPutMs > 360000 || prototype.ChangedPutMs > 360000 ||
		prototype.BMaterializeAndVerifyMs > 180000 {
		t.Fatalf("frozen benchmark conditions/physical budget RED or harness invalid: %s", blob)
	}
	runtime.KeepAlive(root)
}
