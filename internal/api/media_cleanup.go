package api

import (
	"context"
	"encoding/hex"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaCleanupDefaultLimit = 24
	mediaCleanupMaxLimit     = 100
)

type mediaDuplicateGroupDTO struct {
	ID                       string     `json:"id"`
	ItemCount                int64      `json:"item_count"`
	FileSizeBytes            int64      `json:"file_size_bytes"`
	LogicalDuplicateBytes    int64      `json:"logical_duplicate_bytes"`
	PhysicalReclaimableBytes int64      `json:"physical_reclaimable_bytes"`
	RecommendedKeepNodeID    uint64     `json:"recommended_keep_node_id"`
	RecommendationReason     string     `json:"recommendation_reason"`
	CoverNodeID              *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt                *time.Time `json:"updated_at,omitempty"`
}

type mediaDuplicateGroupListDTO struct {
	Groups                   []mediaDuplicateGroupDTO `json:"groups"`
	TotalGroups              int64                    `json:"total_groups"`
	TotalItems               int64                    `json:"total_items"`
	LogicalDuplicateBytes    int64                    `json:"logical_duplicate_bytes"`
	PhysicalReclaimableBytes int64                    `json:"physical_reclaimable_bytes"`
}

type mediaBurstReviewDTO struct {
	ID                       string     `json:"id"`
	ItemCount                int64      `json:"item_count"`
	RecommendedNodeID        uint64     `json:"recommended_node_id"`
	RecommendationReason     string     `json:"recommendation_reason"`
	CoverNodeID              *uint64    `json:"cover_node_id,omitempty"`
	TotalBytes               int64      `json:"total_bytes"`
	PotentialCleanupBytes    int64      `json:"potential_cleanup_bytes"`
	PhysicalReclaimableBytes int64      `json:"physical_reclaimable_bytes"`
	UpdatedAt                *time.Time `json:"updated_at,omitempty"`
}

type mediaBurstReviewListDTO struct {
	Groups                   []mediaBurstReviewDTO `json:"groups"`
	TotalGroups              int64                 `json:"total_groups"`
	TotalItems               int64                 `json:"total_items"`
	PotentialCleanupBytes    int64                 `json:"potential_cleanup_bytes"`
	PhysicalReclaimableBytes int64                 `json:"physical_reclaimable_bytes"`
}

type mediaDuplicateAggregateRow struct {
	SHA256        string
	ItemCount     int64
	FileSizeBytes int64
	UpdatedAt     *time.Time
}

type mediaDuplicateMemberRow struct {
	SHA256           string
	NodeID           uint64
	Favorite         bool
	TagsJSON         string
	PeopleJSON       string
	Description      string
	ManualAlbumCount int64
	CreatedAt        time.Time
}

type mediaBurstMemberRow struct {
	GroupID      uint64
	NodeID       uint64
	Ordinal      int
	Width        int
	Height       int
	Size         int64
	SHA256       string
	BlobRefCount int64
	UpdatedAt    time.Time
}

func mediaCleanupLimit(c *gin.Context) (int, bool) {
	limit := mediaCleanupDefaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaCleanupMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return 0, false
		}
		limit = value
	}
	return limit, true
}

func mediaDuplicateID(sha256 string) string {
	return "duplicate:v1:" + strings.ToLower(strings.TrimSpace(sha256))
}

func parseMediaDuplicateID(value string) (string, bool) {
	const prefix = "duplicate:v1:"
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	raw := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, prefix)))
	if len(raw) != 64 {
		return "", false
	}
	decoded, err := hex.DecodeString(raw)
	if err != nil || len(decoded) != 32 {
		return "", false
	}
	return raw, true
}

func mediaBurstReviewID(groupID uint64) string {
	return "burst:v1:" + strconv.FormatUint(groupID, 10)
}

