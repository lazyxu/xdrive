package api

import (
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errLocalPushCommonDirectoryOutsideRoot = errors.New("private local Push directory outside authorized Source")

const maxLocalPushCommonFolderDepth = 64

// Lock every intermediate current cloud directory through the Source's
// authorized immutable target. Owner-only checks would permit uploading
// files to a different subtree or moving a directory out during Finalize.
// NOWAIT fails closed on competing file operations instead of deadlocking.
func requireLocalPushCommonDescendantDirTx(
	tx *gorm.DB, ownerID, rootID, directoryID uint64,
) error {
	if tx == nil || ownerID == 0 || rootID == 0 || directoryID == 0 {
		return errLocalPushCommonDirectoryOutsideRoot
	}
	seen := make(map[uint64]struct{}, 8)
	current := directoryID
	for depth := 0; depth < maxLocalPushCommonFolderDepth; depth++ {
		if _, exists := seen[current]; exists {
			return errLocalPushCommonDirectoryOutsideRoot
		}
		seen[current] = struct{}{}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				current, ownerID, meta.NodeTypeDir).
			Take(&node).Error; err != nil {
			return errLocalPushCommonDirectoryOutsideRoot
		}
		if node.ID == rootID {
			return nil
		}
		if node.ParentID == nil || *node.ParentID == 0 {
			return errLocalPushCommonDirectoryOutsideRoot
		}
		current = *node.ParentID
	}
	return errLocalPushCommonDirectoryOutsideRoot
}
