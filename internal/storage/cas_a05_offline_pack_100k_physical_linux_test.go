//go:build linux

package storage

// CAS-A05 is an isolated real-physical-file benchmark, not a production pack
// implementation or a replacement for immutable SHA-256 ContentBlob objects.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	casA05OriginalCount = 100000
	casA05SmokeCount    = 1000
	casA05PayloadSize   = 1024
	casA05KeepDivisor   = 20
	casA05IndexSize     = 48 // offset int64, length uint32, flags uint32, digest [32]byte
	casA05RangeTrials   = 2000
)

type casA05Resource struct {
	WallMS           float64 `json:"wall_ms"`
	UserCPUMS        float64 `json:"user_cpu_ms"`
	SystemCPUMS      float64 `json:"system_cpu_ms"`
	KernelWriteBytes int64   `json:"kernel_write_bytes"`
	ProcessMaxRSSKiB int64   `json:"process_max_rss_kib"`
}

type casA05Arm struct {
	InitialWrite   casA05Resource `json:"initial_write"`
	RandomRead     casA05Resource `json:"random_read_2000"`
	Release95Pct   casA05Resource `json:"release_95pct"`
	VerifyKeepers  casA05Resource `json:"verify_all_5pct_keepers"`
	FullAllocated  int64          `json:"full_allocated_bytes"`
	AfterGCBytes   int64          `json:"after_gc_allocated_bytes"`
	PeakGCBytes    int64          `json:"peak_gc_allocated_bytes"`
	FullObjects    int            `json:"full_physical_objects_or_chunks"`
	AfterGCObjects int            `json:"after_gc_physical_objects_or_chunks"`
	AfterClear     int64          `json:"after_clear_bytes"`
}

type casA05Result struct {
	WorkloadID          string    `json:"workload_id"`
	Sample              int       `json:"sample"`
	Order               string    `json:"order"`
	Count               int       `json:"count"`
	UniqueSHA256        int       `json:"distinct_sha256"`
	RealFileSize        int       `json:"real_file_payload_bytes"`
	Keepers             int       `json:"surviving_references"`
	Removed             int       `json:"unreferenced_objects_removed"`
	SourceIdentitySHA   string    `json:"ordered_source_sha256"`
	Original            casA05Arm `json:"baseline_immutable_local_cas"`
	Candidate           casA05Arm `json:"offline_single_pack_and_binary_index"`
	InitialSpaceRatio   float64   `json:"packed_to_original_allocated_ratio"`
	PostGCSpaceRatio    float64   `json:"packed_to_original_after_gc_ratio"`
	ProcessMaxRSSKiB    int64     `json:"process_max_rss_kib"`
	CorruptByteRejected bool      `json:"corrupt_pack_content_rejected"`
	Passed              bool      `json:"passed"`
	ProductionChanged   bool      `json:"production_changed"`
	Scope               string    `json:"scope"`
}

type casA05IndexRecord struct {
	Offset int64
	Size   uint32
	SHA    [32]byte
}

type casA05Head struct {
	DataFile  string `json:"data_file"`
	IndexFile string `json:"index_file"`
	IndexSHA  string `json:"index_sha256"`
	Count     int    `json:"objects"`
}

func casA05ActualPayload(sample, index int) []byte {
	prefix := sha256.Sum256([]byte(fmt.Sprintf("xdrive-cas-a05/real-1k/%d/%d", sample, index)))
	out := make([]byte, casA05PayloadSize)
	for i := 0; i < len(out); i += sha256.Size {
		blockKey := append(prefix[:], byte(i/sha256.Size))
		block := sha256.Sum256(blockKey)
		copy(out[i:], block[:])
	}
	return out
}

func casA05Hash(sample, index int) [32]byte {
	return sha256.Sum256(casA05ActualPayload(sample, index))
}

