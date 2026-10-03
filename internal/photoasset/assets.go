package photoasset

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Report struct {
	Assets      int
	Resources   int
	Collections int
	Memberships int
}

type desiredAsset struct {
	kind      string
	evidence  string
	primaryID uint64
	metadata  meta.MediaMetadata
	resources []desiredResource
}

type desiredResource struct {
	kind       string
	nodeID     uint64
	role       string
	ordinal    int
	name       string
	mediaKind  string
	mimeType   string
	size       int64
	sha256     string
	byteOffset int64
}

func ReconcileOwner(ctx context.Context, db *gorm.DB, ownerID uint64) (Report, error) {
	var report Report
	if db == nil || ownerID == 0 {
		return report, fmt.Errorf("photo asset reconciler is not configured")
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		assets, nodeToAsset, err := reconcileAssetsDB(tx, ownerID)
		if err != nil {
			return err
		}
		collections, memberships, err := reconcileCollectionsDB(tx, ownerID, nodeToAsset)
		if err != nil {
			return err
		}
		report.Assets = len(assets)
		for _, asset := range assets {
			report.Resources += len(asset.resources)
		}
		report.Collections = collections
		report.Memberships = memberships
		return nil
	})
	return report, err
}

func reconcileAssetsDB(tx *gorm.DB, ownerID uint64) ([]desiredAsset, map[uint64]uint64, error) {
	var metadata []meta.MediaMetadata
	if err := tx.
		Where("owner_id = ? AND index_state = ? AND media_kind IN ?",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Order("node_id ASC").
		Find(&metadata).Error; err != nil {
		return nil, nil, err
	}
	if len(metadata) == 0 {
		if err := tx.Where("owner_id = ?", ownerID).Delete(&meta.PhotoAsset{}).Error; err != nil {
			return nil, nil, err
		}
		if err := deleteDerivedCollections(tx, ownerID); err != nil {
			return nil, nil, err
		}
		return nil, map[uint64]uint64{}, nil
	}

	nodeIDs := make([]uint64, 0, len(metadata))
	metadataByNode := make(map[uint64]meta.MediaMetadata, len(metadata))
	for _, row := range metadata {
		nodeIDs = append(nodeIDs, row.NodeID)
		metadataByNode[row.NodeID] = row
	}
	var nodes []meta.Node
	if err := tx.Preload("File").
		Where("id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			nodeIDs, ownerID, meta.NodeTypeFile).
		Find(&nodes).Error; err != nil {
		return nil, nil, err
	}
	nodeByID := make(map[uint64]meta.Node, len(nodes))
	for _, node := range nodes {
		if node.File != nil {
			nodeByID[node.ID] = node
		}
	}

	groups, groupItems, err := loadGroups(tx, ownerID)
	if err != nil {
		return nil, nil, err
	}
	groupNodeIDs := make([]uint64, 0)
	for _, items := range groupItems {
		for _, item := range items {
			if _, exists := nodeByID[item.NodeID]; !exists {
				groupNodeIDs = append(groupNodeIDs, item.NodeID)
			}
		}
	}
	if len(groupNodeIDs) != 0 {
		var extraNodes []meta.Node
		if err := tx.Preload("File").
			Where(
				"id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				groupNodeIDs,
				ownerID,
				meta.NodeTypeFile,
			).
			Find(&extraNodes).Error; err != nil {
			return nil, nil, err
		}
		for _, node := range extraNodes {
			if node.File != nil {
				nodeByID[node.ID] = node
			}
		}
	}
	nodeGroupCount := make(map[uint64]int)
	for _, items := range groupItems {
		for _, item := range items {
			if _, ok := nodeByID[item.NodeID]; ok {
				nodeGroupCount[item.NodeID]++
			}
		}
	}

	groupedNodes := make(map[uint64]struct{})
	desired := make([]desiredAsset, 0, len(metadata))
	for _, group := range groups {
		asset, ok := desiredFromGroup(
			group,
			groupItems[group.ID],
			nodeByID,
			metadataByNode,
			nodeGroupCount,
		)
		if !ok {
			continue
		}
		desired = append(desired, asset)
		for _, resource := range asset.resources {
			if resource.kind == meta.PhotoResourceKindNode {
				groupedNodes[resource.nodeID] = struct{}{}
			}
		}
	}
	for _, row := range metadata {
		if _, grouped := groupedNodes[row.NodeID]; grouped {
			continue
		}
		node, ok := nodeByID[row.NodeID]
		if !ok {
			continue
		}
		asset, err := desiredFromNode(tx, node, row)
		if err != nil {
			return nil, nil, err
		}
		desired = append(desired, asset)
	}
	sort.Slice(desired, func(i, j int) bool { return desired[i].primaryID < desired[j].primaryID })

	desiredPrimary := make([]uint64, 0, len(desired))
	for _, asset := range desired {
		desiredPrimary = append(desiredPrimary, asset.primaryID)
	}
	if len(desiredPrimary) == 0 {
		if err := tx.Where("owner_id = ?", ownerID).Delete(&meta.PhotoAsset{}).Error; err != nil {
			return nil, nil, err
		}
	} else if err := tx.
		Where("owner_id = ? AND primary_node_id NOT IN ?", ownerID, desiredPrimary).
		Delete(&meta.PhotoAsset{}).Error; err != nil {
		return nil, nil, err
	}

	var existing []meta.PhotoAsset
	if err := tx.Where("owner_id = ?", ownerID).Find(&existing).Error; err != nil {
		return nil, nil, err
	}
	byPrimary := make(map[uint64]meta.PhotoAsset, len(existing))
	for _, row := range existing {
		byPrimary[row.PrimaryNodeID] = row
	}

	nodeToAsset := make(map[uint64]uint64)
	now := time.Now().UTC()
	for _, want := range desired {
		asset, exists := byPrimary[want.primaryID]
		if exists {
			if err := tx.Model(&meta.PhotoAsset{}).Where("id = ?", asset.ID).
				Updates(map[string]any{
					"kind":         want.kind,
					"evidence_key": want.evidence,
					"updated_at":   now,
				}).Error; err != nil {
				return nil, nil, err
			}
			asset.Kind = want.kind
			asset.EvidenceKey = want.evidence
		} else {
			asset = meta.PhotoAsset{
				OwnerID: ownerID, PrimaryNodeID: want.primaryID,
				Kind: want.kind, EvidenceKey: want.evidence,
				CreatedAt: now, UpdatedAt: now,
			}
			if err := tx.Create(&asset).Error; err != nil {
				return nil, nil, err
			}
			byPrimary[want.primaryID] = asset
		}

		if err := tx.Where("asset_id = ?", asset.ID).Delete(&meta.PhotoResource{}).Error; err != nil {
			return nil, nil, err
		}
		resources := make([]meta.PhotoResource, 0, len(want.resources))
		for _, resource := range want.resources {
			resources = append(resources, meta.PhotoResource{
				AssetID: asset.ID, ResourceKind: resource.kind,
				NodeID: resource.nodeID, Role: resource.role,
				Ordinal: resource.ordinal, Name: resource.name,
				MediaKind: resource.mediaKind, MIMEType: resource.mimeType,
				Size: resource.size, SHA256: resource.sha256,
				ByteOffset: resource.byteOffset,
				CreatedAt:  now, UpdatedAt: now,
			})
			if resource.kind == meta.PhotoResourceKindNode {
				nodeToAsset[resource.nodeID] = asset.ID
			}
		}
		if len(resources) != 0 {
			if err := tx.Create(&resources).Error; err != nil {
				return nil, nil, err
			}
		}

		metadataRow := meta.PhotoMetadata{
			AssetID:    asset.ID,
			MediaKind:  want.metadata.MediaKind,
			MIMEType:   want.metadata.MIMEType,
			Width:      want.metadata.Width,
			Height:     want.metadata.Height,
			DurationMS: want.metadata.DurationMS,
			CapturedAt: want.metadata.CapturedAt,
			Latitude:   want.metadata.Latitude,
			Longitude:  want.metadata.Longitude,
			AltitudeM:  want.metadata.AltitudeM,
			EXIFJSON:   want.metadata.EXIFJSON,
			VideoJSON:  want.metadata.VideoJSON,
			CreatedAt:  now, UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"media_kind", "mime_type", "width", "height", "duration_ms",
				"captured_at", "latitude", "longitude", "altitude_m",
				"exif_json", "video_json", "updated_at",
			}),
		}).Create(&metadataRow).Error; err != nil {
			return nil, nil, err
		}
	}
	return desired, nodeToAsset, nil
}

