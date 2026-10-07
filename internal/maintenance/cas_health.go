package maintenance

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const CASDeletingStaleAfter = time.Hour

type CASHealthReport struct {
	Status             string    `json:"status"`
	Healthy            bool      `json:"healthy"`
	ReadyBlobs         int64     `json:"ready_blobs"`
	DeletingBlobs      int64     `json:"deleting_blobs"`
	StaleDeletingBlobs int64     `json:"stale_deleting_blobs"`
	MissingMetadata    int64     `json:"missing_metadata"`
	RefCountMismatches int64     `json:"refcount_mismatches"`
	StateMismatches    int64     `json:"state_mismatches"`
	SizeMismatches     int64     `json:"size_mismatches"`
	KeyHashMismatches  int64     `json:"key_hash_mismatches"`
	InvalidStates      int64     `json:"invalid_states"`
	GeneratedAt        time.Time `json:"generated_at"`
}

func (r CASHealthReport) OK() bool {
	return r.MissingMetadata == 0 &&
		r.RefCountMismatches == 0 &&
		r.StateMismatches == 0 &&
		r.SizeMismatches == 0 &&
		r.KeyHashMismatches == 0 &&
		r.InvalidStates == 0
}

func CASHealth(db *gorm.DB, staleAfter time.Duration) (CASHealthReport, error) {
	var report CASHealthReport
	if staleAfter <= 0 {
		staleAfter = CASDeletingStaleAfter
	}
	const query = `WITH refs_raw AS (
  SELECT storage_key, size FROM xd_files WHERE storage_key LIKE ?
  UNION ALL
  SELECT storage_key, size FROM xd_file_versions WHERE storage_key LIKE ?
),
refs AS (
  SELECT storage_key, COUNT(*) AS ref_count, MIN(size) AS min_size, MAX(size) AS max_size
  FROM refs_raw
  GROUP BY storage_key
),
blobs AS (
  SELECT sha256, storage_key, size, ref_count, state, updated_at
  FROM xd_content_blobs
)
SELECT
  COALESCE((SELECT COUNT(*) FROM blobs WHERE state = ?), 0),
  COALESCE((SELECT COUNT(*) FROM blobs WHERE state = ?), 0),
  COALESCE((SELECT COUNT(*) FROM blobs WHERE state = ? AND updated_at < NOW() - (? * interval '1 second')), 0),
  COALESCE((SELECT COUNT(*) FROM refs r LEFT JOIN blobs b ON b.storage_key = r.storage_key WHERE b.sha256 IS NULL), 0),
  COALESCE((SELECT COUNT(*) FROM blobs b LEFT JOIN refs r ON r.storage_key = b.storage_key WHERE b.ref_count <> COALESCE(r.ref_count, 0)), 0),
  COALESCE((SELECT COUNT(*) FROM blobs b LEFT JOIN refs r ON r.storage_key = b.storage_key
    WHERE CASE WHEN COALESCE(r.ref_count, 0) > 0 THEN b.state <> ? ELSE b.state <> ? END), 0),
  COALESCE((SELECT COUNT(*) FROM blobs b JOIN refs r ON r.storage_key = b.storage_key
    WHERE r.min_size <> r.max_size OR b.size <> r.max_size), 0),
  COALESCE((SELECT COUNT(*) FROM blobs b
    WHERE lower(b.sha256) !~ '^[0-9a-f]{64}$'
       OR b.storage_key <> ? || substring(lower(b.sha256) from 1 for 2) || '/' || lower(b.sha256)), 0),
  COALESCE((SELECT COUNT(*) FROM blobs WHERE state NOT IN (?, ?)), 0)
`
	pattern := storage.ContentBlobDir + "/sha256/%"
	prefix := storage.ContentBlobDir + "/sha256/"
	row := db.Raw(
		query,
		pattern, pattern,
		meta.ContentBlobStateReady,
		meta.ContentBlobStateDeleting,
		meta.ContentBlobStateDeleting, int64(staleAfter/time.Second),
		meta.ContentBlobStateReady, meta.ContentBlobStateDeleting,
		prefix,
		meta.ContentBlobStateReady, meta.ContentBlobStateDeleting,
	).Row()
	if err := row.Scan(
		&report.ReadyBlobs,
		&report.DeletingBlobs,
		&report.StaleDeletingBlobs,
		&report.MissingMetadata,
		&report.RefCountMismatches,
		&report.StateMismatches,
		&report.SizeMismatches,
		&report.KeyHashMismatches,
		&report.InvalidStates,
	); err != nil {
		return CASHealthReport{}, err
	}
	report.Healthy = report.OK()
	switch {
	case !report.Healthy:
		report.Status = "fail"
	case report.StaleDeletingBlobs > 0:
		report.Status = "warning"
	default:
		report.Status = "ok"
	}
	report.GeneratedAt = time.Now().UTC()
	return report, nil
}

