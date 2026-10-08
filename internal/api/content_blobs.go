package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

	humanize "github.com/dustin/go-humanize"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type contentDeleteCandidate struct {
	SHA256     string
	StorageKey string
}

func lockContentHash(tx *gorm.DB, hash string) error {
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

func (s *Server) retainContentBlobTx(
	ctx context.Context,
	tx *gorm.DB,
	tempKey, hash string,
	size int64,
) (storageKey string, created bool, err error) {
	hash = strings.ToLower(strings.TrimSpace(hash))
	casKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		return "", false, err
	}
	if err := lockContentHash(tx, hash); err != nil {
		return "", false, err
	}

	var blob meta.ContentBlob
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sha256 = ?", hash).First(&blob).Error
	switch {
	case err == nil:
		if blob.Size != size || blob.StorageKey != casKey {
			return "", false, fmt.Errorf("content blob metadata mismatch for %s", hash)
		}
		if blob.State == meta.ContentBlobStateReady {
			if err := s.ensureContentBlobObject(ctx, tempKey, blob.StorageKey, size); err != nil {
				return "", false, err
			}
			if err := tx.Model(&meta.ContentBlob{}).
				Where("sha256 = ?", hash).
				Updates(map[string]any{"ref_count": gorm.Expr("ref_count + 1"), "state": meta.ContentBlobStateReady}).Error; err != nil {
				return "", false, err
			}
			return blob.StorageKey, false, nil
		}
		if blob.State != meta.ContentBlobStateDeleting {
			return "", false, fmt.Errorf("unsupported content blob state %q", blob.State)
		}
		if err := s.ensureContentBlobObject(ctx, tempKey, blob.StorageKey, size); err != nil {
			return "", false, err
		}
		if err := tx.Model(&meta.ContentBlob{}).
			Where("sha256 = ?", hash).
			Updates(map[string]any{"size": size, "ref_count": 1, "state": meta.ContentBlobStateReady}).Error; err != nil {
			return "", false, err
		}
		return blob.StorageKey, false, nil

	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := s.ensureContentBlobObject(ctx, tempKey, casKey, size); err != nil {
			return "", false, err
		}
		blob = meta.ContentBlob{
			SHA256: hash, Size: size, StorageKey: casKey,
			RefCount: 1, State: meta.ContentBlobStateReady,
		}
		if err := tx.Create(&blob).Error; err != nil {
			_ = s.Store.Delete(ctx, casKey)
			return "", false, err
		}
		return casKey, true, nil

	default:
		return "", false, err
	}
}

func retainExistingContentReferenceTx(tx *gorm.DB, file meta.File) error {
	if !storage.IsContentAddressedKey(file.StorageKey) {
		return nil
	}
	hash, ok := storage.ContentHashFromKey(file.StorageKey)
	if !ok {
		return fmt.Errorf("invalid content-addressed key %q", file.StorageKey)
	}
	if err := lockContentHash(tx, hash); err != nil {
		return err
	}
	var blob meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("sha256 = ?", hash).First(&blob).Error; err != nil {
		return err
	}
	if blob.State != meta.ContentBlobStateReady || blob.StorageKey != file.StorageKey || blob.Size != file.Size {
		return fmt.Errorf("content blob metadata mismatch for %s", hash)
	}
	return tx.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", hash).
		Update("ref_count", gorm.Expr("ref_count + 1")).Error
}

func storageObjectSize(ctx context.Context, store storage.Store, key string) (int64, error) {
	if provider, ok := store.(storage.ObjectStatProvider); ok {
		info, err := provider.Stat(ctx, key)
		if err != nil {
			return 0, err
		}
		return info.Size, nil
	}
	f, err := store.Open(ctx, key)
	if err != nil {
		return 0, err
	}
	info, statErr := f.Stat()
	_ = f.Close()
	if statErr != nil {
		return 0, statErr
	}
	return info.Size(), nil
}

func (s *Server) ensureContentBlobObject(ctx context.Context, tempKey, targetKey string, expectedSize int64) error {
	if size, err := storageObjectSize(ctx, s.Store, targetKey); err == nil && size == expectedSize {
		return nil
	}
	if promoter, ok := s.Store.(storage.ContentPromoter); ok {
		return promoter.Promote(ctx, tempKey, targetKey, expectedSize)
	}
	if err := s.ensureStorageWriteCapacity(ctx, expectedSize); err != nil {
		return err
	}
	return s.writeBlobFromTemp(ctx, tempKey, targetKey, expectedSize)
}

