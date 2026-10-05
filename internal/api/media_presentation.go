package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/meta"
)

type mediaAssetPresentation struct {
	Kind        string
	Favorite    bool
	Tags        []string
	People      []string
	Description string
	Resources   []mediaResourceDTO
}

func (s *Server) photoAssetPresentations(
	ctx context.Context,
	uid uint64,
	primaryNodeIDs []uint64,
) (map[uint64]mediaAssetPresentation, error) {
	out := make(map[uint64]mediaAssetPresentation)
	if len(primaryNodeIDs) == 0 {
		return out, nil
	}

	var assets []meta.PhotoAsset
	if err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND primary_node_id IN ?", uid, primaryNodeIDs).
		Order("primary_node_id ASC").
		Find(&assets).Error; err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return out, nil
	}

	assetIDs := make([]uint64, 0, len(assets))
	primaryByAsset := make(map[uint64]uint64, len(assets))
	for _, asset := range assets {
		assetIDs = append(assetIDs, asset.ID)
		primaryByAsset[asset.ID] = asset.PrimaryNodeID
		out[asset.PrimaryNodeID] = mediaAssetPresentation{Kind: asset.Kind}
	}

	var assetMetadata []meta.PhotoMetadata
	if err := s.DB.WithContext(ctx).
		Select("asset_id", "favorite", "tags_json", "people_json", "description").
		Where("asset_id IN ?", assetIDs).
		Find(&assetMetadata).Error; err != nil {
		return nil, err
	}
	for _, metadata := range assetMetadata {
		primaryNodeID, ok := primaryByAsset[metadata.AssetID]
		if !ok {
			continue
		}
		presentation := out[primaryNodeID]
		presentation.Favorite = metadata.Favorite
		tags, err := decodeMediaTags(metadata.TagsJSON)
		if err != nil {
			return nil, err
		}
		presentation.Tags = tags
		people, err := decodeMediaPeople(metadata.PeopleJSON)
		if err != nil {
			return nil, err
		}
		presentation.People = people
		presentation.Description = metadata.Description
		out[primaryNodeID] = presentation
	}

	var resources []meta.PhotoResource
	if err := s.DB.WithContext(ctx).
		Where("asset_id IN ?", assetIDs).
		Order("asset_id ASC, ordinal ASC, id ASC").
		Find(&resources).Error; err != nil {
		return nil, err
	}
	for _, resource := range resources {
		primaryNodeID, ok := primaryByAsset[resource.AssetID]
		if !ok {
			continue
		}
		presentation := out[primaryNodeID]
		presentation.Resources = append(presentation.Resources, mediaResourceDTO{
			Kind:      resource.ResourceKind,
			NodeID:    resource.NodeID,
			Role:      resource.Role,
			Name:      resource.Name,
			MediaKind: resource.MediaKind,
			MIMEType:  resource.MIMEType,
			Size:      resource.Size,
		})
		out[primaryNodeID] = presentation
	}
	return out, nil
}

func (s *Server) photoAssetPresentation(
	ctx context.Context,
	uid, primaryNodeID uint64,
) (mediaAssetPresentation, error) {
	values, err := s.photoAssetPresentations(ctx, uid, []uint64{primaryNodeID})
	if err != nil {
		return mediaAssetPresentation{}, err
	}
	return values[primaryNodeID], nil
}
