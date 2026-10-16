package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushFirstFileCommitResult is a private SQL receipt, NOT a SourceRun,
// durable native-file attestation, or permission to enable backup scheduling.
type localPushFirstFileCommitResult struct {
	NodeID       uint64
	SourceItemID uint64
	Replayed     bool
}

// localPushFirstLeafPathKey requires the exact, canonical, single-component
// target name: this first-file writer does NOT create parent directories,
// overwrite existing nodes, or infer names from private paths.
func localPushFirstLeafPathKey(rootID, name string) (string, error) {
	normalized, err := sourcepkg.NormalizeRelativePath(name)
	if rootID == "" || err != nil || normalized != name ||
		strings.Contains(name, "/") || meta.ValidateName(name) != nil {
		return "", errLocalPushStageConflict
	}
	sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" + rootID + "\x00file\x00" + name))
	return hex.EncodeToString(sum[:]), nil
}

// commitBoundLocalPushFirstLeaf is INTERNAL, UNROUTED and strictly limited
// to a NEW file directly inside the authorized Source target. The owning
// Agent must later supply independent native inventory proof before this
// could become an executable backup protocol. Even a true result does NOT
// finish a SyncRun or grant any Desktop/Web/foreign-device control.
func (s *Server) commitBoundLocalPushFirstLeaf(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
) (localPushFirstFileCommitResult, bool, error) {
	if s == nil || s.Store == nil {
		return localPushFirstFileCommitResult{}, false, errLocalPushStageConflict
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return localPushFirstFileCommitResult{}, false, errLocalPushStageConflict
	}
	return s.commitBoundLocalPushFirstLeafWithInspector(
		c, sourceID, revision, proof, stageID, relativeLeaf,
		local.InspectMatchingLocalPushStageAndCASPinned,
	)
}