type CASRepairAction struct {
	Kind             string `json:"kind"`
	SHA256           string `json:"sha256"`
	StorageKey       string `json:"storage_key"`
	SourceStorageKey string `json:"source_storage_key,omitempty"`
	BeforeRefCount   int64  `json:"before_ref_count"`
	AfterRefCount    int64  `json:"after_ref_count"`
	BeforeState      string `json:"before_state,omitempty"`
	AfterState       string `json:"after_state"`
	Applied          bool   `json:"applied"`
}

type CASRepairSkip struct {
	SHA256     string `json:"sha256,omitempty"`
	StorageKey string `json:"storage_key"`
	Reason     string `json:"reason"`
}

type CASRepairReport struct {
	DryRun      bool              `json:"dry_run"`
	Before      CASHealthReport   `json:"before"`
	After       CASHealthReport   `json:"after"`
	Actions     []CASRepairAction `json:"actions"`
	Skipped     []CASRepairSkip   `json:"skipped"`
	GeneratedAt time.Time         `json:"generated_at"`
}

type casRefSummary struct {
	StorageKey string
	RefCount   int64
	MinSize    int64
	MaxSize    int64
}

func RepairStorage(ctx context.Context, db *gorm.DB, storageRoot string, dryRun bool) (CASRepairReport, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return CASRepairReport{}, err
	}
	if db == nil {
		return CASRepairReport{}, fmt.Errorf("storage repair database is unavailable")
	}
	before, err := CASHealth(db.WithContext(ctx), CASDeletingStaleAfter)
	if err != nil {
		return CASRepairReport{}, err
	}
	report := CASRepairReport{DryRun: dryRun, Before: before}

	legacyRefs, err := loadLegacyRefSummaries(db.WithContext(ctx))
	if err != nil {
		return report, err
	}
	for _, ref := range legacyRefs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		action, skip, err := migrateLegacyReferenceSet(ctx, db, storageRoot, ref, dryRun)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return report, err
			}
			report.Skipped = append(report.Skipped, CASRepairSkip{
				StorageKey: ref.StorageKey,
				Reason:     "legacy_migration_failed: " + err.Error(),
			})
			continue
		}
		if action.Kind != "" {
			report.Actions = append(report.Actions, action)
		}
		if skip != nil {
			report.Skipped = append(report.Skipped, *skip)
		}
	}

	casReport, err := RepairCASMetadata(ctx, db, storageRoot, dryRun)
	if err != nil {
		return report, err
	}
	report.Actions = append(report.Actions, casReport.Actions...)
	report.Skipped = append(report.Skipped, casReport.Skipped...)
	report.After = casReport.After
	report.GeneratedAt = time.Now().UTC()

	sort.Slice(report.Actions, func(i, j int) bool {
		if report.Actions[i].StorageKey != report.Actions[j].StorageKey {
			return report.Actions[i].StorageKey < report.Actions[j].StorageKey
		}
		return report.Actions[i].Kind < report.Actions[j].Kind
	})
	sort.Slice(report.Skipped, func(i, j int) bool {
		if report.Skipped[i].StorageKey != report.Skipped[j].StorageKey {
			return report.Skipped[i].StorageKey < report.Skipped[j].StorageKey
		}
		return report.Skipped[i].Reason < report.Skipped[j].Reason
	})
	return report, nil
}