func parseMediaBurstReviewID(value string) (uint64, bool) {
	const prefix = "burst:v1:"
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, prefix) {
		return 0, false
	}
	groupID, err := strconv.ParseUint(strings.TrimPrefix(value, prefix), 10, 64)
	return groupID, err == nil && groupID != 0
}

func hasMediaCleanupJSONList(raw string) bool {
	raw = strings.TrimSpace(raw)
	return raw != "" && raw != "[]" && raw != "null"
}

func duplicateMemberIntentScore(row mediaDuplicateMemberRow) int64 {
	var score int64
	if row.Favorite {
		score += 1_000_000
	}
	score += row.ManualAlbumCount * 10_000
	if strings.TrimSpace(row.Description) != "" {
		score += 1_000
	}
	if hasMediaCleanupJSONList(row.TagsJSON) {
		score += 500
	}
	if hasMediaCleanupJSONList(row.PeopleJSON) {
		score += 500
	}
	return score
}

func duplicateRecommendationReason(row mediaDuplicateMemberRow) string {
	switch {
	case row.Favorite:
		return "优先保留已收藏副本"
	case row.ManualAlbumCount > 0:
		return "优先保留已加入手动相册的副本"
	case strings.TrimSpace(row.Description) != "" ||
		hasMediaCleanupJSONList(row.TagsJSON) ||
		hasMediaCleanupJSONList(row.PeopleJSON):
		return "优先保留带有标签、人物或描述的副本"
	default:
		return "内容完全相同；默认保留较早导入的副本"
	}
}

func chooseDuplicateKeep(rows []mediaDuplicateMemberRow) (mediaDuplicateMemberRow, bool) {
	if len(rows) == 0 {
		return mediaDuplicateMemberRow{}, false
	}
	best := rows[0]
	for _, row := range rows[1:] {
		rowScore := duplicateMemberIntentScore(row)
		bestScore := duplicateMemberIntentScore(best)
		switch {
		case rowScore > bestScore:
			best = row
		case rowScore < bestScore:
			continue
		case row.CreatedAt.Before(best.CreatedAt):
			best = row
		case row.CreatedAt.Equal(best.CreatedAt) && row.NodeID < best.NodeID:
			best = row
		}
	}
	return best, true
}

