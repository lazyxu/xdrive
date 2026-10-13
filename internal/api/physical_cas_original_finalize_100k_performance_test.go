//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const (
	p046Total     = 100000
	p046Protected = 5000
	p046Removed   = p046Total - p046Protected
	p046Size      = 1024
	p046BudgetMS  = 900000
)

func p046Bytes(index int, sample string) []byte {
	b := make([]byte, p046Size)
	for block := 0; block < p046Size/sha256.Size; block++ {
		seed := fmt.Sprintf("p046-original-%s-%06d-block-%02d", sample, index, block)
		digest := sha256.Sum256([]byte(seed))
		copy(b[block*sha256.Size:], digest[:])
	}
	return b
}

func p046RSS() (int64, error) {
	buf, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(buf), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(line, "VmRSS:"))
		if len(fields) != 2 || fields[1] != "kB" {
			return 0, fmt.Errorf("invalid VmRSS: %s", line)
		}
		n, err := strconv.ParseInt(fields[0], 10, 64)
		return n * 1024, err
	}
	return 0, fmt.Errorf("native VmRSS unavailable")
}

func p046CPUTicks() (int64, error) {
	buf, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, err
	}
	end := strings.LastIndexByte(string(buf), ')')
	if end < 0 || end+2 >= len(buf) {
		return 0, fmt.Errorf("invalid native CPU stat")
	}
	fields := strings.Fields(string(buf[end+2:]))
	if len(fields) < 13 {
		return 0, fmt.Errorf("incomplete native CPU stat")
	}
	a, err := strconv.ParseInt(fields[11], 10, 64)
	if err != nil {
		return 0, err
	}
	b, err := strconv.ParseInt(fields[12], 10, 64)
	return a + b, err
}

func p046PhysicalInventory(ctx context.Context, store *storage.Local) (int64, int64, error) {
	var count, total int64
	err := store.WalkManagedFiles(ctx, func(f storage.ManagedFile) error {
		if strings.HasPrefix(f.Key, storage.ContentBlobDir+"/sha256/") {
			count++
			total += f.Size
		}
		return nil
	})
	return count, total, err
}

