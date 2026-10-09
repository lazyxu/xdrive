package api

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaFoldMaxAssetsPerGroup = 512
	mediaFoldBatchAssets       = 384
)

// Verified folds are a view projection only: never rewrite Nodes, PhotoAssets,
// editing recipes, collection memberships, or per-copy user metadata.
type mediaVerifiedFold struct {
	GroupID uint64
	NodeIDs []uint64
}

type mediaVerifiedFoldIndex struct {
	ByNode      map[uint64]mediaVerifiedFold
	MappingJSON string
}

type mediaFoldMapRow struct {
	NodeID  uint64 `json:"node_id"`
	GroupID uint64 `json:"group_id"`
}

func (index *mediaVerifiedFoldIndex) members(nodeID uint64) []uint64 {
	if index == nil {
		return nil
	}
	if group, ok := index.ByNode[nodeID]; ok {
		return group.NodeIDs
	}
	return nil
}

func (index *mediaVerifiedFoldIndex) foldRankedIDs(ranked []uint64) []uint64 {
	if index == nil {
		return ranked
	}
	seen := make(map[uint64]struct{})
	out := make([]uint64, 0, len(ranked))
	for _, id := range ranked {
		group := id
		if fold, ok := index.ByNode[id]; ok {
			group = fold.GroupID
		}
		if _, exists := seen[group]; exists {
			continue
		}
		seen[group] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (s *Server) prepareVerifiedMediaFolding(
	ctx context.Context, ownerID uint64, options mediaQueryOptions,
) (mediaQueryOptions, error) {
	if !options.FoldDuplicates || len(options.FoldMemberIDs) != 0 {
		return options, nil
	}
	index, err := s.buildVerifiedMediaFoldIndex(ctx, ownerID)
	if err != nil {
		return options, err
	}
	options.foldIndex = index
	return options, nil
}

// Only SHA-256 primary candidates are considered; comparisons use full original
// resources and current edit recipes, never filename/date similarity. Oversize
// or incomplete evidence fails closed and remains separately visible.
func (s *Server) buildVerifiedMediaFoldIndex(
	ctx context.Context, ownerID uint64,
) (*mediaVerifiedFoldIndex, error) {
	index := &mediaVerifiedFoldIndex{ByNode: make(map[uint64]mediaVerifiedFold)}
	var aggregates []mediaDuplicateAggregateRow
	if err := s.duplicateAggregateQuery(ctx, ownerID).
		Order("cleanup_f.sha256 ASC").
		Scan(&aggregates).Error; err != nil {
		return nil, err
	}

	batch := make([]mediaDuplicateAggregateRow, 0, mediaFoldBatchAssets/2)
	batchSize := int64(0)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		hashes := make([]string, 0, len(batch))
		for _, aggregate := range batch {
			hashes = append(hashes, aggregate.SHA256)
		}
		members, err := s.duplicateMembers(ctx, ownerID, hashes)
		if err != nil {
			return err
		}
		byHash := make(map[string][]mediaDuplicateMemberRow, len(hashes))
		assetIDs := make([]uint64, 0, len(members))
		for _, member := range members {
			byHash[member.SHA256] = append(byHash[member.SHA256], member)
			assetIDs = append(assetIDs, member.AssetID)
		}
		if len(assetIDs) == 0 {
			return nil
		}
		var resources []meta.PhotoResource
		if err := s.DB.WithContext(ctx).
			Where("asset_id IN ?", assetIDs).
			Find(&resources).Error; err != nil {
			return err
		}
		resourceByAsset := make(map[uint64][]meta.PhotoResource, len(assetIDs))
		for _, resource := range resources {
			resourceByAsset[resource.AssetID] = append(resourceByAsset[resource.AssetID], resource)
		}
		var recipes []meta.PhotoEditRecipe
		if err := s.DB.WithContext(ctx).
			Where("owner_id = ? AND asset_id IN ?", ownerID, assetIDs).
			Find(&recipes).Error; err != nil {
			return err
		}
		recipeByAsset := make(map[uint64]meta.PhotoEditRecipe, len(recipes))
		for _, recipe := range recipes {
			recipeByAsset[recipe.AssetID] = recipe
		}
		for _, aggregate := range batch {
			groupMembers := byHash[aggregate.SHA256]
			if int64(len(groupMembers)) != aggregate.ItemCount {
				continue
			}
			identical := make(map[string][]uint64)
			for _, member := range groupMembers {
				recipe, hasRecipe := recipeByAsset[member.AssetID]
				identity, ok := duplicateAssetIdentityFor(
					member, resourceByAsset[member.AssetID], recipe, hasRecipe,
				)
				if !ok {
					continue
				}
				encoded, err := json.Marshal(identity)
				if err != nil {
					return err
				}
				identical[string(encoded)] = append(identical[string(encoded)], member.NodeID)
			}
			for _, ids := range identical {
				if len(ids) < 2 {
					continue
				}
				sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
				fold := mediaVerifiedFold{GroupID: ids[0], NodeIDs: ids}
				for _, id := range ids {
					index.ByNode[id] = fold
				}
			}
		}
		return nil
	}
	for _, aggregate := range aggregates {
		if aggregate.ItemCount < 2 || aggregate.ItemCount > mediaFoldMaxAssetsPerGroup {
			continue
		}
		if batchSize+aggregate.ItemCount > mediaFoldBatchAssets && len(batch) > 0 {
			if err := flush(); err != nil {
				return nil, err
			}
			batch = batch[:0]
			batchSize = 0
		}
		batch = append(batch, aggregate)
		batchSize += aggregate.ItemCount
	}
	if err := flush(); err != nil {
		return nil, err
	}
	if len(index.ByNode) == 0 {
		return index, nil
	}
	mapping := make([]mediaFoldMapRow, 0, len(index.ByNode))
	for id, fold := range index.ByNode {
		mapping = append(mapping, mediaFoldMapRow{NodeID: id, GroupID: fold.GroupID})
	}
	sort.Slice(mapping, func(i, j int) bool { return mapping[i].NodeID < mapping[j].NodeID })
	encoded, err := json.Marshal(mapping)
	if err != nil {
		return nil, err
	}
	index.MappingJSON = string(encoded)
	return index, nil
}

// Deduplicate *after* the user's filters, album scope and sort. The Window
// representative belongs to the current scope; matching rows are counted,
// paged, grouped and anchored consistently, including sparse virtual ranges.
func (s *Server) applyVerifiedMediaFolding(
	ctx context.Context, query *gorm.DB, options mediaQueryOptions,
) *gorm.DB {
	if options.foldIndex == nil || options.foldIndex.MappingJSON == "" ||
		len(options.FoldMemberIDs) != 0 {
		return query
	}
	// Only verified duplicate candidates need a window rank. The previous
	// LEFT JOIN ranked every otherwise unique PhotoAsset (100k rows per page)
	// and kept all their IDs. Here the INNER JOIN sees only the much smaller
	// verified map and excludes excess copies after the user's filters.
	// Ordinary assets never enter the window, and are retained by NOT IN.
	// No results are cached: changes to edits/resources/album membership
	// are re-verified for each opt-in request.
	const join = "JOIN jsonb_to_recordset(?::jsonb) " +
		"AS gallery_fold(node_id bigint, group_id bigint) ON gallery_fold.node_id = n.id"
	order := strings.Join(mediaGallerySortClauses(options), ", ")
	candidateRanks := query.Session(&gorm.Session{}).
		Joins(join, options.foldIndex.MappingJSON).
		Select("n.id AS node_id, ROW_NUMBER() OVER (" +
			"PARTITION BY gallery_fold.group_id ORDER BY " +
			order + ") AS fold_rank")
	losers := s.DB.WithContext(ctx).
		Table("(?) AS gallery_ranked", candidateRanks).
		Select("gallery_ranked.node_id").
		Where("gallery_ranked.fold_rank > 1")
	return query.Where("n.id NOT IN (?)", losers)
}
