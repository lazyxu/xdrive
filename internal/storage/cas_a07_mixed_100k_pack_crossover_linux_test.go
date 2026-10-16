//go:build linux

package storage

// CAS-A07 compares a NEW mixed-size physical 100k content distribution.
// Its pack and index are an isolated test model, never a production format.
import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const (
	casA07FullCount     = 100000
	casA07SmokeCount    = 1000
	casA07KeepEvery     = 20
	casA07IndexRowBytes = 48
)

type casA07Item struct {
	Offset int64
	Size   uint32
	Hash   [32]byte
}

type casA07PackHead struct {
	Data     string `json:"data"`
	Index    string `json:"index"`
	IndexSHA string `json:"index_sha256"`
	Count    int    `json:"count"`
}

type casA07Phase = casA05Resource

type casA07Arm struct {
	Write             casA07Phase `json:"initial_write"`
	Read              casA07Phase `json:"mixed_size_random_read_2000"`
	Release           casA07Phase `json:"release_95pct"`
	VerifySurvivors   casA07Phase `json:"verify_5pct_survivors"`
	FullAllocated     int64       `json:"full_allocated_bytes"`
	FullObjects       int         `json:"full_objects"`
	AfterGCAllocated  int64       `json:"after_gc_allocated_bytes"`
	AfterGCObjects    int         `json:"after_gc_objects"`
	DuringGCAllocated int64       `json:"peak_during_gc_allocated_bytes"`
	AfterClear        int64       `json:"after_clear_allocated_bytes"`
}

type casA07Result struct {
	Workload           string    `json:"workload"`
	Sample             int       `json:"sample"`
	SourceIdentitySHA  string    `json:"source_identity_sha256"`
	Count              int       `json:"count"`
	ClassCounts        [4]int    `json:"size_class_counts"`
	ClassSizes         [4]int    `json:"size_class_bytes"`
	ClassLogicalBytes  [4]int64  `json:"size_class_logical_bytes"`
	LogicalBytes       int64     `json:"logical_bytes"`
	Keepers            int       `json:"keepers"`
	Removed            int       `json:"removed"`
	Order              string    `json:"execution_order"`
	Original           casA07Arm `json:"original_local_immutable_cas"`
	Candidate          casA07Arm `json:"offline_mixed_pack_index"`
	PhysicalRatio      float64   `json:"packed_to_original_full_physical_ratio"`
	AfterGCRatio       float64   `json:"packed_to_original_after_gc_ratio"`
	CorruptionRejected bool      `json:"offline_corruption_rejected"`
	PeakRSSKiB         int64     `json:"process_peak_rss_kib"`
	Passed             bool      `json:"passed"`
	ProductionChanged  bool      `json:"production_changed"`
	Scope              string    `json:"scope"`
}