func loadLegacyRefSummaries(db *gorm.DB) ([]casRefSummary, error) {
	const query = `SELECT storage_key, COUNT(*) AS ref_count, MIN(size) AS min_size, MAX(size) AS max_size
FROM (
  SELECT storage_key, size FROM xd_files WHERE storage_key NOT LIKE ?
  UNION ALL
  SELECT storage_key, size FROM xd_file_versions WHERE storage_key NOT LIKE ?
) refs
GROUP BY storage_key
ORDER BY storage_key ASC`
	pattern := storage.ContentBlobDir + "/sha256/%"
	var refs []casRefSummary
	if err := db.Raw(query, pattern, pattern).Scan(&refs).Error; err != nil {
		return nil, err
	}
	return refs, nil
}

func legacyObjectIdentity(ctx context.Context, storageRoot string, ref casRefSummary) (string, string, error) {
	if ref.RefCount <= 0 || ref.MinSize < 0 || ref.MinSize != ref.MaxSize {
		return "", "", fmt.Errorf("conflicting_reference_sizes")
	}
	key, err := cleanStorageKey(ref.StorageKey)
	if err != nil {
		return "", "", err
	}
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return "", "", err
	}
	full := filepath.Join(root, filepath.FromSlash(key))
	info, err := os.Stat(full)
	if err != nil {
		return "", "", err
	}
	if !info.Mode().IsRegular() {
		return "", "", fmt.Errorf("not a regular file")
	}
	if info.Size() != ref.MaxSize {
		return "", "", fmt.Errorf("size mismatch: got %d want %d", info.Size(), ref.MaxSize)
	}
	hash, err := hashFileWithContext(ctx, full)
	if err != nil {
		return "", "", err
	}
	canonicalKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		return "", "", err
	}
	return hash, canonicalKey, nil
}

func ensureCanonicalLegacyObject(
	ctx context.Context,
	storageRoot, sourceKey, canonicalKey string,
	expectedSize int64,
	expectedHash string,
) (bool, error) {
	sourceClean, err := cleanStorageKey(sourceKey)
	if err != nil {
		return false, err
	}
	canonicalClean, err := cleanStorageKey(canonicalKey)
	if err != nil {
		return false, err
	}
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return false, err
	}
	sourcePath := filepath.Join(root, filepath.FromSlash(sourceClean))
	canonicalPath := filepath.Join(root, filepath.FromSlash(canonicalClean))

	if err := verifyCASObjectWithContext(ctx, storageRoot, canonicalClean, expectedSize, expectedHash); err == nil {
		return false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		if _, statErr := os.Stat(canonicalPath); statErr == nil {
			return false, fmt.Errorf("existing canonical blob is invalid: %w", err)
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return false, statErr
		}
	}

	if err := os.MkdirAll(filepath.Dir(canonicalPath), 0o750); err != nil {
		return false, err
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return false, err
	}
	defer source.Close()

	target, err := os.OpenFile(canonicalPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			if verifyErr := verifyCASObjectWithContext(ctx, storageRoot, canonicalClean, expectedSize, expectedHash); verifyErr != nil {
				return false, fmt.Errorf("concurrent canonical blob is invalid: %w", verifyErr)
			}
			return false, nil
		}
		return false, err
	}

	cleanup := true
	defer func() {
		if cleanup {
			_ = target.Close()
			_ = os.Remove(canonicalPath)
		}
	}()

	buf := make([]byte, 128*1024)
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		n, readErr := source.Read(buf)
		if n > 0 {
			written := 0
			for written < n {
				count, writeErr := target.Write(buf[written:n])
				if writeErr != nil {
					return false, writeErr
				}
				if count <= 0 {
					return false, io.ErrShortWrite
				}
				written += count
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return false, readErr
		}
	}
	if err := target.Sync(); err != nil {
		return false, err
	}
	if err := target.Close(); err != nil {
		return false, err
	}
	if err := verifyCASObjectWithContext(ctx, storageRoot, canonicalClean, expectedSize, expectedHash); err != nil {
		return false, fmt.Errorf("copied canonical blob verification failed: %w", err)
	}
	cleanup = false
	return true, nil
}