func casA05OrderedIdentity(sample, count int) (string, error) {
	h := sha256.New()
	seen := make(map[[32]byte]bool, count)
	for i := 0; i < count; i++ {
		d := casA05Hash(sample, i)
		if seen[d] {
			return "", fmt.Errorf("duplicate physical SHA at %d", i)
		}
		seen[d] = true
		_, _ = h.Write(d[:])
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func casA05Usage(t *testing.T) syscall.Rusage {
	t.Helper()
	var r syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &r); err != nil {
		t.Fatal(err)
	}
	return r
}
func casA05CPUms(t syscall.Timeval) float64 {
	return float64(t.Sec)*1000 + float64(t.Usec)/1000
}
func casA05WriteBytes(t *testing.T) int64 {
	t.Helper()
	content, err := os.ReadFile("/proc/self/io")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(content), "\n") {
		if strings.HasPrefix(line, "write_bytes:") {
			num, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "write_bytes:")), 10, 64)
			if err != nil {
				t.Fatal(err)
			}
			return num
		}
	}
	t.Fatal("missing /proc/self/io write_bytes")
	return 0
}
func casA05Measure(t *testing.T, do func() error) casA05Resource {
	t.Helper()
	c0 := casA05Usage(t)
	w0 := casA05WriteBytes(t)
	start := time.Now()
	if err := do(); err != nil {
		t.Fatal(err)
	}
	c1 := casA05Usage(t)
	return casA05Resource{
		WallMS:           float64(time.Since(start).Microseconds()) / 1000,
		UserCPUMS:        casA05CPUms(c1.Utime) - casA05CPUms(c0.Utime),
		SystemCPUMS:      casA05CPUms(c1.Stime) - casA05CPUms(c0.Stime),
		KernelWriteBytes: casA05WriteBytes(t) - w0,
		ProcessMaxRSSKiB: c1.Maxrss,
	}
}

func casA05Allocated(root string) (int64, int, error) {
	var allocated int64
	var files int
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("nonregular physical benchmark object %q", path)
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok {
			return errors.New("Linux inode blocks unavailable")
		}
		allocated += st.Blocks * 512
		if info.Size() != 0 {
			files++
		}
		return nil
	})
	return allocated, files, err
}
func casA05FullIdentityKey(sample, index int) (string, error) {
	d := casA05Hash(sample, index)
	return ContentAddressedKey(hex.EncodeToString(d[:]))
}
func casA05ReadOriginal(store *Local, sample, i int) error {
	key, err := casA05FullIdentityKey(sample, i)
	if err != nil {
		return err
	}
	f, err := store.Open(context.Background(), key)
	if err != nil {
		return err
	}
	var actual [casA05PayloadSize]byte
	n, readErr := io.ReadFull(f, actual[:])
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || n != casA05PayloadSize {
		return fmt.Errorf("Local.Open real original %d: %d %v %v", i, n, readErr, closeErr)
	}
	want := casA05ActualPayload(sample, i)
	if !bytes.Equal(actual[:], want) || sha256.Sum256(actual[:]) != casA05Hash(sample, i) {
		return fmt.Errorf("Local Open bytes/SHA corrupted at %d", i)
	}
	return nil
}
func casA05ReadOriginalBatch(store *Local, sample, count int, keepersOnly bool) error {
	if keepersOnly {
		for i := 0; i < count; i += casA05KeepDivisor {
			if err := casA05ReadOriginal(store, sample, i); err != nil {
				return err
			}
		}
		return nil
	}
	for k := 0; k < casA05RangeTrials; k++ {
		i := ((k * 49157) + sample*73) % count
		if err := casA05ReadOriginal(store, sample, i); err != nil {
			return err
		}
	}
	return nil
}