func (s *Server) duplicateAggregateQuery(
	ctx context.Context,
	ownerID uint64,
) *gorm.DB {
	return s.DB.WithContext(ctx).
		Table("xd_photo_assets AS cleanup_pa").
		Select(
			"cleanup_f.sha256 AS sha256, "+
				"COUNT(DISTINCT cleanup_pa.id) AS item_count, "+
				"MAX(cleanup_f.size) AS file_size_bytes, "+
				"MAX(cleanup_n.updated_at) AS updated_at",
		).
		Joins(
			"JOIN xd_nodes AS cleanup_n ON cleanup_n.id = cleanup_pa.primary_node_id "+
				"AND cleanup_n.owner_id = cleanup_pa.owner_id AND cleanup_n.deleted_at IS NULL",
		).
		Joins("JOIN xd_files AS cleanup_f ON cleanup_f.node_id = cleanup_n.id").
		Joins(
			"JOIN xd_media_metadata AS cleanup_mm ON cleanup_mm.node_id = cleanup_n.id "+
				"AND cleanup_mm.owner_id = cleanup_pa.owner_id AND cleanup_mm.index_state = ?",
			meta.MediaIndexStateReady,
		).
		Where(
			"cleanup_pa.owner_id = ? AND cleanup_f.sha256 <> '' AND "+
				"cleanup_mm.media_kind IN ?",
			ownerID,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Group("cleanup_f.sha256").
		Having("COUNT(DISTINCT cleanup_pa.id) > 1")
}

func (s *Server) duplicateMembers(
	ctx context.Context,
	ownerID uint64,
	hashes []string,
) ([]mediaDuplicateMemberRow, error) {
	if len(hashes) == 0 {
		return []mediaDuplicateMemberRow{}, nil
	}
	var rows []mediaDuplicateMemberRow
	err := s.DB.WithContext(ctx).
		Table("xd_photo_assets AS cleanup_pa").
		Select(
			"cleanup_f.sha256 AS sha256, cleanup_pa.primary_node_id AS node_id, "+
				"cleanup_pm.favorite, cleanup_pm.tags_json, cleanup_pm.people_json, "+
				"cleanup_pm.description, cleanup_n.created_at, "+
				"COUNT(DISTINCT CASE WHEN cleanup_pc.kind = ? AND cleanup_pc.state = ? "+
				"THEN cleanup_pc.id ELSE NULL END) AS manual_album_count",
			meta.PhotoCollectionKindManual,
			meta.PhotoCollectionStateActive,
		).
		Joins(
			"JOIN xd_nodes AS cleanup_n ON cleanup_n.id = cleanup_pa.primary_node_id "+
				"AND cleanup_n.owner_id = cleanup_pa.owner_id AND cleanup_n.deleted_at IS NULL",
		).
		Joins("JOIN xd_files AS cleanup_f ON cleanup_f.node_id = cleanup_n.id").
		Joins(
			"JOIN xd_media_metadata AS cleanup_mm ON cleanup_mm.node_id = cleanup_n.id "+
				"AND cleanup_mm.owner_id = cleanup_pa.owner_id AND cleanup_mm.index_state = ?",
			meta.MediaIndexStateReady,
		).
		Joins("JOIN xd_photo_metadata AS cleanup_pm ON cleanup_pm.asset_id = cleanup_pa.id").
		Joins(
			"LEFT JOIN xd_photo_collection_assets AS cleanup_pca "+
				"ON cleanup_pca.asset_id = cleanup_pa.id",
		).
		Joins(
			"LEFT JOIN xd_photo_collections AS cleanup_pc "+
				"ON cleanup_pc.id = cleanup_pca.collection_id "+
				"AND cleanup_pc.owner_id = cleanup_pa.owner_id",
		).
		Where(
			"cleanup_pa.owner_id = ? AND cleanup_f.sha256 IN ?",
			ownerID,
			hashes,
		).
		Group(
			"cleanup_f.sha256, cleanup_pa.primary_node_id, cleanup_pm.favorite, " +
				"cleanup_pm.tags_json, cleanup_pm.people_json, cleanup_pm.description, " +
				"cleanup_n.created_at",
		).
		Order("cleanup_f.sha256 ASC, cleanup_pa.primary_node_id ASC").
		Scan(&rows).Error
	return rows, err
}

func (s *Server) queryDuplicateGroups(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (mediaDuplicateGroupListDTO, error) {
	var out mediaDuplicateGroupListDTO
	base := s.duplicateAggregateQuery(ctx, ownerID)
	var aggregates []mediaDuplicateAggregateRow
	if err := base.Session(&gorm.Session{}).
		Order("(COUNT(DISTINCT cleanup_pa.id) - 1) * MAX(cleanup_f.size) DESC").
		Order("cleanup_f.sha256 ASC").
		Limit(limit).
		Scan(&aggregates).Error; err != nil {
		return out, err
	}

	type totalsRow struct {
		TotalGroups           int64
		TotalItems            int64
		LogicalDuplicateBytes int64
	}
	var totals totalsRow
	if err := s.DB.WithContext(ctx).
		Table("(?) AS cleanup_duplicates", s.duplicateAggregateQuery(ctx, ownerID)).
		Select(
			"COUNT(*) AS total_groups, COALESCE(SUM(item_count), 0) AS total_items, " +
				"COALESCE(SUM((item_count - 1) * file_size_bytes), 0) AS logical_duplicate_bytes",
		).
		Scan(&totals).Error; err != nil {
		return out, err
	}
	out.TotalGroups = totals.TotalGroups
	out.TotalItems = totals.TotalItems
	out.LogicalDuplicateBytes = totals.LogicalDuplicateBytes
	// Exact duplicate content shares one CAS blob. Keeping one logical copy means
	// deleting the other references does not reclaim that physical blob.
	out.PhysicalReclaimableBytes = 0

	hashes := make([]string, 0, len(aggregates))
	for _, row := range aggregates {
		hashes = append(hashes, row.SHA256)
	}
	members, err := s.duplicateMembers(ctx, ownerID, hashes)
	if err != nil {
		return out, err
	}
	byHash := make(map[string][]mediaDuplicateMemberRow, len(hashes))
	for _, row := range members {
		byHash[row.SHA256] = append(byHash[row.SHA256], row)
	}
	out.Groups = make([]mediaDuplicateGroupDTO, 0, len(aggregates))
	for _, row := range aggregates {
		best, ok := chooseDuplicateKeep(byHash[row.SHA256])
		if !ok {
			continue
		}
		cover := best.NodeID
		out.Groups = append(out.Groups, mediaDuplicateGroupDTO{
			ID:                       mediaDuplicateID(row.SHA256),
			ItemCount:                row.ItemCount,
			FileSizeBytes:            row.FileSizeBytes,
			LogicalDuplicateBytes:    (row.ItemCount - 1) * row.FileSizeBytes,
			PhysicalReclaimableBytes: 0,
			RecommendedKeepNodeID:    best.NodeID,
			RecommendationReason:     duplicateRecommendationReason(best),
			CoverNodeID:              &cover,
			UpdatedAt:                row.UpdatedAt,
		})
	}
	return out, nil
}

func (s *Server) burstMembers(
	ctx context.Context,
	ownerID uint64,
) ([]mediaBurstMemberRow, error) {
	var rows []mediaBurstMemberRow
	err := s.DB.WithContext(ctx).
		Table("xd_media_groups AS cleanup_mg").
		Select(
			"cleanup_mg.id AS group_id, cleanup_mgi.node_id, cleanup_mgi.ordinal, "+
				"cleanup_mm.width, cleanup_mm.height, cleanup_f.size, cleanup_f.sha256, "+
				"COALESCE(cleanup_cb.ref_count, 0) AS blob_ref_count, cleanup_n.updated_at",
		).
		Joins(
			"JOIN xd_media_group_items AS cleanup_mgi ON cleanup_mgi.group_id = cleanup_mg.id",
		).
		Joins(
			"JOIN xd_nodes AS cleanup_n ON cleanup_n.id = cleanup_mgi.node_id "+
				"AND cleanup_n.owner_id = cleanup_mg.owner_id AND cleanup_n.deleted_at IS NULL",
		).
		Joins("JOIN xd_files AS cleanup_f ON cleanup_f.node_id = cleanup_n.id").
		Joins(
			"JOIN xd_media_metadata AS cleanup_mm ON cleanup_mm.node_id = cleanup_n.id "+
				"AND cleanup_mm.owner_id = cleanup_mg.owner_id AND cleanup_mm.index_state = ? "+
				"AND cleanup_mm.media_kind = ?",
			meta.MediaIndexStateReady,
			meta.MediaKindImage,
		).
		Joins(
			"LEFT JOIN xd_content_blobs AS cleanup_cb ON cleanup_cb.sha256 = cleanup_f.sha256",
		).
		Where(
			"cleanup_mg.owner_id = ? AND cleanup_mg.kind = ?",
			ownerID,
			meta.MediaGroupKindBurst,
		).
		Order("cleanup_mg.id ASC, cleanup_mgi.ordinal ASC, cleanup_mgi.node_id ASC").
		Scan(&rows).Error
	return rows, err
}

func burstPixels(row mediaBurstMemberRow) int64 {
	if row.Width <= 0 || row.Height <= 0 {
		return 0
	}
	return int64(row.Width) * int64(row.Height)
}

func burstCenterDistance(row mediaBurstMemberRow, count int) int {
	target := count - 1
	value := 2 * row.Ordinal
	if value >= target {
		return value - target
	}
	return target - value
}

func chooseBurstRecommendation(
	rows []mediaBurstMemberRow,
) (mediaBurstMemberRow, string, bool) {
	if len(rows) == 0 {
		return mediaBurstMemberRow{}, "", false
	}
	best := rows[0]
	maxPixels := burstPixels(best)
	allSamePixels := true
	for _, row := range rows[1:] {
		pixels := burstPixels(row)
		if pixels != maxPixels {
			allSamePixels = false
		}
		if pixels > maxPixels {
			maxPixels = pixels
		}
	}
	for _, row := range rows {
		rowPixels := burstPixels(row)
		bestPixels := burstPixels(best)
		switch {
		case rowPixels > bestPixels:
			best = row
		case rowPixels < bestPixels:
			continue
		case burstCenterDistance(row, len(rows)) < burstCenterDistance(best, len(rows)):
			best = row
		case burstCenterDistance(row, len(rows)) > burstCenterDistance(best, len(rows)):
			continue
		case row.Ordinal < best.Ordinal:
			best = row
		case row.Ordinal == best.Ordinal && row.NodeID < best.NodeID:
			best = row
		}
	}
	reason := "同等分辨率下推荐连拍中间帧"
	if !allSamePixels && burstPixels(best) == maxPixels {
		reason = "优先推荐有效分辨率更高的帧"
	}
	return best, reason, true
}

func (s *Server) queryBurstReviews(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (mediaBurstReviewListDTO, error) {
	var out mediaBurstReviewListDTO
	rows, err := s.burstMembers(ctx, ownerID)
	if err != nil {
		return out, err
	}
	byGroup := make(map[uint64][]mediaBurstMemberRow)
	for _, row := range rows {
		byGroup[row.GroupID] = append(byGroup[row.GroupID], row)
	}
	groups := make([]mediaBurstReviewDTO, 0, len(byGroup))
	for groupID, members := range byGroup {
		if len(members) < 2 {
			continue
		}
		best, reason, ok := chooseBurstRecommendation(members)
		if !ok {
			continue
		}
		var totalBytes, cleanupBytes, physicalBytes int64
		var updatedAt *time.Time
		removedRefsByHash := make(map[string]int64)
		refCountByHash := make(map[string]int64)
		sizeByHash := make(map[string]int64)
		for _, member := range members {
			totalBytes += member.Size
			if updatedAt == nil || member.UpdatedAt.After(*updatedAt) {
				value := member.UpdatedAt
				updatedAt = &value
			}
			if member.NodeID == best.NodeID {
				continue
			}
			cleanupBytes += member.Size
			if member.SHA256 != "" {
				removedRefsByHash[member.SHA256]++
				if member.BlobRefCount > refCountByHash[member.SHA256] {
					refCountByHash[member.SHA256] = member.BlobRefCount
				}
				if member.Size > sizeByHash[member.SHA256] {
					sizeByHash[member.SHA256] = member.Size
				}
			}
		}
		for sha256, removedRefs := range removedRefsByHash {
			refCount := refCountByHash[sha256]
			if refCount > 0 && removedRefs >= refCount {
				physicalBytes += sizeByHash[sha256]
			}
		}
		cover := best.NodeID
		groups = append(groups, mediaBurstReviewDTO{
			ID:                       mediaBurstReviewID(groupID),
			ItemCount:                int64(len(members)),
			RecommendedNodeID:        best.NodeID,
			RecommendationReason:     reason,
			CoverNodeID:              &cover,
			TotalBytes:               totalBytes,
			PotentialCleanupBytes:    cleanupBytes,
			PhysicalReclaimableBytes: physicalBytes,
			UpdatedAt:                updatedAt,
		})
	}
	sort.Slice(groups, func(i, j int) bool {
		left := groups[i].UpdatedAt
		right := groups[j].UpdatedAt
		if left != nil && right != nil && !left.Equal(*right) {
			return left.After(*right)
		}
		if left != nil && right == nil {
			return true
		}
		if left == nil && right != nil {
			return false
		}
		return groups[i].ID > groups[j].ID
	})
	out.TotalGroups = int64(len(groups))
	for _, group := range groups {
		out.TotalItems += group.ItemCount
		out.PotentialCleanupBytes += group.PotentialCleanupBytes
		out.PhysicalReclaimableBytes += group.PhysicalReclaimableBytes
	}
	if len(groups) > limit {
		groups = groups[:limit]
	}
	out.Groups = groups
	return out, nil
}

func (s *Server) cleanupMediaItems(
	ctx context.Context,
	ownerID uint64,
	nodeIDs []uint64,
) ([]mediaItemDTO, error) {
	if len(nodeIDs) == 0 {
		return []mediaItemDTO{}, nil
	}
	var metadata []meta.MediaMetadata
	if err := s.DB.WithContext(ctx).
		Where(
			"owner_id = ? AND node_id IN ? AND index_state = ? AND media_kind IN ?",
			ownerID,
			nodeIDs,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Find(&metadata).Error; err != nil {
		return nil, err
	}
	metadataByNode := make(map[uint64]meta.MediaMetadata, len(metadata))
	for _, row := range metadata {
		metadataByNode[row.NodeID] = row
	}
	var nodes []meta.Node
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where(
			"id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			nodeIDs,
			ownerID,
			meta.NodeTypeFile,
		).
		Find(&nodes).Error; err != nil {
		return nil, err
	}
	nodeByID := make(map[uint64]meta.Node, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	presentations, err := s.photoAssetPresentations(ctx, ownerID, nodeIDs)
	if err != nil {
		return nil, err
	}
	out := make([]mediaItemDTO, 0, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		node, nodeOK := nodeByID[nodeID]
		metadataRow, metadataOK := metadataByNode[nodeID]
		if !nodeOK || !metadataOK || node.File == nil {
			continue
		}
		presentation := presentations[nodeID]
		out = append(out, mediaItemDTO{
			Node:        toNodeDTO(node),
			Metadata:    toMediaMetadataDTO(metadataRow),
			AssetKind:   presentation.Kind,
			Favorite:    presentation.Favorite,
			Tags:        presentation.Tags,
			People:      presentation.People,
			Description: presentation.Description,
			Resources:   presentation.Resources,
		})
	}
	return out, nil
}

func (s *Server) queryDuplicateItemRange(
	ctx context.Context,
	ownerID uint64,
	sha256 string,
	limit, offset int,
) (mediaItemRangeDTO, error) {
	query, err := s.mediaItemsBaseQuery(ctx, ownerID, mediaQueryOptions{}, "")
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	query = query.
		Joins("JOIN xd_files AS cleanup_duplicate_f ON cleanup_duplicate_f.node_id = n.id").
		Where("cleanup_duplicate_f.sha256 = ?", sha256).
		Where("xd_media_metadata.index_state = ?", meta.MediaIndexStateReady)
	var total int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").
		Count(&total).Error; err != nil {
		return mediaItemRangeDTO{}, err
	}
	if total < 2 {
		return mediaItemRangeDTO{}, gorm.ErrRecordNotFound
	}
	items, err := s.materializeMediaItems(ctx, ownerID, query, limit, offset)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	return mediaItemRangeDTO{
		Items:      items,
		TotalCount: total,
		Offset:     offset,
		Limit:      limit,
	}, nil
}

func (s *Server) burstReviewNodeIDs(
	ctx context.Context,
	ownerID, groupID uint64,
) ([]uint64, error) {
	type row struct {
		NodeID uint64
	}
	var rows []row
	if err := s.DB.WithContext(ctx).
		Table("xd_media_groups AS cleanup_mg").
		Select("cleanup_mgi.node_id").
		Joins(
			"JOIN xd_media_group_items AS cleanup_mgi ON cleanup_mgi.group_id = cleanup_mg.id",
		).
		Joins(
			"JOIN xd_nodes AS cleanup_n ON cleanup_n.id = cleanup_mgi.node_id "+
				"AND cleanup_n.owner_id = cleanup_mg.owner_id AND cleanup_n.deleted_at IS NULL",
		).
		Joins(
			"JOIN xd_media_metadata AS cleanup_mm ON cleanup_mm.node_id = cleanup_n.id "+
				"AND cleanup_mm.owner_id = cleanup_mg.owner_id AND cleanup_mm.index_state = ? "+
				"AND cleanup_mm.media_kind = ?",
			meta.MediaIndexStateReady,
			meta.MediaKindImage,
		).
		Where(
			"cleanup_mg.id = ? AND cleanup_mg.owner_id = ? AND cleanup_mg.kind = ?",
			groupID,
			ownerID,
			meta.MediaGroupKindBurst,
		).
		Order("cleanup_mgi.ordinal ASC, cleanup_mgi.node_id ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, gorm.ErrRecordNotFound
	}
	out := make([]uint64, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.NodeID)
	}
	return out, nil
}

func (s *Server) queryBurstReviewItemRange(
	ctx context.Context,
	ownerID, groupID uint64,
	limit, offset int,
) (mediaItemRangeDTO, error) {
	nodeIDs, err := s.burstReviewNodeIDs(ctx, ownerID, groupID)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	total := len(nodeIDs)
	if offset >= total {
		return mediaItemRangeDTO{
			Items: []mediaItemDTO{}, TotalCount: int64(total),
			Offset: offset, Limit: limit,
		}, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	items, err := s.cleanupMediaItems(ctx, ownerID, nodeIDs[offset:end])
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	return mediaItemRangeDTO{
		Items:      items,
		TotalCount: int64(total),
		Offset:     offset,
		Limit:      limit,
	}, nil
}

func (s *Server) listMediaDuplicateGroups(c *gin.Context) {
	limit, ok := mediaCleanupLimit(c)
	if !ok {
		return
	}
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	result, err := s.queryDuplicateGroups(
		c.Request.Context(),
		userID(c),
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list duplicate media failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (s *Server) listMediaDuplicateItems(c *gin.Context) {
	sha256, ok := parseMediaDuplicateID(c.Param("duplicateID"))
	if !ok {
		fail(c, http.StatusNotFound, "duplicate group not found")
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	page, err := s.queryDuplicateItemRange(
		c.Request.Context(),
		userID(c),
		sha256,
		limit,
		offset,
	)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "duplicate group not found")
		} else {
			fail(c, http.StatusInternalServerError, "list duplicate media items failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		c.JSON(http.StatusOK, page)
		return
	}
	c.JSON(http.StatusOK, page.Items)
}

func (s *Server) listMediaBurstReviews(c *gin.Context) {
	limit, ok := mediaCleanupLimit(c)
	if !ok {
		return
	}
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	result, err := s.queryBurstReviews(
		c.Request.Context(),
		userID(c),
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list burst reviews failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (s *Server) listMediaBurstReviewItems(c *gin.Context) {
	groupID, ok := parseMediaBurstReviewID(c.Param("burstID"))
	if !ok {
		fail(c, http.StatusNotFound, "burst review not found")
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	page, err := s.queryBurstReviewItemRange(
		c.Request.Context(),
		userID(c),
		groupID,
		limit,
		offset,
	)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "burst review not found")
		} else {
			fail(c, http.StatusInternalServerError, "list burst review items failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		c.JSON(http.StatusOK, page)
		return
	}
	c.JSON(http.StatusOK, page.Items)
}