func removeCreatedCanonicalIfUnreferenced(ctx context.Context, db *gorm.DB, storageRoot, canonicalKey string) {
	ref, err := loadCASRefSummary(db.WithContext(ctx), canonicalKey)
	if err != nil || ref.RefCount != 0 {
		return
	}
	var metadata int64
	if err := db.WithContext(ctx).Model(&meta.ContentBlob{}).
		Where("storage_key = ?", canonicalKey).
		Count(&metadata).Error; err != nil || metadata != 0 {
		return
	}
	clean, err := cleanStorageKey(canonicalKey)
	if err != nil {
		return
	}
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return
	}
	_ = os.Remove(filepath.Join(root, filepath.FromSlash(clean)))
}

func migrateLegacyReferenceSet(
	ctx context.Context,
	db *gorm.DB,
	storageRoot string,
	ref casRefSummary,
	dryRun bool,
) (CASRepairAction, *CASRepairSkip, error) {
	hash, canonicalKey, err := legacyObjectIdentity(ctx, storageRoot, ref)
	if err != nil {
		return CASRepairAction{}, &CASRepairSkip{
			StorageKey: ref.StorageKey,
			Reason:     "legacy_object_not_verified: " + err.Error(),
		}, nil
	}

	currentCanonical, err := loadCASRefSummary(db.WithContext(ctx), canonicalKey)
	if err != nil {
		return CASRepairAction{}, nil, err
	}
	if currentCanonical.RefCount > 0 &&
		(currentCanonical.MinSize != ref.MaxSize || currentCanonical.MaxSize != ref.MaxSize) {
		return CASRepairAction{}, &CASRepairSkip{
			SHA256: hash, StorageKey: ref.StorageKey,
			Reason: "canonical_reference_sizes_conflict",
		}, nil
	}

	action := CASRepairAction{
		Kind:             "migrate_legacy",
		SHA256:           hash,
		StorageKey:       canonicalKey,
		SourceStorageKey: ref.StorageKey,
		BeforeRefCount:   currentCanonical.RefCount,
		AfterRefCount:    currentCanonical.RefCount + ref.RefCount,
		AfterState:       meta.ContentBlobStateReady,
		Applied:          !dryRun,
	}
	if dryRun {
		cleanCanonical, cleanErr := cleanStorageKey(canonicalKey)
		if cleanErr != nil {
			return CASRepairAction{}, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: cleanErr.Error()}, nil
		}
		root, rootErr := filepath.Abs(storageRoot)
		if rootErr != nil {
			return CASRepairAction{}, nil, rootErr
		}
		canonicalPath := filepath.Join(root, filepath.FromSlash(cleanCanonical))
		if _, statErr := os.Stat(canonicalPath); statErr == nil {
			if verifyErr := verifyCASObjectWithContext(ctx, storageRoot, canonicalKey, ref.MaxSize, hash); verifyErr != nil {
				return CASRepairAction{}, &CASRepairSkip{
					SHA256: hash, StorageKey: ref.StorageKey,
					Reason: "existing_canonical_blob_invalid: " + verifyErr.Error(),
				}, nil
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return CASRepairAction{}, nil, statErr
		}
		return action, nil, nil
	}

	created, err := ensureCanonicalLegacyObject(ctx, storageRoot, ref.StorageKey, canonicalKey, ref.MaxSize, hash)
	if err != nil {
		return CASRepairAction{}, &CASRepairSkip{
			SHA256: hash, StorageKey: ref.StorageKey,
			Reason: "canonical_copy_failed: " + err.Error(),
		}, nil
	}

	var committedRefCount int64
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCASHash(tx, "legacy:"+ref.StorageKey); err != nil {
			return err
		}
		if err := lockCASHash(tx, hash); err != nil {
			return err
		}

		currentLegacy, err := loadCASRefSummary(tx, ref.StorageKey)
		if err != nil {
			return err
		}
		if currentLegacy.RefCount != ref.RefCount ||
			currentLegacy.MinSize != ref.MinSize ||
			currentLegacy.MaxSize != ref.MaxSize {
			return fmt.Errorf("legacy reference set changed during repair")
		}
		currentCAS, err := loadCASRefSummary(tx, canonicalKey)
		if err != nil {
			return err
		}
		if currentCAS.RefCount > 0 &&
			(currentCAS.MinSize != ref.MaxSize || currentCAS.MaxSize != ref.MaxSize) {
			return fmt.Errorf("canonical reference sizes conflict")
		}
		if err := verifyCASObjectWithContext(ctx, storageRoot, canonicalKey, ref.MaxSize, hash); err != nil {
			return fmt.Errorf("canonical blob changed during repair: %w", err)
		}

		var blob meta.ContentBlob
		blobErr := tx.Where("sha256 = ?", hash).First(&blob).Error
		if blobErr == nil {
			if blob.StorageKey != canonicalKey || blob.Size != ref.MaxSize {
				return fmt.Errorf("content blob identity conflicts with legacy migration")
			}
		} else if !errors.Is(blobErr, gorm.ErrRecordNotFound) {
			return blobErr
		} else {
			var keyCount int64
			if err := tx.Model(&meta.ContentBlob{}).
				Where("storage_key = ?", canonicalKey).
				Count(&keyCount).Error; err != nil {
				return err
			}
			if keyCount != 0 {
				return fmt.Errorf("canonical storage key is already bound to another hash")
			}
		}

		fileResult := tx.Model(&meta.File{}).
			Where("storage_key = ?", ref.StorageKey).
			Updates(map[string]any{"storage_key": canonicalKey, "sha256": hash})
		if fileResult.Error != nil {
			return fileResult.Error
		}
		versionResult := tx.Model(&meta.FileVersion{}).
			Where("storage_key = ?", ref.StorageKey).
			Updates(map[string]any{"storage_key": canonicalKey, "sha256": hash})
		if versionResult.Error != nil {
			return versionResult.Error
		}
		if fileResult.RowsAffected+versionResult.RowsAffected != ref.RefCount {
			return fmt.Errorf("legacy reference count changed during update")
		}

		committedRefCount = currentCAS.RefCount + ref.RefCount
		if errors.Is(blobErr, gorm.ErrRecordNotFound) {
			return tx.Create(&meta.ContentBlob{
				SHA256: hash, StorageKey: canonicalKey, Size: ref.MaxSize,
				RefCount: committedRefCount, State: meta.ContentBlobStateReady,
			}).Error
		}
		return tx.Model(&meta.ContentBlob{}).
			Where("sha256 = ?", hash).
			Updates(map[string]any{"ref_count": committedRefCount, "state": meta.ContentBlobStateReady}).Error
	})
	if err != nil {
		if created {
			removeCreatedCanonicalIfUnreferenced(ctx, db, storageRoot, canonicalKey)
		}
		return CASRepairAction{}, &CASRepairSkip{
			SHA256: hash, StorageKey: ref.StorageKey,
			Reason: "legacy_reference_switch_failed: " + err.Error(),
		}, nil
	}
	action.AfterRefCount = committedRefCount

	remaining, err := loadCASRefSummary(db.WithContext(ctx), ref.StorageKey)
	if err != nil {
		return action, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "legacy_source_cleanup_check_failed: " + err.Error()}, nil
	}
	if remaining.RefCount != 0 {
		return action, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "legacy_source_cleanup_blocked_by_new_reference"}, nil
	}
	sourceClean, err := cleanStorageKey(ref.StorageKey)
	if err != nil {
		return action, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "legacy_source_cleanup_invalid_key: " + err.Error()}, nil
	}
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return action, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "legacy_source_cleanup_root_failed: " + err.Error()}, nil
	}
	if err := os.Remove(filepath.Join(root, filepath.FromSlash(sourceClean))); err != nil && !errors.Is(err, os.ErrNotExist) {
		return action, &CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "legacy_source_cleanup_failed: " + err.Error()}, nil
	}
	return action, nil, nil
}

