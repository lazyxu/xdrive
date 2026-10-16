package api

import (
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errReusedUploadSourceChanged = errors.New("reused upload source changed")

// lockReusableUploadCASSourceTx closes the GC-vs-new-reused-part TOCTOU gap
// for canonical CAS upload sources. Normal upload session creation first
// reserves owner quota, then holds the SAME SQL hash lock used by both CAS
// physical delete paths until the reused UploadPart rows are committed.
// A GC that wins the lock first makes the live Blob check fail closed; a
// writer that wins first publishes its part before GC can inspect it.
// Chunk hashes are calculated before this short DB-only critical section.
// Legacy non-CAS sources keep their existing separate read semantics.
// This is NOT an Agent/SourceRun/local_folder execution authorization.
func lockReusableUploadCASSourceTx(tx *gorm.DB, source *meta.File, parts []meta.UploadPart) error {
	if len(parts) == 0 {
		return nil
	}
	if tx == nil || source == nil || source.NodeID == 0 || source.Size <= 0 {
		return errReusedUploadSourceChanged
	}
	for _, part := range parts {
		if !part.Reused || part.SourceStorageKey != source.StorageKey ||
			part.Size <= 0 || part.Size > source.Size ||
			part.SourceOffset < 0 || part.SourceOffset > source.Size-part.Size {
			return errReusedUploadSourceChanged
		}
	}
	hash, managed := storage.ContentHashFromKey(source.StorageKey)
	if !managed {
		// Legacy non-CAS reuse does not acquire a CAS lifecycle hash lock.
		return nil
	}
	canonical, err := storage.ContentAddressedKey(hash)
	if err != nil || canonical != source.StorageKey || source.SHA256 != hash {
		return errReusedUploadSourceChanged
	}
	if err := lockContentHash(tx, hash); err != nil {
		return err
	}
	var blob meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("sha256 = ?", hash).Take(&blob).Error; err != nil {
		return fmt.Errorf("%w: canonical blob unavailable: %v", errReusedUploadSourceChanged, err)
	}
	if blob.State != meta.ContentBlobStateReady || blob.RefCount < 1 ||
		blob.SHA256 != hash || blob.StorageKey != source.StorageKey || blob.Size != source.Size {
		return errReusedUploadSourceChanged
	}
	// This read rejects an already-moved/deleted source snapshot. It does
	// not take a File row lock, avoiding a reverse File->CAS lock order;
	// the CAS hash lock alone serializes cooperative physical deletion.
	var live meta.File
	if err := tx.Where("node_id = ? AND storage_key = ? AND sha256 = ? AND size = ?",
		source.NodeID, source.StorageKey, hash, source.Size).
		Take(&live).Error; err != nil {
		return fmt.Errorf("%w: source file no longer matches: %v", errReusedUploadSourceChanged, err)
	}
	return nil
}