func casA05Baseline(t *testing.T, root string, sample, count int) casA05Arm {
	t.Helper()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	var res casA05Arm
	ctx := context.Background()
	res.InitialWrite = casA05Measure(t, func() error {
		for i := 0; i < count; i++ {
			key, err := casA05FullIdentityKey(sample, i)
			if err != nil {
				return err
			}
			n, err := store.Put(ctx, key, bytes.NewReader(casA05ActualPayload(sample, i)))
			if err != nil || n != casA05PayloadSize {
				return fmt.Errorf("production Local.Put #%d wrote=%d err=%v", i, n, err)
			}
		}
		return nil
	})
	res.FullAllocated, res.FullObjects, err = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if err != nil {
		t.Fatal(err)
	}
	if res.FullObjects != count || res.FullAllocated < int64(count*casA05PayloadSize) {
		t.Fatalf("invalid baseline true original file count and allocation: %+v", res)
	}
	res.RandomRead = casA05Measure(t, func() error {
		return casA05ReadOriginalBatch(store, sample, count, false)
	})
	res.Release95Pct = casA05Measure(t, func() error {
		for i := 0; i < count; i++ {
			if i%casA05KeepDivisor == 0 {
				continue
			}
			key, err := casA05FullIdentityKey(sample, i)
			if err != nil {
				return err
			}
			if err := store.Delete(ctx, key); err != nil {
				return fmt.Errorf("production Local.Delete %d: %w", i, err)
			}
		}
		return nil
	})
	res.AfterGCBytes, res.AfterGCObjects, err = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if err != nil {
		t.Fatal(err)
	}
	res.PeakGCBytes = res.FullAllocated // Deletes must not grow logical persisted bytes.
	if res.AfterGCObjects != count/casA05KeepDivisor {
		t.Fatalf("production 95pct GC did not preserve actual keeper inodes: %d", res.AfterGCObjects)
	}
	res.VerifyKeepers = casA05Measure(t, func() error {
		return casA05ReadOriginalBatch(store, sample, count, true)
	})
	for i := 0; i < count; i += casA05KeepDivisor {
		key, err := casA05FullIdentityKey(sample, i)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.Delete(ctx, key); err != nil {
			t.Fatal(err)
		}
	}
	res.AfterClear, _, err = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if err != nil {
		t.Fatal(err)
	}
	if res.AfterClear != 0 {
		t.Fatalf("baseline still stores physical CAS bytes: %d", res.AfterClear)
	}
	return res
}