func (s *Server) writeBlobFromTemp(ctx context.Context, tempKey, targetKey string, expectedSize int64) error {
	if tempKey == "" {
		return fmt.Errorf("temporary content is unavailable")
	}
	source, err := s.Store.Open(ctx, tempKey)
	if err != nil {
		return err
	}
	defer source.Close()

	written, err := s.Store.Put(ctx, targetKey, io.LimitReader(source, expectedSize+1))
	if err != nil {
		return err
	}
	if written != expectedSize {
		_ = s.Store.Delete(ctx, targetKey)
		return fmt.Errorf("content blob size mismatch: got %s want %s", humanize.IBytes(uint64(max(int64(0), written))), humanize.IBytes(uint64(max(int64(0), expectedSize))))
	}
	return nil
}

func (s *Server) cleanupUncommittedContentBlob(ctx context.Context, hash, storageKey string) {
	if hash == "" || storageKey == "" {
		return
	}
	_ = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := lockContentHash(tx, hash); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return nil
		}
		return s.Store.Delete(ctx, storageKey)
	})
}

const contentReferenceReleaseBatchSize = 200

type contentReferenceRelease struct {
	SHA256     string
	StorageKey string
	Release    int64
}

type contentReferenceUpdate struct {
	SHA256   string
	RefCount int64
	State    string
}

func contentReferenceUpdateValues(count int) string {
	return strings.TrimSuffix(strings.Repeat("(?::text, ?::bigint, ?::text),", count), ",")
}

func contentReferenceLockValues(count int) string {
	return strings.TrimSuffix(strings.Repeat("(?::text),", count), ",")
}

func lockContentReferenceBatchTx(
	tx *gorm.DB,
	batch []contentReferenceRelease,
) error {
	if len(batch) == 0 {
		return nil
	}
	args := make([]any, 0, len(batch))
	for _, item := range batch {
		args = append(args, item.SHA256)
	}
	query := fmt.Sprintf(`
SELECT pg_advisory_xact_lock(hashtextextended(requested.sha256, 0))
FROM (VALUES %s) AS requested(sha256)
ORDER BY requested.sha256
`, contentReferenceLockValues(len(batch)))
	rows, err := tx.Raw(query, args...).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
	}
	return rows.Err()
}

func loadContentReferenceBatchTx(
	tx *gorm.DB,
	batch []contentReferenceRelease,
) ([]meta.ContentBlob, error) {
	if len(batch) == 0 {
		return nil, nil
	}
	hashes := make([]string, 0, len(batch))
	for _, item := range batch {
		hashes = append(hashes, item.SHA256)
	}
	var blobs []meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("sha256 IN ?", hashes).
		Order("sha256 ASC").
		Find(&blobs).Error; err != nil {
		return nil, err
	}
	return blobs, nil
}

func updateContentReferenceBatchTx(
	tx *gorm.DB,
	updates []contentReferenceUpdate,
) error {
	if len(updates) == 0 {
		return nil
	}
	args := make([]any, 0, len(updates)*3)
	for _, item := range updates {
		args = append(args, item.SHA256, item.RefCount, item.State)
	}
	query := fmt.Sprintf(`
WITH updates(sha256, ref_count, state) AS (
	VALUES %s
)
UPDATE xd_content_blobs AS blob
SET
	ref_count = updates.ref_count::bigint,
	state = updates.state
FROM updates
WHERE blob.sha256 = updates.sha256
`, contentReferenceUpdateValues(len(updates)))
	result := tx.Exec(query, args...)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != int64(len(updates)) {
		return fmt.Errorf("content blob batch update affected %d rows; want %d", result.RowsAffected, len(updates))
	}
	return nil
}