// Test-injected inspectors cannot create authority: this path has no
// production caller, and only actual Local Store double-hash pin admission
// may support a future externally callable executor. All canonical writes,
// including the quota hold exchange, occur inside ONE PostgreSQL transaction.
func (s *Server) commitBoundLocalPushFirstLeafWithInspector(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
	inspect func(context.Context, string, string, int64, func(context.Context) error) (bool, error),
) (localPushFirstFileCommitResult, bool, error) {
	var empty localPushFirstFileCommitResult
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" || inspect == nil {
		return empty, false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return empty, false, errLocalSourceExecutorTransactionUnauthorized
	}
	pathKey, err := localPushFirstLeafPathKey(proof.RootID, relativeLeaf)
	if err != nil {
		return empty, false, err
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	tx := s.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return empty, false, tx.Error
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback().Error
		}
	}()

	// Generic upload and private Push reservation writers lock Owner User
	// BEFORE Device, Source, Root, Stage, advisory CAS hash and target Node.
	quota, err := s.loadQuotaUsage(tx, userID(c), true)
	if err != nil {
		return empty, false, err
	}
	stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
	if err != nil {
		return empty, false, err
	}
	if stage.OwnerID != userID(c) ||
		(stage.Status != localPushStageReady && stage.Status != localPushStageCommitted) ||
		stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
		stage.CurrentPathKey != pathKey ||
		!validLocalEvidenceDigest(stage.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(stage.ContentSHA256) ||
		!time.Now().Before(stage.ExpiresAt) {
		return empty, false, errLocalPushStageConflict
	}
	stageKey, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		return empty, false, errLocalPushStageConflict
	}
	casKey, err := storage.ContentAddressedKey(stage.ContentSHA256)
	if err != nil {
		return empty, false, errLocalPushStageConflict
	}
	if err := lockContentHash(tx, stage.ContentSHA256); err != nil {
		return empty, false, err
	}
	var blob meta.ContentBlob
	blobErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("sha256 = ?", stage.ContentSHA256).Take(&blob).Error
	if blobErr != nil && !errors.Is(blobErr, gorm.ErrRecordNotFound) {
		return empty, false, blobErr
	}
	blobFound := blobErr == nil
	var intent meta.LocalPushCASPrepareIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ?", stage.StageID).Take(&intent).Error; err != nil {
		return empty, false, err
	}
	if !sameLocalPushCASPrepareIntent(intent, stage) {
		return empty, false, errLocalPushStageConflict
	}
	var hold meta.LocalPushQuotaHold
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("stage_id = ? AND owner_id = ?", stage.StageID, stage.OwnerID).
		Take(&hold).Error; err != nil {
		return empty, false, err
	}
	if !sameLocalPushQuotaHold(hold, stage) {
		return empty, false, errLocalPushStageConflict
	}

	var target meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			stage.TargetNodeID, stage.OwnerID, meta.NodeTypeDir).
		Take(&target).Error; err != nil {
		return empty, false, errLocalPushStageConflict
	}
	var result localPushFirstFileCommitResult
	newFile := stage.Status == localPushStageReady
	switch {
	case newFile:
		if blobFound || hold.ReleasedAt != nil ||
			hold.CommittedAt != nil || hold.CommittedNodeID != nil ||
			!time.Now().Before(hold.ExpiresAt) ||
			quota.QuotaBytes < 0 || quota.PhysicalUsedBytes < 0 ||
			quota.ReservedBytes < hold.Bytes {
			return empty, false, errLocalPushStageConflict
		}
		if quota.QuotaBytes > 0 {
			remaining := quota.QuotaBytes - quota.PhysicalUsedBytes
			if remaining < 0 || quota.ReservedBytes > remaining {
				return empty, false, &quotaExceededError{
					Usage: quota, Additional: stage.TotalSize,
				}
			}
		}
		// A dangling File or FileVersion using an absent canonical blob is
		// corrupt, regardless of which owner references it.
		var usedCount int64
		if err := tx.Model(&meta.File{}).Where("storage_key = ?", casKey).
			Count(&usedCount).Error; err != nil || usedCount != 0 {
			if err != nil {
				return empty, false, err
			}
			return empty, false, errLocalPushStageConflict
		}
		if err := tx.Model(&meta.FileVersion{}).Where("storage_key = ?", casKey).
			Count(&usedCount).Error; err != nil || usedCount != 0 {
			if err != nil {
				return empty, false, err
			}
			return empty, false, errLocalPushStageConflict
		}
		if _, exists, err := uploadNameConflictNode(
			tx, stage.OwnerID, target.ID, relativeLeaf,
		); err != nil {
			return empty, false, err
		} else if exists {
			return empty, false, errLocalPushStageConflict
		}
		var existing meta.SourceItem
		err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ? AND external_id = ?", sourceID, stage.CurrentPathKey).
			Take(&existing).Error
		if err == nil {
			return empty, false, errLocalPushStageConflict
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return empty, false, err
		}
	case stage.Status == localPushStageCommitted:
		if !blobFound || blob.State != meta.ContentBlobStateReady ||
			blob.SHA256 != stage.ContentSHA256 || blob.StorageKey != casKey ||
			blob.Size != stage.TotalSize || blob.RefCount < 1 ||
			hold.ReleasedAt == nil || hold.CommittedAt == nil ||
			hold.CommittedNodeID == nil || *hold.CommittedNodeID == 0 ||
			hold.CommittedSourceItemID == nil || *hold.CommittedSourceItemID == 0 {
			return empty, false, errLocalPushStageConflict
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
				*hold.CommittedNodeID, stage.OwnerID, target.ID, relativeLeaf, meta.NodeTypeFile).
			Take(&node).Error; err != nil {
			return empty, false, errLocalPushStageConflict
		}
		var file meta.File
		if err := tx.Where("node_id = ? AND storage_key = ? AND sha256 = ? AND size = ?",
			node.ID, casKey, stage.ContentSHA256, stage.TotalSize).
			Take(&file).Error; err != nil {
			return empty, false, errLocalPushStageConflict
		}
		var item meta.SourceItem
		if err := tx.Where("source_id = ? AND external_id = ? AND node_id = ? AND node_revision = ? AND path = ? AND size = ? AND sha256 = ? AND state = ?",
			sourceID, stage.CurrentPathKey, node.ID, node.Revision,
			relativeLeaf, stage.TotalSize, stage.ContentSHA256, meta.SourceItemStatePending).
			Take(&item).Error; err != nil {
			return empty, false, errLocalPushStageConflict
		}
		if *hold.CommittedSourceItemID != item.ID {
			return empty, false, errLocalPushStageConflict
		}
		result = localPushFirstFileCommitResult{NodeID: node.ID, SourceItemID: item.ID, Replayed: true}
	default:
		return empty, false, errLocalPushStageConflict
	}

	// Try-only CAS-shard shared -> Stage-shard shared. Physically hash BOTH
	// objects on entry and after the callback, while SQL locks are held.
	matched, err := inspect(ctx, stageKey, casKey, stage.TotalSize,
		func(heldCtx context.Context) error {
			if err := heldCtx.Err(); err != nil {
				return err
			}
			if !time.Now().Before(stage.ExpiresAt) {
				return errLocalPushStageConflict
			}
			if newFile {
				now := time.Now().UTC()
				if err := tx.Create(&meta.ContentBlob{
					SHA256: stage.ContentSHA256, Size: stage.TotalSize,
					StorageKey: casKey, RefCount: 1,
					State: meta.ContentBlobStateReady,
				}).Error; err != nil {
					return err
				}
				node := meta.Node{
					ParentID: &target.ID, Name: relativeLeaf, Type: meta.NodeTypeFile,
					OwnerID: stage.OwnerID, Revision: 1,
				}
				if err := tx.Create(&node).Error; err != nil {
					return err
				}
				if err := tx.Create(&meta.File{
					NodeID: node.ID, Size: stage.TotalSize,
					StorageKey: casKey, SHA256: stage.ContentSHA256,
				}).Error; err != nil {
					return err
				}
				// Deliberately PENDING: real SourceRun/native-file
				// confirmation has not happened; do not fabricate success.
				item := meta.SourceItem{
					SourceID: sourceID, ExternalID: stage.CurrentPathKey,
					NodeID: &node.ID, NodeRevision: node.Revision,
					Kind: meta.SourceItemKindFile, Path: relativeLeaf,
					Size: stage.TotalSize, SHA256: stage.ContentSHA256,
					State: meta.SourceItemStatePending, LastSeenAt: now,
				}
				if err := tx.Create(&item).Error; err != nil {
					return err
				}
				result = localPushFirstFileCommitResult{
					NodeID: node.ID, SourceItemID: item.ID,
				}
				updateHold := tx.Model(&meta.LocalPushQuotaHold{}).
					Where("stage_id = ? AND owner_id = ? AND released_at IS NULL AND committed_at IS NULL",
						stage.StageID, stage.OwnerID).
					Updates(map[string]any{
						"released_at": now, "committed_at": now,
						"committed_node_id": node.ID, "committed_source_item_id": item.ID, "updated_at": now,
					})
				if updateHold.Error != nil || updateHold.RowsAffected != 1 {
					if updateHold.Error != nil {
						return updateHold.Error
					}
					return errLocalPushStageConflict
				}
				updateStage := tx.Model(&meta.LocalPushStaging{}).
					Where("source_id = ? AND stage_id = ? AND status = ?",
						sourceID, stage.StageID, localPushStageReady).
					Updates(map[string]any{"status": localPushStageCommitted, "updated_at": now})
				if updateStage.Error != nil || updateStage.RowsAffected != 1 {
					if updateStage.Error != nil {
						return updateStage.Error
					}
					return errLocalPushStageConflict
				}
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			return nil
		})
	if err != nil {
		// Post-COMMIT physical drift can return negative after metadata was
		// committed. Never speculate rollback/deletion: a later reconciliation
		// must inspect canonical bytes before trusting this private receipt.
		return empty, false, err
	}
	if !matched {
		if committed {
			// The transaction already committed, but post-COMMIT physical
			// observation failed without a storage-level error.
			return empty, false, errLocalPushStageConflict
		}
		return empty, false, nil // nonblocking OS admission was busy
	}
	if !committed {
		return empty, false, errLocalPushStageConflict
	}
	if err := ctx.Err(); err != nil {
		return empty, false, err
	}
	return result, true, nil
}