func casA05RecordWrite(w io.Writer, row casA05IndexRecord) error {
	var payload [casA05IndexSize]byte
	binary.LittleEndian.PutUint64(payload[:8], uint64(row.Offset))
	binary.LittleEndian.PutUint32(payload[8:12], row.Size)
	copy(payload[16:48], row.SHA[:])
	_, err := w.Write(payload[:])
	return err
}
func casA05IndexRead(index []byte) ([]casA05IndexRecord, error) {
	if len(index) == 0 || len(index)%casA05IndexSize != 0 {
		return nil, errors.New("invalid or empty offline pack index")
	}
	rows := make([]casA05IndexRecord, len(index)/casA05IndexSize)
	var next int64
	seen := make(map[[32]byte]bool, len(rows))
	for i := range rows {
		raw := index[i*casA05IndexSize : (i+1)*casA05IndexSize]
		rows[i].Offset = int64(binary.LittleEndian.Uint64(raw[:8]))
		rows[i].Size = binary.LittleEndian.Uint32(raw[8:12])
		copy(rows[i].SHA[:], raw[16:48])
		if rows[i].Size != casA05PayloadSize || rows[i].Offset != next || seen[rows[i].SHA] {
			return nil, fmt.Errorf("invalid, missing or repeated offline hash object index record %d", i)
		}
		seen[rows[i].SHA] = true
		next += int64(rows[i].Size)
	}
	return rows, nil
}
func casA05SyncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	err = f.Sync()
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func casA05FileSyncAndClose(f *os.File) error {
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}
func casA05SaveHead(root string, head casA05Head) error {
	body, err := json.Marshal(head)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(root, ".head.pending"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err := f.Write(body); err != nil {
		_ = f.Close()
		return err
	}
	if err := casA05FileSyncAndClose(f); err != nil {
		return err
	}
	if err := os.Rename(filepath.Join(root, ".head.pending"), filepath.Join(root, "HEAD.json")); err != nil {
		return err
	}
	return casA05SyncDir(root)
}
func casA05LoadPack(root string) (casA05Head, []casA05IndexRecord, *os.File, error) {
	var head casA05Head
	b, err := os.ReadFile(filepath.Join(root, "HEAD.json"))
	if err != nil {
		return head, nil, nil, err
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return head, nil, nil, err
	}
	if !(head.DataFile == "gen1.pack" || head.DataFile == "gen2.pack") ||
		!(head.IndexFile == "gen1.idx" || head.IndexFile == "gen2.idx") {
		return head, nil, nil, errors.New("unknown offline pack filename")
	}
	index, err := os.ReadFile(filepath.Join(root, head.IndexFile))
	if err != nil {
		return head, nil, nil, err
	}
	sum := sha256.Sum256(index)
	if hex.EncodeToString(sum[:]) != head.IndexSHA {
		return head, nil, nil, errors.New("offline index SHA invalid")
	}
	rows, err := casA05IndexRead(index)
	if err != nil || len(rows) != head.Count {
		return head, nil, nil, errors.New("offline pack manifest/index record mismatch")
	}
	data, err := os.Open(filepath.Join(root, head.DataFile))
	if err != nil {
		return head, nil, nil, err
	}
	stat, err := data.Stat()
	if err != nil || stat.Size() != int64(len(rows)*casA05PayloadSize) {
		_ = data.Close()
		return head, nil, nil, errors.New("offline pack data byte length mismatch")
	}
	return head, rows, data, nil
}
func casA05PackVerifyRead(r io.ReaderAt, row casA05IndexRecord, want []byte) error {
	var payload [casA05PayloadSize]byte
	n, err := r.ReadAt(payload[:], row.Offset)
	if err != nil || n != casA05PayloadSize {
		return fmt.Errorf("offline content short read: %d / %v", n, err)
	}
	if sha256.Sum256(payload[:]) != row.SHA || !bytes.Equal(payload[:], want) {
		return errors.New("offline content corrupted or returned wrong Range")
	}
	if !bytes.Equal(payload[128:384], want[128:384]) {
		return errors.New("offline partial 256B range mismatch")
	}
	return nil
}
func casA05WritePack(root string, generation int, sample, count int, source *os.File, previous []casA05IndexRecord) error {
	packName := fmt.Sprintf("gen%d.pack", generation)
	indexName := fmt.Sprintf("gen%d.idx", generation)
	pendingPack := filepath.Join(root, packName+".pending")
	pendingIndex := filepath.Join(root, indexName+".pending")
	pack, err := os.OpenFile(pendingPack, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	index, err := os.OpenFile(pendingIndex, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		_ = pack.Close()
		return err
	}
	offset := int64(0)
	recordCount := 0
	for i := 0; i < count; i++ {
		if generation == 2 && i%casA05KeepDivisor != 0 {
			continue
		}
		var data []byte
		if generation == 1 {
			data = casA05ActualPayload(sample, i)
		} else {
			data = make([]byte, casA05PayloadSize)
			row := previous[i]
			n, err := source.ReadAt(data, row.Offset)
			if err != nil || n != casA05PayloadSize {
				return fmt.Errorf("read original pack keeper %d: n=%d %v", i, n, err)
			}
			if sha256.Sum256(data) != row.SHA {
				return errors.New("old immutable pack corrupted during GC")
			}
		}
		sha := sha256.Sum256(data)
		if !bytes.Equal(data, casA05ActualPayload(sample, i)) || sha != casA05Hash(sample, i) {
			return fmt.Errorf("packed logical original changed %d", i)
		}
		if n, err := pack.Write(data); err != nil || n != len(data) {
			return fmt.Errorf("pack actual append %d n=%d err=%v", i, n, err)
		}
		if err := casA05RecordWrite(index, casA05IndexRecord{
			Offset: offset, Size: casA05PayloadSize, SHA: sha,
		}); err != nil {
			return err
		}
		offset += casA05PayloadSize
		recordCount++
	}
	if err := casA05FileSyncAndClose(pack); err != nil {
		return err
	}
	if err := casA05FileSyncAndClose(index); err != nil {
		return err
	}
	if err := os.Rename(pendingPack, filepath.Join(root, packName)); err != nil {
		return err
	}
	if err := os.Rename(pendingIndex, filepath.Join(root, indexName)); err != nil {
		return err
	}
	if err := casA05SyncDir(root); err != nil {
		return err
	}
	idx, err := os.ReadFile(filepath.Join(root, indexName))
	if err != nil {
		return err
	}
	digest := sha256.Sum256(idx)
	return casA05SaveHead(root, casA05Head{
		DataFile: packName, IndexFile: indexName, IndexSHA: hex.EncodeToString(digest[:]), Count: recordCount,
	})
}
func casA05ReadPackBatch(pack *os.File, rows []casA05IndexRecord, sample, count int, keepersOnly bool) error {
	if keepersOnly {
		if len(rows) != count/casA05KeepDivisor {
			return fmt.Errorf("wrong survivor manifest entries %d", len(rows))
		}
		for i, row := range rows {
			if err := casA05PackVerifyRead(pack, row, casA05ActualPayload(sample, i*casA05KeepDivisor)); err != nil {
				return err
			}
		}
		return nil
	}
	if len(rows) != count {
		return errors.New("full pack index count mismatch")
	}
	for trial := 0; trial < casA05RangeTrials; trial++ {
		index := (trial*49157 + sample*73) % count
		if err := casA05PackVerifyRead(pack, rows[index], casA05ActualPayload(sample, index)); err != nil {
			return err
		}
	}
	return nil
}
func casA05PackCorruptionProbe(pack *os.File, rows []casA05IndexRecord, sample int) error {
	if len(rows) == 0 {
		return errors.New("missing keeper for corruption proof")
	}
	offset := rows[0].Offset
	buf := []byte{0}
	if n, err := pack.ReadAt(buf, offset); err != nil || n != 1 {
		return errors.New("cannot read original immutable pack byte")
	}
	old := buf[0]
	buf[0] ^= 0xa5
	writer, err := os.OpenFile(pack.Name(), os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if _, err := writer.WriteAt(buf, offset); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Sync(); err != nil {
		_ = writer.Close()
		return err
	}
	_ = writer.Close()
	if err := casA05PackVerifyRead(pack, rows[0], casA05ActualPayload(sample, 0)); err == nil {
		return errors.New("SHA corruption was silently accepted")
	}
	buf[0] = old
	writer, err = os.OpenFile(pack.Name(), os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if _, err := writer.WriteAt(buf, offset); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Sync(); err != nil {
		_ = writer.Close()
		return err
	}
	_ = writer.Close()
	return casA05PackVerifyRead(pack, rows[0], casA05ActualPayload(sample, 0))
}
func casA05OfflinePack(t *testing.T, root string, sample, count int, corruption *bool) casA05Arm {
	t.Helper()
	var res casA05Arm
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	res.InitialWrite = casA05Measure(t, func() error {
		return casA05WritePack(root, 1, sample, count, nil, nil)
	})
	head1, rows1, source, err := casA05LoadPack(root)
	if err != nil || head1.Count != count {
		t.Fatalf("pack indexed first generation %v: %+v", err, head1)
	}
	res.FullAllocated, res.FullObjects, err = casA05Allocated(root)
	if err != nil {
		t.Fatal(err)
	}
	res.RandomRead = casA05Measure(t, func() error {
		return casA05ReadPackBatch(source, rows1, sample, count, false)
	})
	res.Release95Pct = casA05Measure(t, func() error {
		return casA05WritePack(root, 2, sample, count, source, rows1)
	})
	res.PeakGCBytes, _, err = casA05Allocated(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, head1.DataFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, head1.IndexFile)); err != nil {
		t.Fatal(err)
	}
	if err := casA05SyncDir(root); err != nil {
		t.Fatal(err)
	}
	head2, rows2, pack2, err := casA05LoadPack(root)
	if err != nil || head2.Count != count/casA05KeepDivisor {
		t.Fatalf("packed GC keeper generation invalid: %v %+v", err, head2)
	}
	res.AfterGCBytes, res.AfterGCObjects, err = casA05Allocated(root)
	if err != nil {
		t.Fatal(err)
	}
	res.VerifyKeepers = casA05Measure(t, func() error {
		return casA05ReadPackBatch(pack2, rows2, sample, count, true)
	})
	if err := casA05PackCorruptionProbe(pack2, rows2, sample); err != nil {
		t.Fatal(err)
	}
	*corruption = true
	if err := pack2.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"HEAD.json", head2.IndexFile, head2.DataFile} {
		if err := os.Remove(filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	res.AfterClear, _, err = casA05Allocated(root)
	if err != nil {
		t.Fatal(err)
	}
	if res.AfterClear != 0 {
		t.Fatalf("offline pack objects remain after final GC: %d", res.AfterClear)
	}
	return res
}

func TestCASA05Real100KPhysicalLocalCASVersusOfflinePackGC(t *testing.T) {
	if os.Getenv("XD_CAS_A05_REAL_100K_PACK_PERF") != "1" {
		t.Skip("opt in genuine 100k canonical Local.Put/Delete vs offline pack A/B")
	}
	sampleStr := os.Getenv("XD_CAS_A05_SAMPLE")
	if sampleStr != "sample-1" && sampleStr != "sample-2" && sampleStr != "sample-3" {
		t.Fatal("independent sample-1..3 required")
	}
	sample, _ := strconv.Atoi(strings.TrimPrefix(sampleStr, "sample-"))
	count := casA05OriginalCount
	if os.Getenv("XD_CAS_A05_SMOKE") == "1" {
		count = casA05SmokeCount
	}
	if count%casA05KeepDivisor != 0 {
		t.Fatal("fixture keeper count is not integral")
	}
	identity, err := casA05OrderedIdentity(sample, count)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	var result casA05Result
	result.WorkloadID = "CAS-A05-100k-distinct-1KiB-physical-local-CAS-vs-offline-pack-gc"
	result.Sample = sample
	result.Count = count
	result.Keepers = count / casA05KeepDivisor
	result.Removed = count - result.Keepers
	result.RealFileSize = casA05PayloadSize
	result.UniqueSHA256 = count
	result.SourceIdentitySHA = identity
	if sample%2 == 1 {
		result.Order = "baseline_then_packed"
		result.Original = casA05Baseline(t, filepath.Join(root, "original"), sample, count)
		result.Candidate = casA05OfflinePack(t, filepath.Join(root, "candidate"), sample, count, &result.CorruptByteRejected)
	} else {
		result.Order = "packed_then_baseline"
		result.Candidate = casA05OfflinePack(t, filepath.Join(root, "candidate"), sample, count, &result.CorruptByteRejected)
		result.Original = casA05Baseline(t, filepath.Join(root, "original"), sample, count)
	}
	if result.Original.FullAllocated <= 0 || result.Candidate.FullAllocated <= 0 ||
		result.Original.AfterGCBytes <= 0 || result.Candidate.AfterGCBytes <= 0 {
		t.Fatalf("missing physical disk accounting %+v", result)
	}
	result.InitialSpaceRatio = float64(result.Candidate.FullAllocated) / float64(result.Original.FullAllocated)
	result.PostGCSpaceRatio = float64(result.Candidate.AfterGCBytes) / float64(result.Original.AfterGCBytes)
	result.ProcessMaxRSSKiB = casA05Usage(t).Maxrss
	if count == casA05OriginalCount {
		if result.Original.FullAllocated < int64(count*4096) ||
			result.Original.FullObjects != count ||
			result.Original.AfterGCObjects != result.Keepers ||
			result.Candidate.FullObjects != 3 ||
			result.Candidate.AfterGCObjects != 3 ||
			result.InitialSpaceRatio > .35 ||
			result.PostGCSpaceRatio > .35 ||
			result.Candidate.PeakGCBytes <= result.Candidate.FullAllocated ||
			result.ProcessMaxRSSKiB > 524288 ||
			result.Original.InitialWrite.WallMS > 900000 ||
			result.Candidate.InitialWrite.WallMS > 900000 ||
			result.Original.Release95Pct.WallMS > 900000 ||
			result.Candidate.Release95Pct.WallMS > 900000 {
			t.Fatalf("frozen real CAS/pack benchmark budget RED: %+v", result)
		}
	}
	if !result.CorruptByteRejected ||
		result.Original.AfterClear != 0 || result.Candidate.AfterClear != 0 ||
		result.Original.FullObjects != count || result.Original.AfterGCObjects != result.Keepers ||
		result.Candidate.FullObjects != 3 || result.Candidate.AfterGCObjects != 3 {
		t.Fatalf("offline original/pack correctness or GC failed: %+v", result)
	}
	runtime.GC()
	result.Passed = true
	result.ProductionChanged = false
	result.Scope = "Real Linux production Local.Put/Open/Delete of 100k different 1KiB SHA objects versus test-only offline contiguous pack+binary manifest, 2000 256B Range checks, 95pct whole-object GC, SHA survivor verification, corrupt pack rejection. No SQL references, no online blob Pack implementation, no Browser/Electron/PWA or genuine Source Push."
	row, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_A05_REAL_100K_PACK_PHYSICAL_AB %s", row)
}
