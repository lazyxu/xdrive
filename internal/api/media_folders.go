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

type mediaFolderStats struct {
	DirectMediaCount int64
	ChildFolderCount int64
	CoverNodeID      *uint64
}

type mediaSyncFolderDTO struct {
	SourceID         uint64  `json:"source_id"`
	SourceName       string  `json:"source_name"`
	SourceKind       string  `json:"source_kind"`
	SourceStatus     string  `json:"source_status"`
	TargetNodeID     uint64  `json:"target_node_id"`
	TargetName       string  `json:"target_name"`
	TargetPath       string  `json:"target_path"`
	DirectMediaCount int64   `json:"direct_media_count"`
	ChildFolderCount int64   `json:"child_folder_count"`
	CoverNodeID      *uint64 `json:"cover_node_id,omitempty"`
}

type mediaFolderEntryDTO struct {
	ID               uint64  `json:"id"`
	ParentID         *uint64 `json:"parent_id,omitempty"`
	Name             string  `json:"name"`
	Path             string  `json:"path"`
	DirectMediaCount int64   `json:"direct_media_count"`
	ChildFolderCount int64   `json:"child_folder_count"`
	CoverNodeID      *uint64 `json:"cover_node_id,omitempty"`
}

type mediaFolderBreadcrumbDTO struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type mediaFolderViewDTO struct {
	Source      mediaSyncFolderDTO         `json:"source"`
	Current     mediaFolderEntryDTO        `json:"current"`
	Breadcrumbs []mediaFolderBreadcrumbDTO `json:"breadcrumbs"`
	Children    []mediaFolderEntryDTO      `json:"children"`
}

func mediaFolderThumbnailMIMEs() []string {
	return []string{
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/avif",
		"image/tiff",
		"image/bmp",
		"image/heic",
		"image/heif",
		"image/x-adobe-dng",
	}
}

func (s *Server) mediaFolderStatsByID(
	ctx context.Context,
	ownerID uint64,
	folderIDs []uint64,
) (map[uint64]mediaFolderStats, error) {
	out := make(map[uint64]mediaFolderStats, len(folderIDs))
	if len(folderIDs) == 0 {
		return out, nil
	}
	unique := make([]uint64, 0, len(folderIDs))
	seen := make(map[uint64]struct{}, len(folderIDs))
	for _, id := range folderIDs {
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return out, nil
	}

	type mediaRow struct {
		FolderID         uint64
		DirectMediaCount int64
		CoverNodeID      *uint64
	}
	var mediaRows []mediaRow
	if err := s.DB.WithContext(ctx).
		Table("xd_nodes AS media_n").
		Select(
			"media_n.parent_id AS folder_id, COUNT(DISTINCT pa.id) AS direct_media_count, "+
				"MIN(CASE WHEN lower(mm.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id",
			mediaFolderThumbnailMIMEs(),
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = media_n.id AND pa.owner_id = ?",
			ownerID,
		).
		Joins(
			"LEFT JOIN xd_media_metadata AS mm ON mm.node_id = pa.primary_node_id AND mm.owner_id = ?",
			ownerID,
		).
		Where(
			"media_n.owner_id = ? AND media_n.parent_id IN ? AND media_n.type = ? AND media_n.deleted_at IS NULL",
			ownerID,
			unique,
			meta.NodeTypeFile,
		).
		Group("media_n.parent_id").
		Scan(&mediaRows).Error; err != nil {
		return nil, err
	}
	for _, row := range mediaRows {
		stats := out[row.FolderID]
		stats.DirectMediaCount = row.DirectMediaCount
		stats.CoverNodeID = row.CoverNodeID
		out[row.FolderID] = stats
	}

	type childRow struct {
		FolderID         uint64
		ChildFolderCount int64
	}
	var childRows []childRow
	if err := s.DB.WithContext(ctx).
		Table("xd_nodes").
		Select("parent_id AS folder_id, COUNT(*) AS child_folder_count").
		Where(
			"owner_id = ? AND parent_id IN ? AND type = ? AND deleted_at IS NULL",
			ownerID,
			unique,
			meta.NodeTypeDir,
		).
		Group("parent_id").
		Scan(&childRows).Error; err != nil {
		return nil, err
	}
	for _, row := range childRows {
		stats := out[row.FolderID]
		stats.ChildFolderCount = row.ChildFolderCount
		out[row.FolderID] = stats
	}
	return out, nil
}