func loadGroups(tx *gorm.DB, ownerID uint64) ([]meta.MediaGroup, map[uint64][]meta.MediaGroupItem, error) {
	var groups []meta.MediaGroup
	if err := tx.Where("owner_id = ?", ownerID).Order("id ASC").Find(&groups).Error; err != nil {
		return nil, nil, err
	}
	out := make(map[uint64][]meta.MediaGroupItem, len(groups))
	if len(groups) == 0 {
		return groups, out, nil
	}
	ids := make([]uint64, 0, len(groups))
	for _, group := range groups {
		ids = append(ids, group.ID)
	}
	var items []meta.MediaGroupItem
	if err := tx.Where("group_id IN ?", ids).
		Order("group_id ASC, ordinal ASC").
		Find(&items).Error; err != nil {
		return nil, nil, err
	}
	for _, item := range items {
		out[item.GroupID] = append(out[item.GroupID], item)
	}
	return groups, out, nil
}

func desiredFromGroup(
	group meta.MediaGroup,
	items []meta.MediaGroupItem,
	nodeByID map[uint64]meta.Node,
	metadataByNode map[uint64]meta.MediaMetadata,
	nodeGroupCount map[uint64]int,
) (desiredAsset, bool) {
	if len(items) < 2 || !meta.ValidPhotoAssetKind(group.Kind) {
		return desiredAsset{}, false
	}
	primaryID := uint64(0)
	for _, item := range items {
		if nodeGroupCount[item.NodeID] != 1 {
			return desiredAsset{}, false
		}
		if _, ok := nodeByID[item.NodeID]; !ok {
			return desiredAsset{}, false
		}
		row, hasMetadata := metadataByNode[item.NodeID]
		if group.Kind == meta.PhotoAssetKindLivePhoto {
			switch item.Role {
			case meta.MediaGroupRoleStill:
				if !hasMetadata || row.MediaKind != meta.MediaKindImage {
					return desiredAsset{}, false
				}
				primaryID = item.NodeID
			case meta.MediaGroupRoleMotion:
				if !hasMetadata || row.MediaKind != meta.MediaKindVideo {
					return desiredAsset{}, false
				}
			default:
				return desiredAsset{}, false
			}
			continue
		}
		if item.Role == meta.MediaGroupRolePrimary || item.Role == meta.MediaGroupRoleRendered {
			if hasMetadata {
				primaryID = item.NodeID
			}
		}
	}
	if primaryID == 0 {
		for _, item := range items {
			if _, ok := metadataByNode[item.NodeID]; ok {
				primaryID = item.NodeID
				break
			}
		}
	}
	if primaryID == 0 {
		return desiredAsset{}, false
	}
	primaryMetadata, ok := metadataByNode[primaryID]
	if !ok {
		return desiredAsset{}, false
	}
	asset := desiredAsset{
		kind:      group.Kind,
		evidence:  "group:" + strconv.FormatUint(group.ID, 10),
		primaryID: primaryID,
		metadata:  primaryMetadata,
		resources: make([]desiredResource, 0, len(items)),
	}
	for _, item := range items {
		node := nodeByID[item.NodeID]
		row, hasMetadata := metadataByNode[item.NodeID]
		mediaKind := meta.MediaKindOther
		mimeType := ""
		if hasMetadata {
			mediaKind = row.MediaKind
			mimeType = row.MIMEType
		}
		asset.resources = append(asset.resources, desiredResource{
			kind:      meta.PhotoResourceKindNode,
			nodeID:    node.ID,
			role:      item.Role,
			ordinal:   item.Ordinal,
			name:      node.Name,
			mediaKind: mediaKind,
			mimeType:  mimeType,
			size:      node.File.Size,
			sha256:    node.File.SHA256,
		})
	}
	return asset, true
}

