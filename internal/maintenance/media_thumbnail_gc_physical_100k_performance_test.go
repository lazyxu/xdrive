package maintenance

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const (
	physicalThumbnailGCFiles100K = 100000
	physicalThumbnailGCProtected = 2500
	physicalThumbnailGCYoung     = 2500
	physicalThumbnailGCOrphan    = physicalThumbnailGCFiles100K - physicalThumbnailGCProtected - physicalThumbnailGCYoung
)

func physicalThumbnailGCReadRSS() (int64, error) {
	content, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(content), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(line, "VmRSS:"))
		if len(fields) != 2 || fields[1] != "kB" {
			return 0, fmt.Errorf("invalid native VmRSS %q", line)
		}
		kib, err := strconv.ParseInt(fields[0], 10, 64)
		return kib * 1024, err
	}
	return 0, fmt.Errorf("native Linux VmRSS is unavailable")
}

func physicalThumbnailGCReadCPUTicks() (int64, error) {
	content, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, err
	}
	afterName := strings.LastIndexByte(string(content), ')')
	if afterName < 0 || afterName+2 >= len(content) {
		return 0, fmt.Errorf("native /proc/self/stat malformed")
	}
	fields := strings.Fields(string(content[afterName+2:]))
	if len(fields) < 13 {
		return 0, fmt.Errorf("native process CPU tick fields missing")
	}
	userTicks, err := strconv.ParseInt(fields[11], 10, 64)
	if err != nil {
		return 0, err
	}
	systemTicks, err := strconv.ParseInt(fields[12], 10, 64)
	return userTicks + systemTicks, err
}

