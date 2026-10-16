//go:build linux

package storage

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

const (
	casA03FileBytes  int64 = 4 << 30
	casA03PatchBytes int64 = 1 << 20
	casA03ChunkBytes int64 = 8 << 20
	casA03PatchStart int64 = (casA03FileBytes / 2) + (2 << 20)
)

type casA03ContentReader struct {
	stream   cipher.Stream
	position int64
	changed  bool
}

func newCASA03ContentReader(sample int, changed bool) io.Reader {
	seed := sha256.Sum256([]byte(fmt.Sprintf("xdrive-cas-a03-high-entropy-sample-%d", sample)))
	block, err := aes.NewCipher(seed[:])
	if err != nil {
		panic(err)
	}
	return &casA03ContentReader{stream: cipher.NewCTR(block, make([]byte, aes.BlockSize)), changed: changed}
}

func (r *casA03ContentReader) Read(p []byte) (int, error) {
	if r.position >= casA03FileBytes {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > casA03FileBytes-r.position {
		n = int(casA03FileBytes - r.position)
	}
	clear(p[:n])
	r.stream.XORKeyStream(p[:n], p[:n])
	if r.changed {
		from := max(r.position, casA03PatchStart)
		to := min(r.position+int64(n), casA03PatchStart+casA03PatchBytes)
		for off := from; off < to; off++ {
			p[int(off-r.position)] ^= 0xa5
		}
	}
	r.position += int64(n)
	return n, nil
}

func casA03PreHash(sample int, changed bool) (string, error) {
	h := sha256.New()
	_, err := io.CopyBuffer(h, newCASA03ContentReader(sample, changed), make([]byte, 1<<20))
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func casA03ProcessBytes() map[string]uint64 {
	data, err := os.ReadFile("/proc/self/io")
	if err != nil {
		return nil
	}
	result := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		pair := strings.SplitN(line, ":", 2)
		if len(pair) != 2 {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimSpace(pair[1]), 10, 64)
		if err == nil {
			result[pair[0]] = n
		}
	}
	return result
}

func casA03Allocated(root, key string) (int64, error) {
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(key)))
	if err != nil {
		return 0, err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, fmt.Errorf("not Linux stat_t")
	}
	if info.Size() != casA03FileBytes {
		return 0, fmt.Errorf("unexpected physical original size=%d", info.Size())
	}
	return st.Blocks * 512, nil
}

func casA03VerifyPair(ctx context.Context, s *Local, a, b string) (int64, int, error) {
	fa, err := s.Open(ctx, a)
	if err != nil {
		return 0, 0, err
	}
	defer fa.Close()
	fb, err := s.Open(ctx, b)
	if err != nil {
		return 0, 0, err
	}
	defer fb.Close()
	left := make([]byte, casA03ChunkBytes)
	right := make([]byte, casA03ChunkBytes)
	ha, hb := sha256.New(), sha256.New()
	var differences int64
	shared := 0
	for offset := int64(0); offset < casA03FileBytes; offset += casA03ChunkBytes {
		na, err := io.ReadFull(fa, left)
		if err != nil {
			return 0, 0, err
		}
		nb, err := io.ReadFull(fb, right)
		if err != nil {
			return 0, 0, err
		}
		if na != int(casA03ChunkBytes) || nb != na {
			return 0, 0, fmt.Errorf("truncated read")
		}
		ha.Write(left[:na])
		hb.Write(right[:nb])
		aSum := sha256.Sum256(left[:na])
		bSum := sha256.Sum256(right[:nb])
		if aSum == bSum {
			shared++
		}
		chunkEnd := offset + casA03ChunkBytes
		if chunkEnd <= casA03PatchStart || offset >= casA03PatchStart+casA03PatchBytes {
			if !bytes.Equal(left[:na], right[:nb]) {
				return 0, 0, fmt.Errorf("outside-patch content differs")
			}
		} else {
			for j := range left[:na] {
				absolute := offset + int64(j)
				if absolute >= casA03PatchStart && absolute < casA03PatchStart+casA03PatchBytes {
					if left[j]^right[j] != 0xa5 {
						return 0, 0, fmt.Errorf("wrong patch byte")
					}
					differences++
				} else if left[j] != right[j] {
					return 0, 0, fmt.Errorf("unexpected changed byte")
				}
			}
		}
	}
	if hex.EncodeToString(ha.Sum(nil)) != strings.TrimPrefix(filepath.Base(a), "/") || hex.EncodeToString(hb.Sum(nil)) != strings.TrimPrefix(filepath.Base(b), "/") {
		return 0, 0, fmt.Errorf("complete restored SHA does not match CAS key")
	}
	var eof [1]byte
	if n, e := fa.Read(eof[:]); n != 0 || e != io.EOF {
		return 0, 0, fmt.Errorf("original too long")
	}
	if n, e := fb.Read(eof[:]); n != 0 || e != io.EOF {
		return 0, 0, fmt.Errorf("version too long")
	}
	return differences, shared, nil
}