func (s *Server) mediaDirectoryPath(
	ctx context.Context,
	ownerID uint64,
	node meta.Node,
) (string, error) {
	parts := make([]string, 0, 8)
	current := node
	for steps := 0; steps < 10000; steps++ {
		if current.Name != "" {
			parts = append(parts, current.Name)
		}
		if current.ParentID == nil {
			break
		}
		var parent meta.Node
		if err := s.DB.WithContext(ctx).
			Select("id", "parent_id", "name", "type", "owner_id", "deleted_at").
			Where(
				"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*current.ParentID,
				ownerID,
				meta.NodeTypeDir,
			).
			First(&parent).Error; err != nil {
			return "", err
		}
		current = parent
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return path.Join(parts...), nil
}

func (s *Server) mediaSyncFolderSource(
	ctx context.Context,
	ownerID uint64,
	sourceID uint64,
) (meta.Source, meta.Node, error) {
	var source meta.Source
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND target_node_id IS NOT NULL", sourceID, ownerID).
		First(&source).Error; err != nil {
		return meta.Source{}, meta.Node{}, err
	}
	if source.TargetNodeID == nil {
		return meta.Source{}, meta.Node{}, gorm.ErrRecordNotFound
	}
	var target meta.Node
	if err := s.DB.WithContext(ctx).
		Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID,
			ownerID,
			meta.NodeTypeDir,
		).
		First(&target).Error; err != nil {
		return meta.Source{}, meta.Node{}, err
	}
	return source, target, nil
}

func mediaSyncFolderDTOFrom(
	source meta.Source,
	target meta.Node,
	targetPath string,
	stats mediaFolderStats,
) mediaSyncFolderDTO {
	return mediaSyncFolderDTO{
		SourceID: source.ID, SourceName: source.Name, SourceKind: source.Kind,
		SourceStatus: source.Status, TargetNodeID: target.ID, TargetName: target.Name,
		TargetPath: targetPath, DirectMediaCount: stats.DirectMediaCount,
		ChildFolderCount: stats.ChildFolderCount, CoverNodeID: stats.CoverNodeID,
	}
}

func (s *Server) queryMediaSyncFolders(
	ctx context.Context,
	ownerID uint64,
) ([]mediaSyncFolderDTO, error) {
	var sources []meta.Source
	if err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND target_node_id IS NOT NULL", ownerID).
		Order("lower(name) ASC, id ASC").
		Find(&sources).Error; err != nil {
		return nil, err
	}
	if len(sources) == 0 {
		return []mediaSyncFolderDTO{}, nil
	}
	targetIDs := make([]uint64, 0, len(sources))
	for _, source := range sources {
		if source.TargetNodeID != nil {
			targetIDs = append(targetIDs, *source.TargetNodeID)
		}
	}
	var targets []meta.Node
	if len(targetIDs) > 0 {
		if err := s.DB.WithContext(ctx).
			Where(
				"id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				targetIDs,
				ownerID,
				meta.NodeTypeDir,
			).
			Find(&targets).Error; err != nil {
			return nil, err
		}
	}
	targetByID := make(map[uint64]meta.Node, len(targets))
	for _, target := range targets {
		targetByID[target.ID] = target
	}
	statsByID, err := s.mediaFolderStatsByID(ctx, ownerID, targetIDs)
	if err != nil {
		return nil, err
	}
	out := make([]mediaSyncFolderDTO, 0, len(sources))
	for _, source := range sources {
		if source.TargetNodeID == nil {
			continue
		}
		target, ok := targetByID[*source.TargetNodeID]
		if !ok {
			continue
		}
		targetPath, err := s.mediaDirectoryPath(ctx, ownerID, target)
		if err != nil {
			return nil, err
		}
		out = append(out, mediaSyncFolderDTOFrom(
			source,
			target,
			targetPath,
			statsByID[target.ID],
		))
	}
	return out, nil
}