func desiredFromNode(tx *gorm.DB, node meta.Node, row meta.MediaMetadata) (desiredAsset, error) {
	asset := desiredAsset{
		kind:      row.MediaKind,
		evidence:  "node:" + strconv.FormatUint(node.ID, 10),
		primaryID: node.ID,
		metadata:  row,
	}
	if strings.TrimSpace(row.ContainerKind) == "" {
		asset.resources = append(asset.resources, desiredResource{
			kind:      meta.PhotoResourceKindNode,
			nodeID:    node.ID,
			role:      meta.PhotoResourceRolePrimary,
			ordinal:   0,
			name:      node.Name,
			mediaKind: row.MediaKind,
			mimeType:  row.MIMEType,
			size:      node.File.Size,
			sha256:    node.File.SHA256,
		})
		return asset, nil
	}

	asset.resources = append(asset.resources, desiredResource{
		kind:      meta.PhotoResourceKindNode,
		nodeID:    node.ID,
		role:      meta.PhotoResourceRoleContainer,
		ordinal:   0,
		name:      node.Name,
		mediaKind: row.MediaKind,
		mimeType:  row.MIMEType,
		size:      node.File.Size,
		sha256:    node.File.SHA256,
	})
	var derived []meta.MediaDerivedResource
	if err := tx.Where("node_id = ?", node.ID).Order("role ASC").Find(&derived).Error; err != nil {
		return desiredAsset{}, err
	}
	for index, resource := range derived {
		asset.resources = append(asset.resources, desiredResource{
			kind:       meta.PhotoResourceKindDerived,
			nodeID:     node.ID,
			role:       resource.Role,
			ordinal:    index + 1,
			name:       resource.Name,
			mediaKind:  resource.MediaKind,
			mimeType:   resource.MIMEType,
			size:       resource.ByteSize,
			sha256:     resource.SHA256,
			byteOffset: resource.ByteOffset,
		})
	}
	return asset, nil
}