type casA03Result struct {
	Workload                          string  `json:"workload"`
	Sample                            int     `json:"sample"`
	OriginalBytes                     int64   `json:"original_bytes"`
	PatchBytes                        int64   `json:"patch_bytes"`
	HashOriginal                      string  `json:"hash_original"`
	HashChanged                       string  `json:"hash_changed"`
	SourcePrehashMs                   float64 `json:"source_prehash_ms"`
	LocalPutOriginalMs                float64 `json:"local_put_original_ms"`
	LocalPutChangedMs                 float64 `json:"local_put_changed_ms"`
	RestoreHashAndCompareMs           float64 `json:"restore_hash_and_compare_ms"`
	PhysicalCASOriginalBytes          int64   `json:"physical_cas_original_bytes"`
	PhysicalCASChangedBytes           int64   `json:"physical_cas_changed_bytes"`
	PhysicalTwoVersionsBytes          int64   `json:"physical_two_versions_bytes"`
	ActualDiffBytes                   int64   `json:"actual_diff_bytes"`
	EightMiBBlocksEach                int64   `json:"eight_mib_blocks_each"`
	EightMiBSharedBlocks              int     `json:"eight_mib_shared_blocks"`
	IdealEightMiBChunkAdditionalBytes int64   `json:"ideal_eight_mib_chunk_additional_bytes"`
	KernelWriteBytes                  uint64  `json:"kernel_write_bytes"`
	KernelReadBytes                   uint64  `json:"kernel_read_bytes"`
	ProcessMaxRSSKiB                  int64   `json:"process_max_rss_kib"`
	Passed                            bool    `json:"passed"`
	Scope                             string  `json:"scope"`
}

