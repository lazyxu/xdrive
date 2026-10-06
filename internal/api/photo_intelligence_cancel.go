package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func (s *Server) rollbackPhotoIntelligenceOwnerAfterCancel(
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) error {
	if s == nil || s.DB == nil || ownerID == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundOwnerCancelTimeout,
	)
	defer cancel()
	now := time.Now().UTC()

	switch kind {
	case photoIntelligenceFace:
		assetIDs := s.DB.WithContext(ctx).
			Model(&meta.PhotoAsset{}).
			Select("id").
			Where("owner_id = ?", ownerID)
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where("asset_id IN (?)", assetIDs).
			Where(
				"kind IN ?",
				[]string{
					meta.PhotoAnalysisKindFaceDetection,
					meta.PhotoAnalysisKindFaceEmbedding,
				},
			).
			Where("state = ?", meta.PhotoAnalysisStateRunning).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePlace:
		assetIDs := s.DB.WithContext(ctx).
			Model(&meta.PhotoAsset{}).
			Select("id").
			Where("owner_id = ?", ownerID)
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where("asset_id IN (?)", assetIDs).
			Where("kind = ?", meta.PhotoAnalysisKindPlaceLabel).
			Where("state = ?", meta.PhotoAnalysisStateRunning).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePersonCluster:
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoPersonClusterState{}).
			Where("owner_id = ?", ownerID).
			Where("state = ?", meta.PhotoAnalysisStateRunning).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	default:
		return nil
	}
}
