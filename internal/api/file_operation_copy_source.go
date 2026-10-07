package api

import (
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errFileOperationCopySourceCycle = errors.New("copy source subtree contains a cycle")

type fileOperationCopySubtreeRow struct {
	ID             uint64    `gorm:"column:id"`
	ParentID       *uint64   `gorm:"column:parent_id"`
	Name           string    `gorm:"column:name"`
	Type           string    `gorm:"column:type"`
	Revision       uint64    `gorm:"column:revision"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
	Cycle          bool      `gorm:"column:cycle"`
	FileNodeID     uint64    `gorm:"column:file_node_id"`
	FileSize       int64     `gorm:"column:file_size"`
	FileStorageKey string    `gorm:"column:file_storage_key"`
	FileSHA256     string    `gorm:"column:file_sha256"`
}

func loadFileOperationCopySubtree(
	tx *gorm.DB,
	uid uint64,
	rootID uint64,
) (map[uint64][]meta.Node, error) {
	var rows []fileOperationCopySubtreeRow
	err := tx.Raw(`WITH RECURSIVE tree AS (
SELECT n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
       ARRAY[CAST(? AS bigint), n.id]::bigint[] AS path_ids,
       false AS cycle
FROM xd_nodes AS n
WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL
UNION ALL
SELECT n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
       tree.path_ids || n.id,
       n.id = ANY(tree.path_ids) AS cycle
FROM xd_nodes AS n
JOIN tree ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL AND NOT tree.cycle
)
SELECT tree.id, tree.parent_id, tree.name, tree.type, tree.revision,
       tree.created_at, tree.updated_at, tree.cycle,
       COALESCE(f.node_id, 0) AS file_node_id,
       COALESCE(f.size, 0) AS file_size,
       COALESCE(f.storage_key, '') AS file_storage_key,
       COALESCE(f.sha256, '') AS file_sha256
FROM tree
LEFT JOIN xd_files AS f ON f.node_id = tree.id
ORDER BY tree.parent_id ASC NULLS FIRST, tree.type ASC, tree.name ASC, tree.id ASC
`, rootID, uid, rootID, uid).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	childrenByParent := make(map[uint64][]meta.Node)
	for _, row := range rows {
		if row.Cycle {
			return nil, errFileOperationCopySourceCycle
		}
		if row.ParentID == nil {
			continue
		}
		node := meta.Node{
			ID:        row.ID,
			ParentID:  row.ParentID,
			Name:      row.Name,
			Type:      row.Type,
			OwnerID:   uid,
			Revision:  row.Revision,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
		}
		if row.FileNodeID != 0 {
			node.File = &meta.File{
				NodeID:     row.FileNodeID,
				Size:       row.FileSize,
				StorageKey: row.FileStorageKey,
				SHA256:     row.FileSHA256,
			}
		}
		childrenByParent[*row.ParentID] = append(childrenByParent[*row.ParentID], node)
	}
	return childrenByParent, nil
}