func RepairCASMetadata(ctx context.Context, db *gorm.DB, storageRoot string, dryRun bool) (CASRepairReport, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return CASRepairReport{}, err
	}
	if db == nil {
		return CASRepairReport{}, fmt.Errorf("CAS repair database is unavailable")
	}
	before, err := CASHealth(db.WithContext(ctx), CASDeletingStaleAfter)
	if err != nil {
		return CASRepairReport{}, err
	}
	report := CASRepairReport{DryRun: dryRun, Before: before}
	refs, err := loadCASRefSummaries(db.WithContext(ctx))
	if err != nil {
		return report, err
	}
	var blobs []meta.ContentBlob
	if err := db.WithContext(ctx).Order("storage_key ASC").Find(&blobs).Error; err != nil {
		return report, err
	}
	blobByKey := make(map[string]meta.ContentBlob, len(blobs))
	blobByHash := make(map[string]meta.ContentBlob, len(blobs))
	for _, blob := range blobs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		blobByKey[blob.StorageKey] = blob
		blobByHash[strings.ToLower(blob.SHA256)] = blob
	}
	refByKey := make(map[string]casRefSummary, len(refs))
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		refByKey[ref.StorageKey] = ref
		hash, ok := storage.ContentHashFromKey(ref.StorageKey)
		if !ok {
			report.Skipped = append(report.Skipped, CASRepairSkip{StorageKey: ref.StorageKey, Reason: "invalid_cas_key"})
			continue
		}
		if ref.RefCount <= 0 || ref.MinSize != ref.MaxSize {
			report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "conflicting_reference_sizes"})
			continue
		}
		blob, exists := blobByKey[ref.StorageKey]
		if !exists {
			if existing, sameHash := blobByHash[strings.ToLower(hash)]; sameHash {
				report.Skipped = append(report.Skipped, CASRepairSkip{
					SHA256: hash, StorageKey: ref.StorageKey,
					Reason: "content_blob_hash_already_bound_to_different_key: " + existing.StorageKey,
				})
				continue
			}
			if dryRun {
				if err := verifyCASObjectWithContext(ctx, storageRoot, ref.StorageKey, ref.MaxSize, hash); err != nil {
					report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "physical_blob_not_verified: " + err.Error()})
					continue
				}
			} else if err := reconcileReferencedCAS(ctx, db, storageRoot, ref.StorageKey, hash); err != nil {
				report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: err.Error()})
				continue
			}
			report.Actions = append(report.Actions, CASRepairAction{
				Kind: "create_metadata", SHA256: hash, StorageKey: ref.StorageKey,
				AfterRefCount: ref.RefCount, AfterState: meta.ContentBlobStateReady, Applied: !dryRun,
			})
			continue
		}
		if !strings.EqualFold(blob.SHA256, hash) || blob.StorageKey != ref.StorageKey || blob.Size != ref.MaxSize {
			report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "content_blob_metadata_identity_mismatch"})
			continue
		}
		if blob.RefCount == ref.RefCount && blob.State == meta.ContentBlobStateReady {
			continue
		}
		if dryRun {
			if err := verifyCASObjectWithContext(ctx, storageRoot, ref.StorageKey, ref.MaxSize, hash); err != nil {
				report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: "physical_blob_not_verified: " + err.Error()})
				continue
			}
		} else if err := reconcileReferencedCAS(ctx, db, storageRoot, ref.StorageKey, hash); err != nil {
			report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: ref.StorageKey, Reason: err.Error()})
			continue
		}
		report.Actions = append(report.Actions, CASRepairAction{
			Kind: "reconcile_metadata", SHA256: hash, StorageKey: ref.StorageKey,
			BeforeRefCount: blob.RefCount, AfterRefCount: ref.RefCount,
			BeforeState: blob.State, AfterState: meta.ContentBlobStateReady, Applied: !dryRun,
		})
	}

	for _, blob := range blobs {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		if _, referenced := refByKey[blob.StorageKey]; referenced {
			continue
		}
		hash, ok := storage.ContentHashFromKey(blob.StorageKey)
		if !ok || !strings.EqualFold(hash, blob.SHA256) {
			report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: blob.SHA256, StorageKey: blob.StorageKey, Reason: "content_blob_metadata_identity_mismatch"})
			continue
		}
		if blob.RefCount == 0 && blob.State == meta.ContentBlobStateDeleting {
			continue
		}
		action := CASRepairAction{
			Kind: "mark_deleting", SHA256: hash, StorageKey: blob.StorageKey,
			BeforeRefCount: blob.RefCount, AfterRefCount: 0,
			BeforeState: blob.State, AfterState: meta.ContentBlobStateDeleting, Applied: !dryRun,
		}
		if !dryRun {
			if err := markUnreferencedCASDeleting(ctx, db, blob.StorageKey, hash); err != nil {
				report.Skipped = append(report.Skipped, CASRepairSkip{SHA256: hash, StorageKey: blob.StorageKey, Reason: err.Error()})
				continue
			}
		}
		report.Actions = append(report.Actions, action)
	}

	sort.Slice(report.Actions, func(i, j int) bool {
		if report.Actions[i].StorageKey != report.Actions[j].StorageKey {
			return report.Actions[i].StorageKey < report.Actions[j].StorageKey
		}
		return report.Actions[i].Kind < report.Actions[j].Kind
	})
	sort.Slice(report.Skipped, func(i, j int) bool {
		if report.Skipped[i].StorageKey != report.Skipped[j].StorageKey {
			return report.Skipped[i].StorageKey < report.Skipped[j].StorageKey
		}
		return report.Skipped[i].Reason < report.Skipped[j].Reason
	})
	after, err := CASHealth(db.WithContext(ctx), CASDeletingStaleAfter)
	if err != nil {
		return report, err
	}
	report.After = after
	report.GeneratedAt = time.Now().UTC()
	return report, nil
}