func TestCASA03Real4GiBLocalFullBlobVersion(t *testing.T) {
	if os.Getenv("XD_CAS_A03_REAL_VERSION_PERF") != "1" {
		t.Skip("opt-in physical 4GiB CAS only")
	}
	sample, err := strconv.Atoi(os.Getenv("XD_CAS_A03_SAMPLE"))
	if err != nil || sample < 1 || sample > 3 {
		t.Fatal("sample must be 1..3")
	}
	root := t.TempDir()
	var fs syscall.Statfs_t
	if err := syscall.Statfs(root, &fs); err != nil {
		t.Fatal(err)
	}
	free := uint64(fs.Bavail) * uint64(fs.Bsize)
	if free < 11<<30 {
		t.Fatalf("runner inadequate physical space %dB <11GiB: invalid environment, not product RED", free)
	}
	s, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pio := casA03ProcessBytes()
	hstart := time.Now()
	digestA, err := casA03PreHash(sample, false)
	if err != nil {
		t.Fatal(err)
	}
	digestB, err := casA03PreHash(sample, true)
	if err != nil {
		t.Fatal(err)
	}
	prehashMs := float64(time.Since(hstart).Microseconds()) / 1000
	if digestA == digestB {
		t.Fatal("changed 1MiB version must have different full hash")
	}
	keyA, err := ContentAddressedKey(digestA)
	if err != nil {
		t.Fatal(err)
	}
	keyB, err := ContentAddressedKey(digestB)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	n, err := s.Put(ctx, keyA, newCASA03ContentReader(sample, false))
	if err != nil || n != casA03FileBytes {
		t.Fatalf("original put n=%d: %v", n, err)
	}
	origMs := float64(time.Since(start).Microseconds()) / 1000
	start = time.Now()
	n, err = s.Put(ctx, keyB, newCASA03ContentReader(sample, true))
	if err != nil || n != casA03FileBytes {
		t.Fatalf("changed put n=%d: %v", n, err)
	}
	changedMs := float64(time.Since(start).Microseconds()) / 1000
	pa, err := casA03Allocated(root, keyA)
	if err != nil {
		t.Fatal(err)
	}
	pb, err := casA03Allocated(root, keyB)
	if err != nil {
		t.Fatal(err)
	}
	if pa < casA03FileBytes || pb < casA03FileBytes {
		t.Fatalf("sparse original CAS pa=%d pb=%d", pa, pb)
	}
	start = time.Now()
	diff, shared, err := casA03VerifyPair(ctx, s, keyA, keyB)
	if err != nil {
		t.Fatal(err)
	}
	verifyMs := float64(time.Since(start).Microseconds()) / 1000
	if diff != casA03PatchBytes || shared != int(casA03FileBytes/casA03ChunkBytes)-1 {
		t.Fatalf("diff=%d sharedBlocks=%d", diff, shared)
	}
	pioEnd := casA03ProcessBytes()
	if pio == nil || pioEnd == nil || pioEnd["write_bytes"] < pio["write_bytes"] || pioEnd["read_bytes"] < pio["read_bytes"] {
		t.Fatal("Linux /proc/self/io counters unavailable or non-monotonic: invalid benchmark harness")
	}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		t.Fatal(err)
	}
	result := casA03Result{Workload: "CAS-A03/S001-d/LINUX-LOCAL-PUT-TRUE-4GIB-VERSIONS", Sample: sample, OriginalBytes: casA03FileBytes, PatchBytes: casA03PatchBytes, HashOriginal: digestA, HashChanged: digestB,
		SourcePrehashMs: prehashMs, LocalPutOriginalMs: origMs, LocalPutChangedMs: changedMs, RestoreHashAndCompareMs: verifyMs,
		PhysicalCASOriginalBytes: pa, PhysicalCASChangedBytes: pb, PhysicalTwoVersionsBytes: pa + pb, ActualDiffBytes: diff,
		EightMiBBlocksEach: casA03FileBytes / casA03ChunkBytes, EightMiBSharedBlocks: shared, IdealEightMiBChunkAdditionalBytes: casA03ChunkBytes, ProcessMaxRSSKiB: usage.Maxrss,
		Scope: "Linux real production storage.Local.Put immutable SHA-256 CAS, 4GiB AES-CTR high entropy two full versions differing exactly 1MiB, restored full bytes; NO Gin/PG/auth/HTTP transfer, no implemented CDC, no native client/PWA", Passed: true}
	if pio != nil && pioEnd != nil {
		result.KernelWriteBytes = pioEnd["write_bytes"] - pio["write_bytes"]
		result.KernelReadBytes = pioEnd["read_bytes"] - pio["read_bytes"]
	}
	// Physical removal is guarded by storage's locking semantics; database-backed GC and cross-owner refs are NOT under test.
	if err := s.Delete(ctx, keyB); err != nil {
		t.Fatal(err)
	}
	kept, err := s.Open(ctx, keyA)
	if err != nil {
		t.Fatal("original version missing after B delete:", err)
	}
	if err := kept.Close(); err != nil {
		t.Fatalf("close preserved A handle: %v", err)
	}
	if err := s.Delete(ctx, keyA); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, keyA); !os.IsNotExist(err) {
		t.Fatalf("A not deleted: %v", err)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("CAS_A03_LOCAL_REAL_4GIB " + string(payload))
	if result.LocalPutOriginalMs > 360000 || result.LocalPutChangedMs > 360000 || result.ProcessMaxRSSKiB > 262144 {
		t.Fatalf("frozen storage-only budget red; metrics=%s", payload)
	}
	runtime.KeepAlive(s)
}