func casA07Counts(total int) [4]int {
	if total == casA07SmokeCount {
		return [4]int{950, 40, 9, 1}
	}
	return [4]int{95000, 4000, 900, 100}
}
func casA07Classes(total int) [4]int {
	c := casA07Counts(total)
	return [4]int{c[0], c[0] + c[1], c[0] + c[1] + c[2], total}
}
func casA07Size(total, index int) int {
	b := casA07Classes(total)
	switch {
	case index < b[0]:
		return 1024
	case index < b[1]:
		return 16 << 10
	case index < b[2]:
		return 128 << 10
	default:
		return 1 << 20
	}
}
func casA07Data(sample, total, index int) []byte {
	size := casA07Size(total, index)
	key := sha256.Sum256([]byte(fmt.Sprintf("xdrive-cas-a07-real-mixed/%d/%d/%d", sample, index, size)))
	block, e := aes.NewCipher(key[:])
	if e != nil {
		panic(e)
	}
	iv := make([]byte, aes.BlockSize)
	binary.LittleEndian.PutUint64(iv[:8], uint64(index))
	p := make([]byte, size)
	cipher.NewCTR(block, iv).XORKeyStream(p, p)
	return p
}
func casA07Key(sample, total, index int) (string, [32]byte, error) {
	hash := sha256.Sum256(casA07Data(sample, total, index))
	key, err := ContentAddressedKey(hex.EncodeToString(hash[:]))
	return key, hash, err
}
func casA07SourceID(sample, total int) (string, error) {
	h := sha256.New()
	seen := make(map[[32]byte]bool, total)
	for i := 0; i < total; i++ {
		_, sum, e := casA07Key(sample, total, i)
		if e != nil {
			return "", e
		}
		if seen[sum] {
			return "", fmt.Errorf("duplicate genuine physical source %d", i)
		}
		seen[sum] = true
		_, _ = h.Write(sum[:])
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func casA07ReadIndices(total int) []int {
	b := casA07Classes(total)
	output := make([]int, 0, 2000)
	n0 := 1700
	n1 := 100
	n2 := 100
	n3 := 100
	if total == casA07SmokeCount {
		n0 = 50
		n1 = 20
		n2 = 9
		n3 = 1
	}
	for i := 0; i < n0; i++ {
		output = append(output, (i*7919)%b[0])
	}
	for i := 0; i < n1; i++ {
		output = append(output, b[0]+(i*37)%(b[1]-b[0]))
	}
	for i := 0; i < n2; i++ {
		output = append(output, b[1]+(i*17)%(b[2]-b[1]))
	}
	for i := 0; i < n3; i++ {
		output = append(output, b[2]+(i*13)%(b[3]-b[2]))
	}
	return output
}
func casA07Compare(actual, want []byte) error {
	if !bytes.Equal(actual, want) || sha256.Sum256(actual) != sha256.Sum256(want) {
		return errors.New("actual original full SHA/content mismatched")
	}
	start := (len(want) - 256) / 2
	if !bytes.Equal(actual[start:start+256], want[start:start+256]) {
		return errors.New("256B original Range mismatch")
	}
	return nil
}
func casA07PrecomputedKeys(sample, total int) ([]string, error) {
	keys := make([]string, total)
	for i := range keys {
		key, _, err := casA07Key(sample, total, i)
		if err != nil {
			return nil, err
		}
		keys[i] = key
	}
	return keys, nil
}

// Keys are calculated before every timed operation, not in the critical
// Local.Open/Local.Delete or offline pack ReadAt measurements.
func casA07ReadOneLocal(s *Local, sample, total, index int, key string) error {
	f, err := s.Open(context.Background(), key)
	if err != nil {
		return err
	}
	size := casA07Size(total, index)
	payload := make([]byte, size)
	_, readErr := io.ReadFull(f, payload)
	var segment [256]byte
	offset := int64((size - 256) / 2)
	got, rangeErr := f.ReadAt(segment[:], offset)
	closeErr := f.Close()
	if readErr != nil || rangeErr != nil || got != len(segment) || closeErr != nil {
		return fmt.Errorf("original Local.Open and ReadAt %d: %v %v %v", index, readErr, rangeErr, closeErr)
	}
	expected := casA07Data(sample, total, index)
	if !bytes.Equal(segment[:], expected[offset:offset+256]) {
		return errors.New("original 256B ReadAt oracle mismatch")
	}
	return casA07Compare(payload, expected)
}
func casA07Original(t *testing.T, root string, sample, total int, reads []int, keys []string) casA07Arm {
	t.Helper()
	if len(keys) != total {
		t.Fatal("missing precomputed SHA-256 identity keys")
	}
	store, e := NewLocal(root)
	if e != nil {
		t.Fatal(e)
	}
	var res casA07Arm
	res.Write = casA05Measure(t, func() error {
		for i := 0; i < total; i++ {
			payload := casA07Data(sample, total, i)
			n, err := store.Put(context.Background(), keys[i], bytes.NewReader(payload))
			if err != nil || n != int64(len(payload)) {
				return fmt.Errorf("original physical Local.Put %d wrote=%d err=%v", i, n, err)
			}
		}
		return nil
	})
	res.FullAllocated, res.FullObjects, e = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if e != nil || res.FullObjects != total {
		t.Fatalf("original CAS files=%d bytes=%d err=%v", res.FullObjects, res.FullAllocated, e)
	}
	res.Read = casA05Measure(t, func() error {
		for _, i := range reads {
			if err := casA07ReadOneLocal(store, sample, total, i, keys[i]); err != nil {
				return err
			}
		}
		return nil
	})
	res.Release = casA05Measure(t, func() error {
		for i := 0; i < total; i++ {
			if i%casA07KeepEvery == 0 {
				continue
			}
			if err := store.Delete(context.Background(), keys[i]); err != nil {
				return err
			}
		}
		return nil
	})
	res.DuringGCAllocated = res.FullAllocated
	res.AfterGCAllocated, res.AfterGCObjects, e = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if e != nil || res.AfterGCObjects != total/casA07KeepEvery {
		t.Fatalf("original 95k GC keepers=%d err=%v", res.AfterGCObjects, e)
	}
	res.VerifySurvivors = casA05Measure(t, func() error {
		for i := 0; i < total; i += casA07KeepEvery {
			if err := casA07ReadOneLocal(store, sample, total, i, keys[i]); err != nil {
				return err
			}
		}
		return nil
	})
	for i := 0; i < total; i += casA07KeepEvery {
		if err := store.Delete(context.Background(), keys[i]); err != nil {
			t.Fatal(err)
		}
	}
	res.AfterClear, _, e = casA05Allocated(filepath.Join(root, ".xdrive-blobs", "sha256"))
	if e != nil || res.AfterClear != 0 {
		t.Fatalf("original CAS not released %d err=%v", res.AfterClear, e)
	}
	return res
}
func casA07WriteRecord(w io.Writer, r casA07Item) error {
	var row [casA07IndexRowBytes]byte
	binary.LittleEndian.PutUint64(row[:8], uint64(r.Offset))
	binary.LittleEndian.PutUint32(row[8:12], r.Size)
	copy(row[16:48], r.Hash[:])
	n, e := w.Write(row[:])
	if e != nil {
		return e
	}
	if n != len(row) {
		return io.ErrShortWrite
	}
	return nil
}
func casA07HeadWrite(root string, h casA07PackHead) error {
	encoded, e := json.Marshal(h)
	if e != nil {
		return e
	}
	name := filepath.Join(root, "HEAD.pending")
	f, e := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(encoded); e != nil {
		_ = f.Close()
		return e
	}
	if e = casA05FileSyncAndClose(f); e != nil {
		return e
	}
	if e = os.Rename(name, filepath.Join(root, "HEAD.json")); e != nil {
		return e
	}
	return casA05SyncDir(root)
}
func casA07PackWrite(root string, generation, sample, total int, previous *os.File, oldRows []casA07Item) error {
	dataName := fmt.Sprintf("gen%d.pack", generation)
	indexName := fmt.Sprintf("gen%d.idx", generation)
	data, e := os.OpenFile(filepath.Join(root, dataName+".pending"), os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	index, e := os.OpenFile(filepath.Join(root, indexName+".pending"), os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
	if e != nil {
		_ = data.Close()
		return e
	}
	var at int64
	count := 0
	for i := 0; i < total; i++ {
		if generation == 2 && i%casA07KeepEvery != 0 {
			continue
		}
		var payload []byte
		if generation == 1 {
			payload = casA07Data(sample, total, i)
		} else {
			if previous == nil || len(oldRows) != total {
				return errors.New("missing old pack/index for compaction")
			}
			payload = make([]byte, casA07Size(total, i))
			n, e := previous.ReadAt(payload, oldRows[i].Offset)
			if e != nil || n != len(payload) {
				return fmt.Errorf("compaction read %d: %v", i, e)
			}
			if sha256.Sum256(payload) != oldRows[i].Hash {
				return errors.New("corrupt old pack during compaction")
			}
			if e := casA07Compare(payload, casA07Data(sample, total, i)); e != nil {
				return e
			}
		}
		hash := sha256.Sum256(payload)
		n, e := data.Write(payload)
		if e != nil || n != len(payload) {
			return fmt.Errorf("pack append %d wrote=%d %v", i, n, e)
		}
		if e := casA07WriteRecord(index, casA07Item{Offset: at, Size: uint32(len(payload)), Hash: hash}); e != nil {
			return e
		}
		at += int64(len(payload))
		count++
	}
	if e := casA05FileSyncAndClose(data); e != nil {
		return e
	}
	if e := casA05FileSyncAndClose(index); e != nil {
		return e
	}
	if e = os.Rename(filepath.Join(root, dataName+".pending"), filepath.Join(root, dataName)); e != nil {
		return e
	}
	if e = os.Rename(filepath.Join(root, indexName+".pending"), filepath.Join(root, indexName)); e != nil {
		return e
	}
	if e = casA05SyncDir(root); e != nil {
		return e
	}
	contents, e := os.ReadFile(filepath.Join(root, indexName))
	if e != nil {
		return e
	}
	digest := sha256.Sum256(contents)
	return casA07HeadWrite(root, casA07PackHead{Data: dataName, Index: indexName, IndexSHA: hex.EncodeToString(digest[:]), Count: count})
}
func casA07OpenPack(root string, expectedCount int) (casA07PackHead, []casA07Item, *os.File, error) {
	var h casA07PackHead
	b, e := os.ReadFile(filepath.Join(root, "HEAD.json"))
	if e != nil {
		return h, nil, nil, e
	}
	if e = json.Unmarshal(b, &h); e != nil {
		return h, nil, nil, e
	}
	if (h.Data != "gen1.pack" && h.Data != "gen2.pack") ||
		(h.Index != "gen1.idx" && h.Index != "gen2.idx") || h.Count != expectedCount {
		return h, nil, nil, errors.New("unrecognized or wrong-sized mixed Pack HEAD")
	}
	raw, e := os.ReadFile(filepath.Join(root, h.Index))
	if e != nil {
		return h, nil, nil, e
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != h.IndexSHA || len(raw) != h.Count*casA07IndexRowBytes {
		return h, nil, nil, errors.New("corrupt Pack index length or checksum")
	}
	rows := make([]casA07Item, h.Count)
	seen := make(map[[32]byte]bool, h.Count)
	var expectedOffset int64
	for i := range rows {
		b := raw[i*casA07IndexRowBytes : (i+1)*casA07IndexRowBytes]
		rows[i].Offset = int64(binary.LittleEndian.Uint64(b[:8]))
		rows[i].Size = binary.LittleEndian.Uint32(b[8:12])
		copy(rows[i].Hash[:], b[16:48])
		if rows[i].Offset != expectedOffset || rows[i].Size == 0 || seen[rows[i].Hash] {
			return h, nil, nil, fmt.Errorf("missing/duplicate/overlapping packed bytes index=%d", i)
		}
		seen[rows[i].Hash] = true
		expectedOffset += int64(rows[i].Size)
	}
	f, e := os.Open(filepath.Join(root, h.Data))
	if e != nil {
		return h, nil, nil, e
	}
	stat, e := f.Stat()
	if e != nil || stat.Size() != expectedOffset {
		_ = f.Close()
		return h, nil, nil, errors.New("wrong physical pack length")
	}
	return h, rows, f, nil
}
func casA07ReadPacked(f *os.File, row casA07Item, sample, total, originalIndex int) error {
	size := casA07Size(total, originalIndex)
	if int(row.Size) != size {
		return fmt.Errorf("pack index size for %d", originalIndex)
	}
	buf := make([]byte, size)
	n, e := f.ReadAt(buf, row.Offset)
	if e != nil || n != size {
		return fmt.Errorf("pack read %d n=%d err=%v", originalIndex, n, e)
	}
	if sha256.Sum256(buf) != row.Hash {
		return fmt.Errorf("Pack damaged content at %d", originalIndex)
	}
	var rangeData [256]byte
	offset := int64((size - 256) / 2)
	rangeN, rangeErr := f.ReadAt(rangeData[:], row.Offset+offset)
	if rangeErr != nil || rangeN != len(rangeData) {
		return fmt.Errorf("Pack Range %d: %d %v", originalIndex, rangeN, rangeErr)
	}
	want := casA07Data(sample, total, originalIndex)
	if !bytes.Equal(rangeData[:], want[offset:offset+256]) {
		return errors.New("Pack 256B independent Range mismatch")
	}
	return casA07Compare(buf, want)
}
func casA07CorruptProbe(f *os.File, entry casA07Item, sample, total int) error {
	one := []byte{0}
	if n, e := f.ReadAt(one, entry.Offset); e != nil || n != 1 {
		return errors.New("cannot read original packed byte")
	}
	original := one[0]
	one[0] ^= 0xff
	w, e := os.OpenFile(f.Name(), os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	if n, e := w.WriteAt(one, entry.Offset); e != nil || n != 1 {
		_ = w.Close()
		return errors.New("cannot damage isolated test Pack")
	}
	if e = w.Sync(); e != nil {
		_ = w.Close()
		return e
	}
	_ = w.Close()
	if e = casA07ReadPacked(f, entry, sample, total, 0); e == nil {
		return errors.New("corrupted source accepted")
	}
	one[0] = original
	w, e = os.OpenFile(f.Name(), os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	if n, e := w.WriteAt(one, entry.Offset); e != nil || n != 1 {
		_ = w.Close()
		return errors.New("cannot restore isolated test Pack")
	}
	if e = w.Sync(); e != nil {
		_ = w.Close()
		return e
	}
	_ = w.Close()
	return casA07ReadPacked(f, entry, sample, total, 0)
}
func casA07Candidate(t *testing.T, root string, sample, total int, reads []int, corrupt *bool) casA07Arm {
	t.Helper()
	if e := os.MkdirAll(root, 0700); e != nil {
		t.Fatal(e)
	}
	var result casA07Arm
	result.Write = casA05Measure(t, func() error { return casA07PackWrite(root, 1, sample, total, nil, nil) })
	head, rows, packed, e := casA07OpenPack(root, total)
	if e != nil {
		t.Fatal(e)
	}
	result.FullAllocated, result.FullObjects, e = casA05Allocated(root)
	if e != nil {
		t.Fatal(e)
	}
	result.Read = casA05Measure(t, func() error {
		for _, index := range reads {
			if e := casA07ReadPacked(packed, rows[index], sample, total, index); e != nil {
				return e
			}
		}
		return nil
	})
	result.Release = casA05Measure(t, func() error { return casA07PackWrite(root, 2, sample, total, packed, rows) })
	result.DuringGCAllocated, _, e = casA05Allocated(root)
	if e != nil {
		t.Fatal(e)
	}
	if e = packed.Close(); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{head.Data, head.Index} {
		if e = os.Remove(filepath.Join(root, name)); e != nil {
			t.Fatal(e)
		}
	}
	if e = casA05SyncDir(root); e != nil {
		t.Fatal(e)
	}
	head2, liveRows, livePack, e := casA07OpenPack(root, total/casA07KeepEvery)
	if e != nil {
		t.Fatal(e)
	}
	result.AfterGCAllocated, result.AfterGCObjects, e = casA05Allocated(root)
	if e != nil {
		t.Fatal(e)
	}
	result.VerifySurvivors = casA05Measure(t, func() error {
		for j, row := range liveRows {
			if e := casA07ReadPacked(livePack, row, sample, total, j*casA07KeepEvery); e != nil {
				return e
			}
		}
		return nil
	})
	if e = casA07CorruptProbe(livePack, liveRows[0], sample, total); e != nil {
		t.Fatal(e)
	}
	*corrupt = true
	if e = livePack.Close(); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"HEAD.json", head2.Data, head2.Index} {
		if e = os.Remove(filepath.Join(root, name)); e != nil {
			t.Fatal(e)
		}
	}
	result.AfterClear, _, e = casA05Allocated(root)
	if e != nil || result.AfterClear != 0 {
		t.Fatalf("pack not reclaimed %d: %v", result.AfterClear, e)
	}
	return result
}
func TestCASA07Real100KMixedSizeImmutableCASVersusOfflinePack(t *testing.T) {
	if os.Getenv("XD_CAS_A07_REAL_MIXED_100K_PERF") != "1" {
		t.Skip("explicit 100k physically mixed-size Local CAS/Pack opt-in")
	}
	name := os.Getenv("XD_CAS_A07_SAMPLE")
	if name != "sample-1" && name != "sample-2" && name != "sample-3" {
		t.Fatal("three independent sample names required")
	}
	sample, _ := strconv.Atoi(strings.TrimPrefix(name, "sample-"))
	total := casA07FullCount
	if os.Getenv("XD_CAS_A07_SMOKE") == "1" {
		total = casA07SmokeCount
	}
	identity, e := casA07SourceID(sample, total)
	if e != nil {
		t.Fatal(e)
	}
	keys, e := casA07PrecomputedKeys(sample, total)
	if e != nil {
		t.Fatal(e)
	}
	readIDs := casA07ReadIndices(total)
	bounds := casA07Counts(total)
	var out casA07Result
	out.Workload = "CAS-A07-100k-physical-mixed-size-original-Local-CAS-versus-offline-pack-95pct-gc"
	out.Sample = sample
	out.SourceIdentitySHA = identity
	out.Count = total
	out.ClassCounts = bounds
	out.ClassSizes = [4]int{1024, 16 << 10, 128 << 10, 1 << 20}
	for i := range bounds {
		out.ClassLogicalBytes[i] = int64(bounds[i]) * int64(out.ClassSizes[i])
		out.LogicalBytes += out.ClassLogicalBytes[i]
	}
	out.Keepers = total / casA07KeepEvery
	out.Removed = total - out.Keepers
	dir := t.TempDir()
	if sample%2 == 0 {
		out.Order = "pack_first"
		out.Candidate = casA07Candidate(t, filepath.Join(dir, "candidate"), sample, total, readIDs, &out.CorruptionRejected)
		out.Original = casA07Original(t, filepath.Join(dir, "baseline"), sample, total, readIDs, keys)
	} else {
		out.Order = "baseline_first"
		out.Original = casA07Original(t, filepath.Join(dir, "baseline"), sample, total, readIDs, keys)
		out.Candidate = casA07Candidate(t, filepath.Join(dir, "candidate"), sample, total, readIDs, &out.CorruptionRejected)
	}
	out.PhysicalRatio = float64(out.Candidate.FullAllocated) / float64(out.Original.FullAllocated)
	out.AfterGCRatio = float64(out.Candidate.AfterGCAllocated) / float64(out.Original.AfterGCAllocated)
	out.PeakRSSKiB = casA05Usage(t).Maxrss
	if out.Original.FullObjects != total || out.Original.AfterGCObjects != out.Keepers ||
		out.Candidate.FullObjects != 3 || out.Candidate.AfterGCObjects != 3 ||
		out.Original.AfterClear != 0 || out.Candidate.AfterClear != 0 ||
		!out.CorruptionRejected || out.Candidate.DuringGCAllocated <= out.Candidate.FullAllocated {
		t.Fatalf("original/pack real 100k integrity or GC invalid: %+v", out)
	}
	if total == casA07FullCount {
		if out.LogicalBytes != 385638400 || out.Original.FullAllocated < 677478400 ||
			out.Candidate.FullAllocated >= out.Original.FullAllocated ||
			out.PhysicalRatio > .75 || out.AfterGCRatio > .75 ||
			out.PeakRSSKiB > 524288 ||
			out.Original.Write.WallMS > 900000 || out.Candidate.Write.WallMS > 900000 ||
			out.Original.Release.WallMS > 900000 || out.Candidate.Release.WallMS > 900000 {
			t.Fatalf("frozen mixed real 100k CAS/Pack original budget failed: %+v", out)
		}
	}
	out.Passed = true
	out.Scope = "Three independent real Linux 100k SHA-distinct mixed 1KiB/16KiB/128KiB/1MiB immutable Local.Put/Open/Delete physical originals vs test-only offline one-pack/48-byte index+HEAD. 2000 class-stratified full SHA/256B Range, 95pct GC, 5pct full survivors SHA, corruption rejection. Does not measure SQL Blob owners, real Push/Pull/WAN, Electron/PWA or production Pack migration."
	raw, e := json.Marshal(out)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("CAS_A07_REAL_MIXED_100K_AB %s", raw)
}