func loadCASRefSummaries(db *gorm.DB) ([]casRefSummary, error) {
	const query = `SELECT storage_key, COUNT(*) AS ref_count, MIN(size) AS min_size, MAX(size) AS max_size
FROM (
  SELECT storage_key, size FROM xd_files WHERE storage_key LIKE ?
  UNION ALL
  SELECT storage_key, size FROM xd_file_versions WHERE storage_key LIKE ?
) refs
GROUP BY storage_key
ORDER BY storage_key ASC`
	pattern := storage.ContentBlobDir + "/sha256/%"
	var refs []casRefSummary
	if err := db.Raw(query, pattern, pattern).Scan(&refs).Error; err != nil {
		return nil, err
	}
	return refs, nil
}

func loadCASRefSummary(db *gorm.DB, key string) (casRefSummary, error) {
	const query = `SELECT ? AS storage_key, COUNT(*) AS ref_count,
COALESCE(MIN(size), 0) AS min_size, COALESCE(MAX(size), 0) AS max_size
FROM (
  SELECT size FROM xd_files WHERE storage_key = ?
  UNION ALL
  SELECT size FROM xd_file_versions WHERE storage_key = ?
) refs`
	var ref casRefSummary
	if err := db.Raw(query, key, key, key).Scan(&ref).Error; err != nil {
		return casRefSummary{}, err
	}
	return ref, nil
}

