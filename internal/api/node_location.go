package api

import (
	"context"
	"errors"
	"net/http"
	"path"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const nodeLocationMaxDepth = 10000

// nodeLocationSourceDTO is authoritative connector provenance from SourceItem.
// It is not inferred from file names, timestamps or an ancestor's display name.
type nodeLocationSourceDTO struct {
	SourceID       uint64 `json:"source_id"`
	SourceName     string `json:"source_name"`
	SourceKind     string `json:"source_kind"`
	SourceItemPath string `json:"source_item_path,omitempty"`
	OriginalPath   string `json:"original_path,omitempty"`
}

type nodeLocationSyncFolderDTO struct {
	SourceID     uint64 `json:"source_id"`
	SourceName   string `json:"source_name"`
	SourceKind   string `json:"source_kind"`
	TargetNodeID uint64 `json:"target_node_id"`
}

// nodeLocationDTO exposes the current xDrive Node-tree location separately
// from any old external source path. Breadcrumbs use owned directory IDs.
type nodeLocationDTO struct {
	NodeID      uint64                      `json:"node_id"`
	Revision    uint64                      `json:"revision"`
	NodeType    string                      `json:"node_type"`
	Path        string                      `json:"path"`
	ParentID    *uint64                     `json:"parent_id,omitempty"`
	ParentPath  string                      `json:"parent_path"`
	Breadcrumbs []mediaFolderBreadcrumbDTO  `json:"breadcrumbs"`
	Sources     []nodeLocationSourceDTO     `json:"sources"`
	SyncFolders []nodeLocationSyncFolderDTO `json:"sync_folders"`
}

func (s *Server) queryNodeLocation(
	ctx context.Context,
	ownerID, nodeID uint64,
) (nodeLocationDTO, error) {
	if ownerID == 0 || nodeID == 0 {
		return nodeLocationDTO{}, gorm.ErrRecordNotFound
	}
	if err := ctx.Err(); err != nil {
		return nodeLocationDTO{}, err
	}
	var node meta.Node
	if err := s.DB.WithContext(ctx).
		Select("id", "parent_id", "owner_id", "name", "type", "revision").
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", nodeID, ownerID).
		Take(&node).Error; err != nil {
		return nodeLocationDTO{}, err
	}

	chain := []meta.Node{node}
	seen := map[uint64]struct{}{node.ID: {}}
	cursor := node
	for cursor.ParentID != nil && len(chain) < nodeLocationMaxDepth {
		if _, exists := seen[*cursor.ParentID]; exists {
			return nodeLocationDTO{}, gorm.ErrRecordNotFound
		}
		var parent meta.Node
		if err := s.DB.WithContext(ctx).
			Select("id", "parent_id", "owner_id", "name", "type", "revision").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*cursor.ParentID, ownerID, meta.NodeTypeDir).
			Take(&parent).Error; err != nil {
			return nodeLocationDTO{}, err
		}
		chain = append(chain, parent)
		seen[parent.ID] = struct{}{}
		cursor = parent
	}
	if cursor.ParentID != nil {
		return nodeLocationDTO{}, gorm.ErrRecordNotFound
	}
	for l, r := 0, len(chain)-1; l < r; l, r = l+1, r-1 {
		chain[l], chain[r] = chain[r], chain[l]
	}
	ancestorIDs := make([]uint64, 0, len(chain))
	breadcrumbs := make([]mediaFolderBreadcrumbDTO, 0, len(chain))
	currentPath := ""
	parentPath := ""
	for i, current := range chain {
		ancestorIDs = append(ancestorIDs, current.ID)
		if i == len(chain)-1 {
			parentPath = currentPath
		}
		if current.Name != "" {
			currentPath = path.Join(currentPath, current.Name)
		}
		if current.Type == meta.NodeTypeDir {
			breadcrumbs = append(breadcrumbs, mediaFolderBreadcrumbDTO{
				ID: current.ID, Name: current.Name, Path: currentPath,
			})
		}
	}
	out := nodeLocationDTO{
		NodeID: node.ID, Revision: node.Revision, NodeType: node.Type,
		Path: currentPath, ParentID: node.ParentID, ParentPath: parentPath,
		Breadcrumbs: breadcrumbs,
		Sources:     []nodeLocationSourceDTO{},
		SyncFolders: []nodeLocationSyncFolderDTO{},
	}

	// SourceItem.NodeID is the reliable identity relation; an arbitrary path
	// within a synchronization root is not proof that a connector imported it.
	if err := s.DB.WithContext(ctx).
		Table("xd_source_items AS si").
		Select("s.id AS source_id, s.name AS source_name, s.kind AS source_kind, "+
			"si.path AS source_item_path, COALESCE(sm.original_path, '') AS original_path").
		Joins("JOIN xd_sources AS s ON s.id = si.source_id AND s.owner_id = ?", ownerID).
		Joins("LEFT JOIN xd_source_item_metadata AS sm ON sm.source_item_id = si.id AND sm.source_id = si.source_id").
		Where("si.node_id = ?", nodeID).
		Order("s.name ASC, s.id ASC, si.id ASC").
		Scan(&out.Sources).Error; err != nil {
		return nodeLocationDTO{}, err
	}

	// The current folder scope may differ from past SourceItem provenance if
	// the user moved a file. Keep both facts instead of conflating them.
	if err := s.DB.WithContext(ctx).
		Model(&meta.Source{}).
		Select("id AS source_id, name AS source_name, kind AS source_kind, target_node_id").
		Where("owner_id = ? AND target_node_id IN ?", ownerID, ancestorIDs).
		Order("name ASC, id ASC").
		Scan(&out.SyncFolders).Error; err != nil {
		return nodeLocationDTO{}, err
	}
	return out, nil
}

func (s *Server) getNodeLocation(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	location, err := s.queryNodeLocation(c.Request.Context(), userID(c), nodeID)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
			c.Request.Context().Err() != nil {
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "node location not found")
		} else {
			fail(c, http.StatusInternalServerError, "load node location failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, location)
}
