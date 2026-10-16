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
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushFirstDirectoryCommitResult is INTERNAL ONLY. A PENDING directory
// and its SourceItem are not a completed backup or SourceRun.
type localPushFirstDirectoryCommitResult struct {
	NodeID       uint64 `json:"-"`
	SourceItemID uint64 `json:"-"`
	Replayed     bool   `json:"-"`
}

func localPushFirstDirectoryPathKey(rootID, name string) (string, error) {
	normalized, err := sourcepkg.NormalizeRelativePath(name)
	if rootID == "" || err != nil || normalized != name ||
		strings.Contains(name, "/") || meta.ValidateName(name) != nil {
		return "", errLocalPushStageConflict
	}
	sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
		rootID + "\x00directory\x00" + name))
	return hex.EncodeToString(sum[:]), nil
}

// commitBoundLocalPushFirstDirectory is a one-level DIRECTORY prerequisite,
// NOT a routed API or owning-Agent Runner. It can create one NEW directory
// directly below an already-authorized cloud target, together with a PENDING
// SourceItem, in ONE PostgreSQL transaction.
//
// CRITICAL: this function does NOT see a native sealed CURRENT directory
// snapshot or hold a native inode across SQL. A future executor MUST bind an
// independently revalidated device Root/CURRENT directory proof before using
// this primitive. Do NOT wire it to REST/Agent IPC/Renderer/Web/scheduler.
// No File/CAS/FileVersion/SourceRun is written; no Mirror deletion is allowed.
func (s *Server) commitBoundLocalPushFirstDirectory(
	c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, relativeDir string,
) (localPushFirstDirectoryCommitResult, bool, error) {
	var empty localPushFirstDirectoryCommitResult
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 {
		return empty, false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return empty, false, errLocalSourceExecutorTransactionUnauthorized
	}
	pathKey, err := localPushFirstDirectoryPathKey(proof.RootID, relativeDir)
	if err != nil {
		return empty, false, err
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	var result localPushFirstDirectoryCommitResult
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Existing local Push writers serialize owner quota before the bound
		// Device, Source, Root and target Node; preserve the same order even
		// when a directory consumes zero CAS bytes.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ?", userID(c)).Take(&owner).Error; err != nil {
			return err
		}
		source, err := s.checkLocalPushStageScopeTx(
			tx, c, sourceID, revision, proof,
		)
		if err != nil {
			return err
		}
		if source.TargetNodeID == nil || *source.TargetNodeID == 0 {
			return errLocalPushStageConflict
		}
		var target meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
			Take(&target).Error; err != nil {
			return errLocalPushStageConflict
		}
		// A directory is replayable ONLY if exactly the same Source/path
		// already owns the same surviving target Node and has not been
		// promoted by a future SourceRun or moved by another writer.
		var item meta.SourceItem
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND external_id = ?", sourceID, pathKey).
			Take(&item).Error
		switch {
		case err == nil:
			if item.Kind != meta.SourceItemKindDirectory ||
				item.Path != relativeDir || item.Size != 0 ||
				item.NodeID == nil || item.NodeRevision != 1 ||
				item.State != meta.SourceItemStatePending ||
				item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
				return errLocalPushStageConflict
			}
			var node meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where("id = ? AND owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
					*item.NodeID, source.OwnerID, target.ID,
					relativeDir, meta.NodeTypeDir, item.NodeRevision).
				Take(&node).Error; err != nil {
				return errLocalPushStageConflict
			}
			result = localPushFirstDirectoryCommitResult{
				NodeID: node.ID, SourceItemID: item.ID, Replayed: true,
			}
			return ctx.Err()
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return err
		}
		if _, exists, err := uploadNameConflictNode(
			tx, source.OwnerID, target.ID, relativeDir,
		); err != nil {
			return err
		} else if exists {
			return errLocalPushStageConflict
		}
		node := meta.Node{
			ParentID: &target.ID, Name: relativeDir,
			Type: meta.NodeTypeDir, OwnerID: source.OwnerID, Revision: 1,
		}
		if err := tx.Create(&node).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		item = meta.SourceItem{
			SourceID: sourceID, ExternalID: pathKey,
			NodeID: &node.ID, NodeRevision: node.Revision,
			Kind: meta.SourceItemKindDirectory, Path: relativeDir,
			Size: 0, State: meta.SourceItemStatePending, LastSeenAt: now,
		}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		result = localPushFirstDirectoryCommitResult{
			NodeID: node.ID, SourceItemID: item.ID,
		}
		return ctx.Err()
	})
	if err != nil {
		return empty, false, err
	}
	if ctx.Err() != nil {
		return empty, false, ctx.Err()
	}
	return result, true, nil
}