func lockCASHash(tx *gorm.DB, hash string) error {
	rows, err := tx.Raw(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, hash).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	if !rows.Next() {
		return fmt.Errorf("content advisory lock returned no row")
	}
	return rows.Err()
}

func reconcileReferencedCAS(ctx context.Context, db *gorm.DB, storageRoot, key, hash string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCASHash(tx, hash); err != nil {
			return err
		}
		ref, err := loadCASRefSummary(tx, key)
		if err != nil {
			return err
		}
		if ref.RefCount <= 0 || ref.MinSize != ref.MaxSize {
			return fmt.Errorf("reference set changed during repair")
		}
		if err := verifyCASObjectWithContext(ctx, storageRoot, key, ref.MaxSize, hash); err != nil {
			return fmt.Errorf("physical blob changed during repair: %w", err)
		}
		var blob meta.ContentBlob
		err = tx.Where("sha256 = ?", hash).First(&blob).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return tx.Create(&meta.ContentBlob{
				SHA256: hash, Size: ref.MaxSize, StorageKey: key,
				RefCount: ref.RefCount, State: meta.ContentBlobStateReady,
			}).Error
		case err != nil:
			return err
		}
		if blob.StorageKey != key || !strings.EqualFold(blob.SHA256, hash) || blob.Size != ref.MaxSize {
			return fmt.Errorf("content blob identity changed during repair")
		}
		return tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Updates(map[string]any{
			"ref_count": ref.RefCount,
			"state":     meta.ContentBlobStateReady,
		}).Error
	})
}

