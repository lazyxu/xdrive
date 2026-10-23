package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// loadNarrowMediaMetadataPage sorts the original Owner-filtered Gallery range
// over Node IDs instead of sorting wide MediaMetadata (EXIF/video JSON and
// other payload). The second read is independently Owner-bound and restores
// precisely the order of the original query. No media data is cached.
func (s *Server) loadNarrowMediaMetadataPage(
	ctx context.Context,
	ownerID uint64,
	query *gorm.DB,
	options mediaQueryOptions,
	limit, offset int,
) ([]meta.MediaMetadata, error) {
	pageQuery := query.Session(&gorm.Session{})
	for _, clause := range mediaGallerySortClauses(options) {
		pageQuery = pageQuery.Order(clause)
	}
	var nodeIDs []uint64
	if err := pageQuery.Limit(limit).Offset(offset).
		Pluck("xd_media_metadata.node_id", &nodeIDs).Error; err != nil {
		return nil, err
	}
	if len(nodeIDs) == 0 {
		return []meta.MediaMetadata{}, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	var rows []meta.MediaMetadata
	if err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND node_id IN ?", ownerID, nodeIDs).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	byID := make(map[uint64]meta.MediaMetadata, len(rows))
	for _, row := range rows {
		byID[row.NodeID] = row
	}
	ordered := make([]meta.MediaMetadata, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		// A concurrent deletion can remove an item between the two reads.
		// Never rehydrate a missing row from another Owner or return stale data.
		if row, ok := byID[id]; ok {
			ordered = append(ordered, row)
		}
	}
	return ordered, nil
}
