package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

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

func (s *Server) ensureContentBlobObject(ctx context.Context, tempKey, targetKey string, expectedSize int64) error {
	if existing, err := s.Store.Open(ctx, targetKey); err == nil {
		healthy := false
		if info, statErr := existing.Stat(); statErr == nil && info.Size() == expectedSize {
			healthy = true
		}
		_ = existing.Close()
		if healthy {
			return nil
		}
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
		return fmt.Errorf("content blob size mismatch: got %d want %d", written, expectedSize)
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

	var candidates []contentDeleteCandidate
	for _, key := range keys {
		hash, ok := storage.ContentHashFromKey(key)
		if !ok {
			return nil, nil, fmt.Errorf("invalid content-addressed key %q", key)
		}
		if err := lockContentHash(tx, hash); err != nil {
			return nil, nil, err
		}
		var blob meta.ContentBlob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("sha256 = ?", hash).First(&blob).Error; err != nil {
			return nil, nil, fmt.Errorf("load content blob %s: %w", hash, err)
		}
		if blob.StorageKey != key {
			return nil, nil, fmt.Errorf("content blob key mismatch for %s", hash)
		}
		release := counts[key]
		if blob.RefCount < release {
			return nil, nil, fmt.Errorf("content blob refcount underflow for %s", hash)
		}
		next := blob.RefCount - release
		state := meta.ContentBlobStateReady
		if next == 0 {
			state = meta.ContentBlobStateDeleting
			candidates = append(candidates, contentDeleteCandidate{SHA256: hash, StorageKey: key})
		}
		if err := tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).
			Updates(map[string]any{"ref_count": next, "state": state}).Error; err != nil {
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
			var reusedParts int64
			if err := tx.Model(&meta.UploadPart{}).
				Where("reused = ? AND source_storage_key = ?", true, blob.StorageKey).
				Count(&reusedParts).Error; err != nil {
				return err
			}
			if reusedParts > 0 {
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