func markUnreferencedCASDeleting(ctx context.Context, db *gorm.DB, key, hash string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCASHash(tx, hash); err != nil {
			return err
		}
		ref, err := loadCASRefSummary(tx, key)
		if err != nil {
			return err
		}
		if ref.RefCount != 0 {
			return fmt.Errorf("blob gained durable references during repair")
		}
		var blob meta.ContentBlob
		if err := tx.Where("sha256 = ?", hash).First(&blob).Error; err != nil {
			return err
		}
		if blob.StorageKey != key || !strings.EqualFold(blob.SHA256, hash) {
			return fmt.Errorf("content blob identity changed during repair")
		}
		return tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Updates(map[string]any{
			"ref_count": int64(0),
			"state":     meta.ContentBlobStateDeleting,
		}).Error
	})
}

func verifyCASObject(
	storageRoot, rawKey string,
	expectedSize int64,
	expectedHash string,
) error {
	return verifyCASObjectWithContext(
		context.Background(),
		storageRoot,
		rawKey,
		expectedSize,
		expectedHash,
	)
}

func verifyCASObjectWithContext(
	ctx context.Context,
	storageRoot, rawKey string,
	expectedSize int64,
	expectedHash string,
) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	key, err := cleanStorageKey(rawKey)
	if err != nil {
		return err
	}
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return err
	}
	full := filepath.Join(root, filepath.FromSlash(key))
	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("not a regular file")
	}
	if info.Size() != expectedSize {
		return fmt.Errorf("size mismatch: got %d want %d", info.Size(), expectedSize)
	}
	actual, err := hashFileWithContext(ctx, full)
	if err != nil {
		return err
	}
	if !strings.EqualFold(actual, expectedHash) {
		return fmt.Errorf("sha256 mismatch")
	}
	return nil
}