func (s *Server) mediaFolderBreadcrumbs(
	ctx context.Context,
	ownerID uint64,
	root meta.Node,
	current meta.Node,
) ([]mediaFolderBreadcrumbDTO, string, error) {
	nodes := []meta.Node{current}
	cursor := current
	for steps := 0; steps < 10000 && cursor.ID != root.ID; steps++ {
		if cursor.ParentID == nil {
			return nil, "", gorm.ErrRecordNotFound
		}
		var parent meta.Node
		if err := s.DB.WithContext(ctx).
			Where(
				"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*cursor.ParentID,
				ownerID,
				meta.NodeTypeDir,
			).
			First(&parent).Error; err != nil {
			return nil, "", err
		}
		nodes = append(nodes, parent)
		cursor = parent
	}
	if cursor.ID != root.ID {
		return nil, "", gorm.ErrRecordNotFound
	}
	for left, right := 0, len(nodes)-1; left < right; left, right = left+1, right-1 {
		nodes[left], nodes[right] = nodes[right], nodes[left]
	}
	rootPath, err := s.mediaDirectoryPath(ctx, ownerID, root)
	if err != nil {
		return nil, "", err
	}
	breadcrumbs := make([]mediaFolderBreadcrumbDTO, 0, len(nodes))
	currentPath := rootPath
	for index, node := range nodes {
		if index > 0 {
			currentPath = path.Join(currentPath, node.Name)
		}
		breadcrumbs = append(breadcrumbs, mediaFolderBreadcrumbDTO{
			ID: node.ID, Name: node.Name, Path: currentPath,
		})
	}
	return breadcrumbs, currentPath, nil
}

func (s *Server) queryMediaFolderView(
	ctx context.Context,
	ownerID uint64,
	sourceID uint64,
	folderID uint64,
) (mediaFolderViewDTO, error) {
	source, root, err := s.mediaSyncFolderSource(ctx, ownerID, sourceID)
	if err != nil {
		return mediaFolderViewDTO{}, err
	}
	var current meta.Node
	if err := s.DB.WithContext(ctx).
		Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			folderID,
			ownerID,
			meta.NodeTypeDir,
		).
		First(&current).Error; err != nil {
		return mediaFolderViewDTO{}, err
	}
	breadcrumbs, currentPath, err := s.mediaFolderBreadcrumbs(
		ctx,
		ownerID,
		root,
		current,
	)
	if err != nil {
		return mediaFolderViewDTO{}, err
	}

	var children []meta.Node
	if err := s.DB.WithContext(ctx).
		Where(
			"owner_id = ? AND parent_id = ? AND type = ? AND deleted_at IS NULL",
			ownerID,
			current.ID,
			meta.NodeTypeDir,
		).
		Order("lower(name) ASC, id ASC").
		Find(&children).Error; err != nil {
		return mediaFolderViewDTO{}, err
	}
	statsIDs := make([]uint64, 0, len(children)+2)
	statsIDs = append(statsIDs, root.ID, current.ID)
	for _, child := range children {
		statsIDs = append(statsIDs, child.ID)
	}
	statsByID, err := s.mediaFolderStatsByID(ctx, ownerID, statsIDs)
	if err != nil {
		return mediaFolderViewDTO{}, err
	}
	rootPath, err := s.mediaDirectoryPath(ctx, ownerID, root)
	if err != nil {
		return mediaFolderViewDTO{}, err
	}
	out := mediaFolderViewDTO{
		Source: mediaSyncFolderDTOFrom(source, root, rootPath, statsByID[root.ID]),
		Current: mediaFolderEntryDTO{
			ID: current.ID, ParentID: current.ParentID, Name: current.Name,
			Path: currentPath, DirectMediaCount: statsByID[current.ID].DirectMediaCount,
			ChildFolderCount: statsByID[current.ID].ChildFolderCount,
			CoverNodeID:      statsByID[current.ID].CoverNodeID,
		},
		Breadcrumbs: breadcrumbs,
		Children:    make([]mediaFolderEntryDTO, 0, len(children)),
	}
	for _, child := range children {
		stats := statsByID[child.ID]
		out.Children = append(out.Children, mediaFolderEntryDTO{
			ID: child.ID, ParentID: child.ParentID, Name: child.Name,
			Path:             path.Join(currentPath, child.Name),
			DirectMediaCount: stats.DirectMediaCount,
			ChildFolderCount: stats.ChildFolderCount,
			CoverNodeID:      stats.CoverNodeID,
		})
	}
	return out, nil
}

func (s *Server) listMediaSyncFolders(c *gin.Context) {
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	items, err := s.queryMediaSyncFolders(c.Request.Context(), userID(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, "list media sync folders failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) getMediaSyncFolder(c *gin.Context) {
	sourceID, ok := parseID(c.Param("sourceID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	folderID, ok := parseID(c.Param("folderID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid folder id")
		return
	}
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	view, err := s.queryMediaFolderView(
		c.Request.Context(),
		userID(c),
		sourceID,
		folderID,
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "media sync folder not found")
		} else {
			fail(c, http.StatusInternalServerError, "load media sync folder failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, view)
}
