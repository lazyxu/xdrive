package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Only inspect a bounded set of assets on the cleanup landing page. A very
// large duplicate group remains reviewable but is explicitly unverified, never
// silently treated as safe to consolidate.
type mediaDuplicateAssetComparison struct {
	Status string
	Reason string
}

func (s *Server) duplicateAssetComparisons(
	ctx context.Context,
	ownerID uint64,
	aggregates []mediaDuplicateAggregateRow,
	membersByHash map[string][]mediaDuplicateMemberRow,
) (map[string]mediaDuplicateAssetComparison, error) {
	out := make(map[string]mediaDuplicateAssetComparison, len(aggregates))
	eligibleHashes := make([]string, 0, len(aggregates))
	assetIDs := make([]uint64, 0)
	for _, aggregate := range aggregates {
		members := membersByHash[aggregate.SHA256]
		if int64(len(members)) != aggregate.ItemCount || len(members) < 2 ||
			len(members)+len(assetIDs) > duplicateComparisonMaxAssets {
			continue
		}
		for _, member := range members {
			assetIDs = append(assetIDs, member.AssetID)
		}
		eligibleHashes = append(eligibleHashes, aggregate.SHA256)
	}
	if len(assetIDs) == 0 {
		return out, nil
	}

	// The member query already verifies owner and active primary Node. Check
	// owner again here so future callers cannot accidentally cross tenants.
	ownedAssets := s.DB.WithContext(ctx).Model(&meta.PhotoAsset{}).
		Select("id").Where("owner_id = ? AND id IN ?", ownerID, assetIDs)
	var resourceRows []meta.PhotoResource
	if err := s.DB.WithContext(ctx).Where("asset_id IN (?)", ownedAssets).
		Find(&resourceRows).Error; err != nil {
		return nil, err
	}
	resources := make(map[uint64][]meta.PhotoResource, len(assetIDs))
	for _, row := range resourceRows {
		resources[row.AssetID] = append(resources[row.AssetID], row)
	}
	var editRows []meta.PhotoEditRecipe
	if err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND asset_id IN ?", ownerID, assetIDs).
		Find(&editRows).Error; err != nil {
		return nil, err
	}
	recipes := make(map[uint64]meta.PhotoEditRecipe, len(editRows))
	for _, row := range editRows {
		recipes[row.AssetID] = row
	}
	for _, hash := range eligibleHashes {
		status, reason := classifyDuplicateAssetGroup(
			membersByHash[hash], resources, recipes,
		)
		out[hash] = mediaDuplicateAssetComparison{Status: status, Reason: reason}
	}
	return out, nil
}
