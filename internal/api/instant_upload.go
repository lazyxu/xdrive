package api

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errInstantUploadUnavailable = errors.New("instant upload unavailable")

func (s *Server) tryInstantUploadSession(
	ctx context.Context,
	uid uint64,
	req uploadInitRequest,
	chunkCount int,
) (meta.UploadSession, uint64, bool, error) {
	var session meta.UploadSession
	if req.SHA256 == "" {
		return session, 0, false, nil
	}
	storageKey, err := storage.ContentAddressedKey(req.SHA256)
	if err != nil {
		return session, 0, false, nil
	}
	owned, err := userOwnsStorageKey(s.DB, uid, storageKey)
	if err != nil {
		return session, 0, false, err
	}
	if !owned {
		return session, 0, false, nil
	}

	session = meta.UploadSession{
		ID:               uuid.NewString(),
		OwnerID:          uid,
		ParentID:         req.ParentID,
		NodeID:           req.NodeID,
		Name:             req.Name,
		ExpectedRevision: req.ExpectedRevision,
		TotalSize:        req.Size,
		ChunkSize:        req.ChunkSize,
		ChunkCount:       chunkCount,
		SHA256:           req.SHA256,
		ResumeKey:        req.ResumeKey,
		Status:           meta.UploadStatusFinalized,
		ExpiresAt:        time.Now().Add(uploadSessionTTL),
	}

	var currentRevision uint64
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := s.ensureQuotaForStorageKey(tx, uid, req.Size, storageKey, true); err != nil {
			return err
		}

		retainedKey, ok, err := s.retainOwnedContentBlobTx(ctx, tx, uid, req.SHA256, req.Size)
		if err != nil {
			return err
		}
		if !ok {
			return errInstantUploadUnavailable
		}

		now := time.Now()
		var resultID uint64
		if req.NodeID == nil {
			var parent meta.Node
			if err := tx.Where(
				"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*req.ParentID, uid, meta.NodeTypeDir,
			).First(&parent).Error; err != nil {
				return err
			}
			if s.nameExistsTx(tx, uid, parent.ID, req.Name, 0) {
				return errUploadNameTaken
			}
			node := meta.Node{
				ParentID: req.ParentID, Name: req.Name,
				Type: meta.NodeTypeFile, OwnerID: uid, Revision: 1,
			}
			if err := tx.Create(&node).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.File{
				NodeID: node.ID, Size: req.Size, StorageKey: retainedKey, SHA256: req.SHA256,
			}).Error; err != nil {
				return err
			}
			resultID = node.ID
		} else {
			var current meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *req.NodeID, uid).
				First(&current).Error; err != nil {
				return err
			}
			currentRevision = current.Revision
			if current.Type != meta.NodeTypeFile || current.Revision != req.ExpectedRevision {
				if current.Revision != req.ExpectedRevision {
					return errRevisionConflict
				}
				return gorm.ErrRecordNotFound
			}

			var file meta.File
			if err := tx.Where("node_id = ?", current.ID).First(&file).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.FileVersion{
				NodeID: current.ID, Revision: current.Revision, Size: file.Size,
				StorageKey: file.StorageKey, SHA256: file.SHA256, CreatedAt: now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.File{}).Where("node_id = ?", current.ID).Updates(map[string]any{
				"size": req.Size, "storage_key": retainedKey, "sha256": req.SHA256, "updated_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.Node{}).
				Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", current.ID, uid, req.ExpectedRevision).
				Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
				return err
			}
			resultID = current.ID
		}

		session.ResultNodeID = &resultID
		return tx.Create(&session).Error
	})
	if errors.Is(err, errInstantUploadUnavailable) {
		return meta.UploadSession{}, currentRevision, false, nil
	}
	if err != nil {
		return meta.UploadSession{}, currentRevision, false, err
	}
	return session, currentRevision, true, nil
}

func (s *Server) retainOwnedContentBlobTx(
	ctx context.Context,
	tx *gorm.DB,
	uid uint64,
	hash string,
	size int64,
) (string, bool, error) {
	key, err := storage.ContentAddressedKey(hash)
	if err != nil {
		return "", false, err
	}
	if err := lockContentHash(tx, hash); err != nil {
		return "", false, err
	}
	owned, err := userOwnsStorageKey(tx, uid, key)
	if err != nil {
		return "", false, err
	}
	if !owned {
		return "", false, nil
	}

	var blob meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("sha256 = ? AND storage_key = ?", hash, key).First(&blob).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	if blob.State != meta.ContentBlobStateReady || blob.RefCount <= 0 || blob.Size != size {
		return "", false, nil
	}
	f, err := s.Store.Open(ctx, blob.StorageKey)
	if err != nil {
		return "", false, nil
	}
	info, statErr := f.Stat()
	_ = f.Close()
	if statErr != nil || info.Size() != size {
		return "", false, nil
	}
	if err := tx.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).
		Update("ref_count", gorm.Expr("ref_count + 1")).Error; err != nil {
		return "", false, err
	}
	return blob.StorageKey, true, nil
}

func userOwnsStorageKey(db *gorm.DB, uid uint64, storageKey string) (bool, error) {
	var count int64
	row := db.Raw(`SELECT COUNT(*)
FROM (
  SELECT f.storage_key
  FROM xd_files f
  JOIN xd_nodes n ON n.id = f.node_id
  WHERE n.owner_id = ? AND f.storage_key = ?
  UNION ALL
  SELECT v.storage_key
  FROM xd_file_versions v
  JOIN xd_nodes n ON n.id = v.node_id
  WHERE n.owner_id = ? AND v.storage_key = ?
) refs`, uid, storageKey, uid, storageKey).Row()
	if err := row.Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