// TestMediaThumbnailGCPhysical100K isolates the actual physical derivative
// cache cleanup. It does NOT claim the original CAS blobs or durable file
// deletion were collected. All 100k entries are independently materialized
// filesystem paths containing the same small, VALID JPEG test image.
// The first 2,500 are referenced by actual PostgreSQL MediaMetadata rows;
// the final 2,500 are young, and the other 95,000 are old unreferenced caches.
func TestMediaThumbnailGCPhysical100K(t *testing.T) {
	if os.Getenv("XD_MEDIA_THUMBNAIL_GC_PHYSICAL_100K_PERF") != "1" {
		t.Skip("explicit opt-in required for 100k physical cache file benchmark")
	}
	if strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL")) == "" {
		t.Fatal("native PostgreSQL17 test DSN required")
	}
	db := openThumbnailGCTestDB(t)
	root := t.TempDir()
	ctx := t.Context()

	user := meta.User{
		Username: "physical-thumbnail-gc-100k-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	// Fixture-only SQL bulk insert is NOT part of the measured GC. Use exact
	// primary IDs so every protected cache has a genuine metadata owner.
	if err := db.Exec(`INSERT INTO xd_nodes
		(id, parent_id, name, type, owner_id, revision, created_at, updated_at)
		SELECT 1000000 + gs, ?, 'gc-protected-' || gs::text, 'file', ?, 1, NOW(), NOW()
		FROM generate_series(1, ?) AS gs`,
		folder.ID, user.ID, physicalThumbnailGCProtected).Error; err != nil {
		t.Fatal(err)
	}

	img := image.NewNRGBA(image.Rect(0, 0, 12, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 12; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 17) % 255), G: uint8((y * 31) % 255),
				B: 127, A: 255,
			})
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 82}); err != nil {
		t.Fatal(err)
	}
	payload := encoded.Bytes()
	if len(payload) < 300 {
		t.Fatal("invalid authentic JPEG cache payload")
	}

	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	casSentinels := make(map[string][]byte, 3)
	for index := 0; index < 3; index++ {
		data := []byte(fmt.Sprintf("independent-owner-CAS-original-sentinel-%d", index))
		hash := fmt.Sprintf("%x", sha256.Sum256(data))
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		n, err := store.Put(ctx, key, bytes.NewReader(data))
		if err != nil || n != int64(len(data)) {
			t.Fatalf("sentinel CAS original PUT n=%d error=%v", n, err)
		}
		casSentinels[key] = data
	}

	seedStarted := time.Now()
	stale := time.Now().UTC().Add(-MediaThumbnailGCMinAge - time.Hour)
	young := time.Now().UTC()
	provenKeys := make([]string, 0, 6)
	folderPaths := make(map[string]struct{}, 256)
	references := make([]meta.MediaMetadata, 0, physicalThumbnailGCProtected)
	var writtenBytes int64
	for i := 0; i < physicalThumbnailGCFiles100K; i++ {
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("physical-cache-%06d", i))))
		id := uint64(1000001 + i)
		key := mediapkg.ThumbnailStorageKey(id, 1, hash, mediapkg.DefaultThumbnailEdge)
		full := thumbnailGCTestPath(root, key)
		dir := filepath.Dir(full)
		if _, exists := folderPaths[dir]; !exists {
			if err := os.MkdirAll(dir, 0o750); err != nil {
				t.Fatal(err)
			}
			folderPaths[dir] = struct{}{}
		}
		if err := os.WriteFile(full, payload, 0o640); err != nil {
			t.Fatal(err)
		}
		mtime := stale
		if i >= physicalThumbnailGCFiles100K-physicalThumbnailGCYoung {
			mtime = young
		}
		if err := os.Chtimes(full, mtime, mtime); err != nil {
			t.Fatal(err)
		}
		writtenBytes += int64(len(payload))
		if i < physicalThumbnailGCProtected {
			references = append(references, meta.MediaMetadata{
				NodeID: id, OwnerID: user.ID, NodeRevision: 1, SHA256: hash,
				MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
				ThumbnailKey: key, ThumbnailMIMEType: "image/jpeg",
				ThumbnailWidth: 12, ThumbnailHeight: 8,
				IndexState: meta.MediaIndexStateReady,
			})
		}
		if i == 0 || i == physicalThumbnailGCProtected-1 ||
			i == physicalThumbnailGCProtected || i == physicalThumbnailGCFiles100K/2 ||
			i == physicalThumbnailGCFiles100K-physicalThumbnailGCYoung ||
			i == physicalThumbnailGCFiles100K-1 {
			provenKeys = append(provenKeys, key)
		}
	}
	if err := db.CreateInBatches(&references, 250).Error; err != nil {
		t.Fatal(err)
	}
	for _, index := range []int{0, 1, 2, 3, 4, 5} {
		file, err := os.Open(thumbnailGCTestPath(root, provenKeys[index]))
		if err != nil {
			t.Fatal(err)
		}
		conf, decodeErr := jpeg.DecodeConfig(file)
		_ = file.Close()
		if decodeErr != nil || conf.Width != 12 || conf.Height != 8 {
			t.Fatalf("physical JPEG decode %d: %+v err=%v", index, conf, decodeErr)
		}
	}
	if err := db.Exec("ANALYZE xd_media_metadata").Error; err != nil {
		t.Fatal(err)
	}
	if writtenBytes != int64(physicalThumbnailGCFiles100K*len(payload)) ||
		len(folderPaths) < 100 {
		t.Fatalf("physical cache bytes/real-shard counts wrong: %d folders=%d", writtenBytes, len(folderPaths))
	}
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000

	baselineRSS, err := physicalThumbnailGCReadRSS()
	if err != nil {
		t.Fatal(err)
	}
	beforeCPUTicks, err := physicalThumbnailGCReadCPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	var peakRSS atomic.Int64
	peakRSS.Store(baselineRSS)
	monitorStop := make(chan struct{})
	monitorDone := make(chan struct{})
	go func() {
		defer close(monitorDone)
		tick := time.NewTicker(30 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-monitorStop:
				return
			case <-tick.C:
				current, err := physicalThumbnailGCReadRSS()
				if err != nil {
					continue
				}
				for {
					prior := peakRSS.Load()
					if current <= prior || peakRSS.CompareAndSwap(prior, current) {
						break
					}
				}
			}
		}
	}()

	runCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	dryStarted := time.Now()
	dry, dryErr := GarbageCollectMediaThumbnails(runCtx, db, root, true)
	dryMS := float64(time.Since(dryStarted).Microseconds()) / 1000
	applyStarted := time.Now()
	var applied MediaThumbnailGCReport
	var appliedErr error
	if dryErr == nil {
		applied, appliedErr = GarbageCollectMediaThumbnails(runCtx, db, root, false)
	}
	applyMS := float64(time.Since(applyStarted).Microseconds()) / 1000
	idempotentStarted := time.Now()
	var again MediaThumbnailGCReport
	var againErr error
	if dryErr == nil && appliedErr == nil {
		again, againErr = GarbageCollectMediaThumbnails(runCtx, db, root, false)
	}
	idempotentMS := float64(time.Since(idempotentStarted).Microseconds()) / 1000
	close(monitorStop)
	<-monitorDone
	afterCPUTicks, err := physicalThumbnailGCReadCPUTicks()
	if err != nil {
		t.Fatal(err)
	}

	referencedRemain, youngRemain, removedOld := true, true, true
	for _, i := range []int{0, 1} {
		if _, err := os.Stat(thumbnailGCTestPath(root, provenKeys[i])); err != nil {
			referencedRemain = false
		}
	}
	for _, i := range []int{4, 5} {
		if _, err := os.Stat(thumbnailGCTestPath(root, provenKeys[i])); err != nil {
			youngRemain = false
		}
	}
	for _, i := range []int{2, 3} {
		if _, err := os.Stat(thumbnailGCTestPath(root, provenKeys[i])); !os.IsNotExist(err) {
			removedOld = false
		}
	}
	originalCASIntact := true
	for key, expected := range casSentinels {
		f, err := store.Open(ctx, key)
		if err != nil {
			originalCASIntact = false
			break
		}
		data, readErr := io.ReadAll(f)
		_ = f.Close()
		if readErr != nil || !bytes.Equal(data, expected) {
			originalCASIntact = false
			break
		}
	}
	var referenceRows int64
	if err := db.Model(&meta.MediaMetadata{}).Count(&referenceRows).Error; err != nil {
		t.Fatal(err)
	}
	peakGrowth := max(int64(0), peakRSS.Load()-baselineRSS)
	result := map[string]any{
		"workload":                              "100k-real-physical-derived-thumbnail-GC-local-PostgreSQL17",
		"physical_cache_files":                  physicalThumbnailGCFiles100K,
		"physically_stored_cache_bytes":         writtenBytes,
		"valid_jpeg_payload_size":               len(payload),
		"protected_references":                  physicalThumbnailGCProtected,
		"young_unreferenced":                    physicalThumbnailGCYoung,
		"old_orphans":                           physicalThumbnailGCOrphan,
		"sharded_directories":                   len(folderPaths),
		"physical_sentinel_original_CAS_intact": originalCASIntact,
		"seed_ms_excluded":                      seedMS,
		"dry_run_ms":                            dryMS,
		"dry_scanned":                           dry.ScannedFiles,
		"dry_candidates":                        dry.CandidateFiles,
		"dry_candidate_bytes":                   dry.CandidateBytes,
		"apply_ms":                              applyMS,
		"live_scanned":                          applied.ScannedFiles,
		"live_candidates":                       applied.CandidateFiles,
		"actual_unlinked":                       applied.DeletedFiles,
		"actual_unlinked_bytes":                 applied.DeletedBytes,
		"idempotent_ms":                         idempotentMS,
		"second_candidates":                     again.CandidateFiles,
		"reference_rows_after":                  referenceRows,
		"referenced_preserved":                  referencedRemain,
		"young_preserved":                       youngRemain,
		"old_orphans_absent":                    removedOld,
		"sample_physical_jpeg_decodes":          len(provenKeys),
		"go_postseed_rss_growth_bytes":          peakGrowth,
		"native_go_process_cpu_ticks":           afterCPUTicks - beforeCPUTicks,
		"errors":                                []string{fmt.Sprint(dryErr), fmt.Sprint(appliedErr), fmt.Sprint(againErr)},
		"budget":                                "dry<=30000ms live unlink 95000<=180000ms idempotent<=30000ms Go RSS growth<=256MiB, all preserve and GC counts exact",
		"limits":                                "Real filesystem 100k thumbnail caches with same small valid encoded JPEG payload, 95k old unreferenced deleted; 2500 actual protected PostgreSQL references and 2500 young remain. NOT original 100k CAS blob deletion, not sync, WAN, Desktop or user HTTP.",
	}
	b, _ := json.Marshal(result)
	t.Logf("MEDIA_THUMBNAIL_GC_PHYSICAL_100K %s", b)
	if dryErr != nil || appliedErr != nil || againErr != nil ||
		dry.ScannedFiles != physicalThumbnailGCFiles100K ||
		dry.CandidateFiles != physicalThumbnailGCOrphan ||
		dry.DeletedFiles != 0 ||
		applied.ScannedFiles != physicalThumbnailGCFiles100K ||
		applied.CandidateFiles != physicalThumbnailGCOrphan ||
		applied.DeletedFiles != physicalThumbnailGCOrphan ||
		applied.DeletedBytes != int64(physicalThumbnailGCOrphan*len(payload)) ||
		again.CandidateFiles != 0 || again.DeletedFiles != 0 ||
		referenceRows != physicalThumbnailGCProtected ||
		!referencedRemain || !youngRemain || !removedOld || !originalCASIntact ||
		dryMS > 30000 || applyMS > 180000 || idempotentMS > 30000 ||
		peakGrowth > 256*1024*1024 {
		t.Fatalf("true 100k physically stored thumbnail-cache GC first-red: %s", b)
	}
}