func (s *Server) releaseContentReferencesTx(
	tx *gorm.DB,
	files []meta.File,
	versions []meta.FileVersion,
) ([]contentDeleteCandidate, []string, error) {
	counts := map[string]int64{}
	legacy := map[string]struct{}{}
	for _, file := range files {
		if storage.IsContentAddressedKey(file.StorageKey) {
			counts[file.StorageKey]++
		} else if file.StorageKey != "" {
			legacy[file.StorageKey] = struct{}{}
		}
	}
	for _, version := range versions {
		if storage.IsContentAddressedKey(version.StorageKey) {
			counts[version.StorageKey]++
		} else if version.StorageKey != "" {
			legacy[version.StorageKey] = struct{}{}
		}
	}

	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	releases := make([]contentReferenceRelease, 0, len(keys))
	keyByHash := make(map[string]string, len(keys))
	for _, key := range keys {
		hash, ok := storage.ContentHashFromKey(key)
		if !ok {
			return nil, nil, fmt.Errorf("invalid content-addressed key %q", key)
		}
		if previousKey, exists := keyByHash[hash]; exists && previousKey != key {
			return nil, nil, fmt.Errorf("content blob key mismatch for %s", hash)
		}
		keyByHash[hash] = key
		releases = append(releases, contentReferenceRelease{
			SHA256:     hash,
			StorageKey: key,
			Release:    counts[key],
		})
	}
	sort.Slice(releases, func(i, j int) bool {
		return releases[i].SHA256 < releases[j].SHA256
	})

	var candidates []contentDeleteCandidate
	for start := 0; start < len(releases); start += contentReferenceReleaseBatchSize {
		end := min(start+contentReferenceReleaseBatchSize, len(releases))
		batch := releases[start:end]
		if err := lockContentReferenceBatchTx(tx, batch); err != nil {
			return nil, nil, err
		}
		rows, err := loadContentReferenceBatchTx(tx, batch)
		if err != nil {
			return nil, nil, err
		}
		byHash := make(map[string]meta.ContentBlob, len(rows))
		for _, row := range rows {
			byHash[row.SHA256] = row
		}

		updates := make([]contentReferenceUpdate, 0, len(batch))
		for _, item := range batch {
			row, ok := byHash[item.SHA256]
			if !ok {
				return nil, nil, fmt.Errorf("load content blob %s: %w", item.SHA256, gorm.ErrRecordNotFound)
			}
			if row.StorageKey != item.StorageKey {
				return nil, nil, fmt.Errorf("content blob key mismatch for %s", item.SHA256)
			}
			if row.RefCount < item.Release {
				return nil, nil, fmt.Errorf("content blob refcount underflow for %s", item.SHA256)
			}
			next := row.RefCount - item.Release
			state := meta.ContentBlobStateReady
			if next == 0 {
				state = meta.ContentBlobStateDeleting
				candidates = append(candidates, contentDeleteCandidate{
					SHA256: item.SHA256, StorageKey: item.StorageKey,
				})
			}
			updates = append(updates, contentReferenceUpdate{
				SHA256: item.SHA256, RefCount: next, State: state,
			})
		}
		if err := updateContentReferenceBatchTx(tx, updates); err != nil {
			return nil, nil, err
		}
	}

	legacyKeys := make([]string, 0, len(legacy))
	for key := range legacy {
		legacyKeys = append(legacyKeys, key)
	}
	sort.Strings(legacyKeys)
	return candidates, legacyKeys, nil
}

func reusedUploadPartExistsTx(tx *gorm.DB, sourceStorageKey string) (bool, error) {
	var exists bool
	err := tx.Raw(`
SELECT EXISTS (
	SELECT 1
	FROM xd_upload_parts
	WHERE reused = TRUE AND source_storage_key = ?
)
`, sourceStorageKey).Scan(&exists).Error
	return exists, err
}

func (s *Server) finalizeContentBlobDeletes(ctx context.Context, candidates []contentDeleteCandidate) error {
	var firstErr error
	for _, candidate := range candidates {
		candidate := candidate
		err := s.DB.Transaction(func(tx *gorm.DB) error {
			if err := lockContentHash(tx, candidate.SHA256); err != nil {
				return err
			}
			var blob meta.ContentBlob
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("sha256 = ?", candidate.SHA256).First(&blob).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil
				}
				return err
			}
			if blob.RefCount != 0 || blob.State != meta.ContentBlobStateDeleting {
				return nil
			}
			if blob.StorageKey != candidate.StorageKey {
				return fmt.Errorf("content blob delete key mismatch for %s", candidate.SHA256)
			}
			reusedPartExists, err := reusedUploadPartExistsTx(tx, blob.StorageKey)
			if err != nil {
				return err
			}
			if reusedPartExists {
				// Active resumable overwrite sessions may still stream reused
				// ranges from this blob. Leave it in deleting state; the upload
				// janitor will retry after those temporary references disappear.
				return nil
			}
			if err := s.Store.Delete(ctx, blob.StorageKey); err != nil {
				return err
			}
			return tx.Delete(&meta.ContentBlob{}, "sha256 = ?", blob.SHA256).Error
		})
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (s *Server) deleteLegacyStorageKeys(ctx context.Context, keys []string) {
	for _, key := range keys {
		var references int64
		row := s.DB.Raw(`SELECT
  (SELECT COUNT(*) FROM xd_files WHERE storage_key = ?) +
  (SELECT COUNT(*) FROM xd_file_versions WHERE storage_key = ?)`, key, key).Row()
		if err := row.Scan(&references); err != nil || references != 0 {
			continue
		}
		_ = s.Store.Delete(ctx, key)
	}
}

func (s *Server) reapDeletingContentBlobs(ctx context.Context) error {
	var blobs []meta.ContentBlob
	if err := s.DB.
		Where("ref_count = 0 AND state = ?", meta.ContentBlobStateDeleting).
		Order("updated_at ASC").
		Limit(128).
		Find(&blobs).Error; err != nil {
		return err
	}
	candidates := make([]contentDeleteCandidate, 0, len(blobs))
	for _, blob := range blobs {
		candidates = append(candidates, contentDeleteCandidate{
			SHA256: blob.SHA256, StorageKey: blob.StorageKey,
		})
	}
	return s.finalizeContentBlobDeletes(ctx, candidates)
}
