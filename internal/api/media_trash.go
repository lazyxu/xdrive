package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func (s *Server) listMediaTrash(c *gin.Context) {
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}

	base := s.DB.WithContext(c.Request.Context()).
		Model(&meta.MediaMetadata{}).
		Joins(
			"JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NOT NULL AND n.trash_root_id IS NOT NULL",
		).
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.media_kind IN ?",
			userID(c),
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		)

	var totalCount int64
	if err := base.
		Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").
		Count(&totalCount).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list media trash failed")
		return
	}

	var metadata []meta.MediaMetadata
	if err := base.
		Session(&gorm.Session{}).
		Order("n.deleted_at DESC, n.id DESC").
		Limit(limit).
		Offset(offset).
		Find(&metadata).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list media trash failed")
		return
	}
	if len(metadata) == 0 {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, mediaItemRangeDTO{
			Items:      []mediaItemDTO{},
			TotalCount: totalCount,
			Offset:     offset,
			Limit:      limit,
		})
		return
	}

	nodeIDs := make([]uint64, 0, len(metadata))
	for _, row := range metadata {
		nodeIDs = append(nodeIDs, row.NodeID)
	}

	var nodes []meta.Node
	if err := s.DB.WithContext(c.Request.Context()).
		Preload("File").
		Where(
			"id IN ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id IS NOT NULL",
			nodeIDs,
			userID(c),
		).
		Find(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list media trash failed")
		return
	}
	nodeByID := make(map[uint64]meta.Node, len(nodes))
	rootIDs := make([]uint64, 0, len(nodes))
	rootSeen := make(map[uint64]struct{}, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
		if node.TrashRootID == nil || *node.TrashRootID == 0 {
			continue
		}
		if _, exists := rootSeen[*node.TrashRootID]; exists {
			continue
		}
		rootSeen[*node.TrashRootID] = struct{}{}
		rootIDs = append(rootIDs, *node.TrashRootID)
	}

	var roots []meta.Node
	if len(rootIDs) != 0 {
		if err := s.DB.WithContext(c.Request.Context()).
			Preload("File").
			Where("id IN ? AND owner_id = ? AND deleted_at IS NOT NULL", rootIDs, userID(c)).
			Find(&roots).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list media trash failed")
			return
		}
	}
	rootByID := make(map[uint64]nodeDTO, len(roots))
	for _, root := range roots {
		rootByID[root.ID] = toNodeDTO(root)
	}

	presentations, err := s.photoAssetPresentations(
		c.Request.Context(),
		userID(c),
		nodeIDs,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "resolve media trash failed")
		return
	}

	items := make([]mediaItemDTO, 0, len(metadata))
	for _, row := range metadata {
		node, exists := nodeByID[row.NodeID]
		if !exists {
			continue
		}
		presentation := presentations[row.NodeID]
		assetKind := presentation.Kind
		if assetKind == "" {
			assetKind = row.MediaKind
		}
		var trashRoot *nodeDTO
		if node.TrashRootID != nil {
			if root, ok := rootByID[*node.TrashRootID]; ok {
				value := root
				trashRoot = &value
			}
		}
		items = append(items, mediaItemDTO{
			Node:        toNodeDTO(node),
			Metadata:    toMediaMetadataDTO(row),
			AssetKind:   assetKind,
			Favorite:    presentation.Favorite,
			Tags:        presentation.Tags,
			People:      presentation.People,
			Description: presentation.Description,
			Resources:   presentation.Resources,
			LivePhoto: presentation.Kind == meta.PhotoAssetKindLivePhoto ||
				row.ContainerKind == mediapkg.ContainerKindLIVP,
			TrashRoot: trashRoot,
		})
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaItemRangeDTO{
		Items:      items,
		TotalCount: totalCount,
		Offset:     offset,
		Limit:      limit,
	})
}