// p046FullPhysicalAudit is outside the measured production finalizer.
// Before: physical filesystem allocation. After: the exact surviving SHA set,
// complete contents of all 5,000 protected CAS objects, and allocated blocks.
func p046FullPhysicalAudit(
	ctx context.Context, store *storage.Local, sample string, after bool,
) (int64, int64, error) {
	var expected map[string]int
	if after {
		expected = make(map[string]int, p046Protected)
		for i := 0; i < p046Total; i += 20 {
			bytes := p046Bytes(i, sample)
			sum := sha256.Sum256(bytes)
			key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", sum[:]))
			if err != nil {
				return 0, 0, err
			}
			expected[key] = i
		}
		if len(expected) != p046Protected {
			return 0, 0, fmt.Errorf("protected CAS SHA identities are not distinct")
		}
	}
	var allocated, verified int64
	err := store.WalkManagedFiles(ctx, func(file storage.ManagedFile) error {
		if !strings.HasPrefix(file.Key, storage.ContentBlobDir+"/sha256/") {
			return nil
		}
		stat, err := os.Stat(filepath.Join(store.FilesystemRoot(), filepath.FromSlash(file.Key)))
		if err != nil {
			return err
		}
		if !stat.Mode().IsRegular() {
			return fmt.Errorf("CAS survivor is not a regular file")
		}
		physical, ok := stat.Sys().(*syscall.Stat_t)
		if !ok {
			return fmt.Errorf("Linux physical CAS block count unavailable")
		}
		allocated += physical.Blocks * 512
		if !after {
			return nil
		}
		index, exists := expected[file.Key]
		if !exists {
			return fmt.Errorf("unexpected surviving CAS object %q", file.Key)
		}
		delete(expected, file.Key)
		handle, err := store.Open(ctx, file.Key)
		if err != nil {
			return err
		}
		actual, readErr := io.ReadAll(io.LimitReader(handle, p046Size+1))
		closeErr := handle.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, p046Bytes(index, sample)) {
			return fmt.Errorf("protected original CAS %d differs from physical source", index)
		}
		verified++
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	if after && (verified != p046Protected || len(expected) != 0) {
		return 0, 0, fmt.Errorf("CAS protected original set incomplete: %d", verified)
	}
	return allocated, verified, nil
}

// This is the production physical original CAS finalizer, AFTER metadata
// reference release. It is NOT DELETE /trash HTTP or full 100k sync/delete.
// All 100k CAS hashes have real distinct payloads and Local.Put files; this
// is NOT 100k rows referencing one physical CAS or the P034 thumbnail cache.
func TestPhysicalCASOriginalFinalize100K(t *testing.T) {
	if os.Getenv("XD_PHYSICAL_CAS_ORIGINAL_FINALIZE_100K_PERF") != "1" {
		t.Skip("set XD_PHYSICAL_CAS_ORIGINAL_FINALIZE_100K_PERF=1")
	}
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	sample := strings.TrimSpace(os.Getenv("XD_PHYSICAL_CAS_ORIGINAL_FINALIZE_100K_SAMPLE"))
	if dsn == "" || !strings.HasPrefix(sample, "sample-") {
		t.Fatal("native PostgreSQL DSN and explicit independent sample required")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.ContentBlob{}, &meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username: "cas-original-" + sample, PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	seedStart := time.Now()
	seen := make(map[string]struct{}, p046Total)
	candidates := make([]contentDeleteCandidate, 0, p046Removed)
	nodes := make([]meta.Node, 0, p046Protected)
	files := make([]meta.File, 0, p046Protected)
	batch := make([]meta.ContentBlob, 0, 500)
	var bytesStored int64
	for i := 0; i < p046Total; i++ {
		payload := p046Bytes(i, sample)
		sum := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", sum[:])
		if _, duplicate := seen[hash]; duplicate {
			t.Fatalf("duplicate original CAS SHA item=%d", i)
		}
		seen[hash] = struct{}{}
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		n, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || n != int64(len(payload)) {
			t.Fatalf("physical Local.Put %d: n=%d err=%v", i, n, err)
		}
		bytesStored += n
		state := meta.ContentBlobStateDeleting
		var refs int64
		if i%20 == 0 {
			refs, state = 1, meta.ContentBlobStateReady
			nodeID := uint64(2000000 + i)
			nodes = append(nodes, meta.Node{
				ID: nodeID, ParentID: &root.ID, OwnerID: user.ID,
				Name: fmt.Sprintf("protected-%06d.bin", i), Type: meta.NodeTypeFile,
				Revision: 1,
			})
			files = append(files, meta.File{
				NodeID: nodeID, SHA256: hash, StorageKey: key, Size: n,
			})
		} else {
			candidates = append(candidates, contentDeleteCandidate{SHA256: hash, StorageKey: key})
		}
		batch = append(batch, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: n, RefCount: refs, State: state,
		})
		if len(batch) == 500 {
			if err := db.CreateInBatches(&batch, 500).Error; err != nil {
				t.Fatal(err)
			}
			batch = batch[:0]
		}
	}
	if len(batch) > 0 {
		if err := db.CreateInBatches(&batch, 500).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.CreateInBatches(&nodes, 500).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.CreateInBatches(&files, 500).Error; err != nil {
		t.Fatal(err)
	}
	if len(seen) != p046Total || len(candidates) != p046Removed ||
		len(files) != p046Protected || bytesStored != p046Total*p046Size {
		t.Fatalf("invalid unique original fixture: %d/%d/%d bytes=%d",
			len(seen), len(candidates), len(files), bytesStored)
	}
	beforeCount, beforeBytes, err := p046PhysicalInventory(ctx, store)
	if err != nil || beforeCount != p046Total || beforeBytes != bytesStored {
		t.Fatalf("original physical count=%d bytes=%d err=%v", beforeCount, beforeBytes, err)
	}
	for _, index := range []int{0, 1, 50000, 50001, 99980, 99999} {
		payload := p046Bytes(index, sample)
		hash := fmt.Sprintf("%x", sha256.Sum256(payload))
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		f, err := store.Open(ctx, key)
		if err != nil {
			t.Fatalf("seeded original %d absent: %v", index, err)
		}
		actual, readErr := io.ReadAll(f)
		closeErr := f.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, payload) {
			t.Fatalf("original CAS %d content not verified: read=%v close=%v", index, readErr, closeErr)
		}
	}
	blocksBefore, _, beforeAuditErr := p046FullPhysicalAudit(ctx, store, sample, false)
	if beforeAuditErr != nil || blocksBefore <= 0 {
		t.Fatalf("initial source CAS allocated blocks unavailable: %d error=%v", blocksBefore, beforeAuditErr)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	runtime.GC()
	baseRSS, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	var peak atomic.Int64
	peak.Store(baseRSS)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				n, err := p046RSS()
				if err == nil {
					for {
						old := peak.Load()
						if n <= old || peak.CompareAndSwap(old, n) {
							break
						}
					}
				}
			}
		}
	}()
	server := &Server{DB: db, Store: store}
	start := time.Now()
	releaseErr := server.finalizeContentBlobDeletes(ctx, candidates)
	durationMS := float64(time.Since(start).Microseconds()) / 1000
	close(stop)
	<-done
	lastRSS, rssErr := p046RSS()
	if rssErr != nil {
		t.Fatal(rssErr)
	}
	if lastRSS > peak.Load() {
		peak.Store(lastRSS)
	}
	cpuAfter, cpuErr := p046CPUTicks()
	if cpuErr != nil {
		t.Fatal(cpuErr)
	}
	cpuDelta := cpuAfter - cpuBefore
	rssDelta := max(int64(0), peak.Load()-baseRSS)
	afterCount, afterBytes, walkErr := p046PhysicalInventory(ctx, store)
	physicalAuditStarted := time.Now()
	blocksAfter, allProtected, physicalAuditErr := p046FullPhysicalAudit(ctx, store, sample, true)
	physicalAuditMS := float64(time.Since(physicalAuditStarted).Microseconds()) / 1000
	var remain, dirty, fileRefs int64
	remainErr := db.Model(&meta.ContentBlob{}).Count(&remain).Error
	dirtyErr := db.Model(&meta.ContentBlob{}).
		Where("ref_count = 0 OR state <> ?", meta.ContentBlobStateReady).
		Count(&dirty).Error
	fileErr := db.Model(&meta.File{}).Count(&fileRefs).Error
	protectedCorrect, reclaimedGone := true, true
	for _, index := range []int{0, 1, 50000, 50001, 99980, 99999} {
		payload := p046Bytes(index, sample)
		hash := fmt.Sprintf("%x", sha256.Sum256(payload))
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		f, openErr := store.Open(ctx, key)
		if index%20 == 0 {
			if openErr != nil {
				protectedCorrect = false
				continue
			}
			actual, readErr := io.ReadAll(f)
			closeErr := f.Close()
			if readErr != nil || closeErr != nil || !bytes.Equal(actual, payload) {
				protectedCorrect = false
			}
		} else if openErr == nil {
			reclaimedGone = false
			_ = f.Close()
		}
	}
	passed := releaseErr == nil && walkErr == nil && remainErr == nil &&
		dirtyErr == nil && fileErr == nil &&
		afterCount == p046Protected && afterBytes == p046Protected*p046Size &&
		remain == p046Protected && dirty == 0 && fileRefs == p046Protected &&
		protectedCorrect && reclaimedGone &&
		physicalAuditErr == nil && allProtected == p046Protected &&
		blocksAfter > 0 && blocksBefore > blocksAfter &&
		cpuDelta >= 0 && durationMS > 0 && durationMS <= p046BudgetMS &&
		rssDelta <= 268435456
	result := map[string]any{
		"workload": "P046-physical-original-CAS-finalize-100k",
		"sample":   sample, "status": "CURRENT-BEFORE only / unchanged production",
		"physical_originals": p046Total, "distinct_SHA256": len(seen),
		"actual_original_bytes": bytesStored, "protected_references": p046Protected,
		"deleting_originals":    p046Removed,
		"before_physical_count": beforeCount, "after_physical_count": afterCount,
		"before_physical_bytes": beforeBytes, "after_physical_bytes": afterBytes,
		"physically_deleted_objects": beforeCount - afterCount,
		"physically_deleted_bytes":   beforeBytes - afterBytes,
		"remaining_CAS_DB_rows":      remain, "remaining_deleting_CAS": dirty,
		"protected_File_DB_rows":            fileRefs,
		"protected_original_bytes_verified": protectedCorrect,
		"reclaimed_original_samples_absent": reclaimedGone,
		"fixture_seed_ms_excluded":          seedMS, "measured_finalize_ms": durationMS,
		"Go_cpu_ticks_measured": cpuDelta, "Go_RSS_pre_B": baseRSS,
		"Go_RSS_peak_B": peak.Load(), "Go_RSS_peak_growth_B": rssDelta,
		"frozen_finalize_budget_ms":  p046BudgetMS,
		"frozen_RSS_growth_budget_B": int64(268435456),
		"finalization_error":         fmt.Sprint(releaseErr), "passed": passed,
		"boundary": "Real 100k distinct original CAS files; production Server.finalizeContentBlobDeletes and Local.Delete on 95k already-unreferenced originals. Not 100k authenticated HTTP permanent delete, not 100k original uploads/sync, not codecs, not PWA.",
	}
	result["protected_originals_complete_verified"] = allProtected
	result["exact_protected_SHA_set_verified"] = physicalAuditErr == nil && allProtected == p046Protected
	result["allocated_disk_blocks_before_B"] = blocksBefore
	result["allocated_disk_blocks_after_B"] = blocksAfter
	result["allocated_disk_blocks_reclaimed_B"] = blocksBefore - blocksAfter
	result["physical_audit_ms_excluded"] = physicalAuditMS
	result["physical_audit_error"] = fmt.Sprint(physicalAuditErr)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CAS_PHYSICAL_FINALIZE_100K %s", raw)
	if !passed {
		t.Fatalf("P046 failed original frozen performance/correctness contract: %s", raw)
	}
}
