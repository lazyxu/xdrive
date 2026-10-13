package api

import (
	"errors"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A single metadata-only rename cannot safely cross directory boundaries
// before the owning Agent/Server support an authenticated destination-parent
// move and independent contents verification. Limit precommit inspection to
// at most 256 active ancestors and fail closed on cycles or missing parents.
const localIdentityMaxTargetDepth = 256

// localQuarantinedLockedNodePathTx returns a path relative to the Source
// target, using SHARE locks for each ancestry node in this caller's SQL
// transaction. The return value is a transient observation, not permission
// to change a Node or create a CAS/file-version reference.
func localQuarantinedLockedNodePathTx(
	tx *gorm.DB, ownerID, nodeID, targetID uint64,
) (string, uint64, error) {
	if tx == nil || ownerID == 0 || nodeID == 0 || targetID == 0 || nodeID == targetID {
		return "", 0, errLocalEvidenceConflict
	}
	current := nodeID
	seen := make(map[uint64]struct{}, 8)
	parts := make([]string, 0, 8)
	var fileParent uint64
	for depth := 0; depth < localIdentityMaxTargetDepth; depth++ {
		if _, duplicate := seen[current]; duplicate {
			return "", 0, errLocalEvidenceConflict
		}
		seen[current] = struct{}{}
		var node meta.Node
		err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("id", "parent_id", "name", "type").
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", current, ownerID).
			Take(&node).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", 0, errLocalEvidenceConflict
		}
		if err != nil {
			return "", 0, err
		}
		if (depth == 0 && node.Type != meta.NodeTypeFile) ||
			(depth > 0 && node.Type != meta.NodeTypeDir) ||
			node.ParentID == nil || node.Name == "" {
			return "", 0, errLocalEvidenceConflict
		}
		parts = append(parts, node.Name)
		if depth == 0 {
			fileParent = *node.ParentID
		}
		if *node.ParentID == targetID {
			for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
				parts[i], parts[j] = parts[j], parts[i]
			}
			return strings.Join(parts, "/"), fileParent, nil
		}
		current = *node.ParentID
	}
	return "", 0, errLocalEvidenceConflict
}

// checkLocalQuarantinedSameDirectoryTargetTx is an INTERNAL, READ-ONLY
// prerequisite for a future authoritative local-folder identity writer.
// After the exact device/Root/quarantine/SourceItem/CAS GC hash transaction
// guard, it also proves the existing live cloud Node still resides at the
// persisted SourceItem.Path under this Source's selected target. A safe
// same-directory destination must have a valid leaf name and no currently
// visible case-insensitive sibling collision.
//
// The sibling absence check is a point-in-time observation. A real writer
// MUST enforce collision exclusion atomically while taking the appropriate
// parent/name lock, reverify native/CAS bytes, update Node/SourceItem/alias
// and handle FileVersion/CAS reference accounting idempotently. This helper
// performs NO canonical writes, file I/O, upload or Mirror inference.
func (s *Server) checkLocalQuarantinedSameDirectoryTargetTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, input localEvidenceCloudMetadataRequest,
	claims []localQuarantinedCurrentPathClaim,
) (localEvidenceCloudTxSnapshot, error) {
	empty := localEvidenceCloudTxSnapshot{}
	if tx == nil || c == nil || c.Request == nil || sourceID == 0 || revision == 0 {
		return empty, errLocalEvidenceConflict
	}
	snapshot, err := s.checkLocalQuarantinedCurrentPathsTx(
		tx, c, sourceID, revision, proof, input, claims)
	if err != nil {
		return empty, err
	}
	var source meta.Source
	err = tx.Select("id", "owner_id", "target_node_id").
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).
		Take(&source).Error
	if err != nil {
		return empty, err
	}
	if source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return empty, errLocalEvidenceConflict
	}
	var target meta.Node
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Select("id", "type").
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
		Take(&target).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return empty, errLocalEvidenceConflict
	}
	if err != nil {
		return empty, err
	}
	for i, claim := range claims {
		var intent meta.LocalSourceCommitIntent
		err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("source_item_id").
			Where("source_id = ? AND source_revision = ? AND evidence_id = ? AND state = ?",
				sourceID, revision, claim.EvidenceID, meta.LocalSourceCommitIntentStateQuarantined).
			Take(&intent).Error
		if err != nil || intent.SourceItemID == 0 {
			return empty, errLocalEvidenceConflict
		}
		var item meta.SourceItem
		err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("id", "source_id", "node_id", "path", "kind", "state").
			Where("id = ? AND source_id = ?", intent.SourceItemID, sourceID).
			Take(&item).Error
		if err != nil || item.NodeID == nil ||
			item.Kind != meta.SourceItemKindFile ||
			item.State != meta.SourceItemStateSynced {
			return empty, errLocalEvidenceConflict
		}
		oldPath, parentID, err := localQuarantinedLockedNodePathTx(
			tx, source.OwnerID, *item.NodeID, target.ID)
		if err != nil || oldPath != item.Path || parentID == 0 ||
			path.Dir(oldPath) != path.Dir(claim.CurrentRelativePath) {
			return empty, errLocalEvidenceConflict
		}
		newName := path.Base(claim.CurrentRelativePath)
		if err := meta.ValidateName(newName); err != nil {
			return empty, errLocalEvidenceConflict
		}
		// A Source-target file rename must not adopt an unrelated or
		// deleted/replaced directory as its destination.
		var siblingCount int64
		err = tx.Model(&meta.Node{}).
			Where("owner_id = ? AND parent_id = ? AND id <> ? AND deleted_at IS NULL",
				source.OwnerID, parentID, *item.NodeID).
			Where("lower(name) = lower(?)", newName).
			Count(&siblingCount).Error
		if err != nil {
			return empty, err
		}
		if siblingCount != 0 || i >= len(snapshot.objects) {
			return empty, errLocalEvidenceConflict
		}
	}
	if err := c.Request.Context().Err(); err != nil {
		return empty, err
	}
	return snapshot, nil
}
