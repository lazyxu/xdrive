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

// photoAssetNodeBatchSize bounds both the Node query and GORM's File preload
// below PostgreSQL's 65,535-parameter extended-protocol limit.
const photoAssetNodeBatchSize = 4096

func preloadPhotoAssetNodes(tx *gorm.DB, ownerID uint64, nodeIDs []uint64) ([]meta.Node, error) {
	nodes := make([]meta.Node, 0, len(nodeIDs))
	for offset := 0; offset < len(nodeIDs); offset += photoAssetNodeBatchSize {
		end := min(offset+photoAssetNodeBatchSize, len(nodeIDs))
		var batch []meta.Node
		if err := tx.Preload("File").
			Where("id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				nodeIDs[offset:end], ownerID, meta.NodeTypeFile).
			Find(&batch).Error; err != nil {
			return nil, err
		}
		nodes = append(nodes, batch...)
	}
	return nodes, nil
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
	nodes, err := preloadPhotoAssetNodes(tx, ownerID, nodeIDs)
	if err != nil {
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
		extraNodes, err := preloadPhotoAssetNodes(tx, ownerID, groupNodeIDs)
		if err != nil {
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

	desiredPrimary := make(map[uint64]struct{}, len(desired))
	for _, asset := range desired {
		desiredPrimary[asset.primaryID] = struct{}{}
	}
	byPrimary, err := loadAndPruneStalePhotoAssets(tx, ownerID, desiredPrimary)
	if err != nil {
		return nil, nil, err
	}

	nodeToAsset := make(map[uint64]uint64)
	now := time.Now().UTC()
	// Read existing projection rows in bounded windows. A clean repeat scan
	// must not issue four writes per unchanged PhotoAsset.
	for offset := 0; offset < len(desired); offset += photoAssetNodeBatchSize {
		end := min(offset+photoAssetNodeBatchSize, len(desired))
		batch := desired[offset:end]
		existingIDs := make([]uint64, 0, len(batch))
		for _, want := range batch {
			if current, exists := byPrimary[want.primaryID]; exists {
				existingIDs = append(existingIDs, current.ID)
			}
		}
		resourceByAsset := make(map[uint64][]meta.PhotoResource, len(existingIDs))
		metadataByAsset := make(map[uint64]meta.PhotoMetadata, len(existingIDs))
		if len(existingIDs) != 0 {
			var resourceRows []meta.PhotoResource
			if err := tx.Where("asset_id IN ?", existingIDs).Find(&resourceRows).Error; err != nil {
				return nil, nil, err
			}
			for _, row := range resourceRows {
				resourceByAsset[row.AssetID] = append(resourceByAsset[row.AssetID], row)
			}
			var metadataRows []meta.PhotoMetadata
			if err := tx.Where("asset_id IN ?", existingIDs).Find(&metadataRows).Error; err != nil {
				return nil, nil, err
			}
			for _, row := range metadataRows {
				metadataByAsset[row.AssetID] = row
			}
		}
		for _, want := range batch {
			current, exists := byPrimary[want.primaryID]
			if exists && current.Kind == want.kind && current.EvidenceKey == want.evidence {
				oldMetadata, metadataExists := metadataByAsset[current.ID]
				if metadataExists &&
					photoAssetTechnicalMetadataEqual(oldMetadata, want.metadata) &&
					photoAssetResourceRowsEqual(resourceByAsset[current.ID], want.resources) {
					for _, resource := range want.resources {
						if resource.kind == meta.PhotoResourceKindNode {
							nodeToAsset[resource.nodeID] = current.ID
						}
					}
					continue
				}
			}
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
	}
	return desired, nodeToAsset, nil
}

// photoAssetTechnicalMetadataEqual deliberately ignores user annotations,
// which are never overwritten by media reindexing (favorite, people, tags,
// description and vendor metadata). Technical metadata changes still run the
// existing upsert path.
func photoAssetTechnicalMetadataEqual(existing meta.PhotoMetadata, wanted meta.MediaMetadata) bool {
	return existing.MediaKind == wanted.MediaKind &&
		existing.MIMEType == wanted.MIMEType &&
		existing.Width == wanted.Width &&
		existing.Height == wanted.Height &&
		existing.DurationMS == wanted.DurationMS &&
		photoAssetCapturedAtEqual(existing.CapturedAt, wanted.CapturedAt) &&
		photoAssetOptionalFloatEqual(existing.Latitude, wanted.Latitude) &&
		photoAssetOptionalFloatEqual(existing.Longitude, wanted.Longitude) &&
		photoAssetOptionalFloatEqual(existing.AltitudeM, wanted.AltitudeM) &&
		existing.EXIFJSON == wanted.EXIFJSON &&
		existing.VideoJSON == wanted.VideoJSON
}

func photoAssetCapturedAtEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func photoAssetOptionalFloatEqual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// PhotoResources can be returned in any SQL row order, so compare as a
// one-to-one multiset rather than relying on positional equivalence.
func photoAssetResourceRowsEqual(existing []meta.PhotoResource, wanted []desiredResource) bool {
	if len(existing) != len(wanted) {
		return false
	}
	used := make([]bool, len(existing))
	for _, want := range wanted {
		found := false
		for i, current := range existing {
			if used[i] ||
				current.ResourceKind != want.kind ||
				current.NodeID != want.nodeID ||
				current.Role != want.role ||
				current.Ordinal != want.ordinal ||
				current.Name != want.name ||
				current.MediaKind != want.mediaKind ||
				current.MIMEType != want.mimeType ||
				current.Size != want.size ||
				current.SHA256 != want.sha256 ||
				current.ByteOffset != want.byteOffset {
				continue
			}
			used[i] = true
			found = true
			break
		}
		if !found {
			return false
		}
	}
	return true
}

// loadAndPruneStalePhotoAssets reuses the owner-scoped existing asset read,
// replacing the unbounded primary_node_id NOT IN expansion with a bounded
// in-memory membership check and 4,096-ID delete batches. A soft-deleted
// primary Node is deliberately absent from the active set: its PhotoAsset,
// PhotoMetadata, edits and user annotations remain frozen until hard deletion.
func loadAndPruneStalePhotoAssets(
	tx *gorm.DB,
	ownerID uint64,
	desiredPrimary map[uint64]struct{},
) (map[uint64]meta.PhotoAsset, error) {
	var existing []meta.PhotoAsset
	if err := tx.Where("owner_id = ?", ownerID).Find(&existing).Error; err != nil {
		return nil, err
	}
	var activePrimaryIDs []uint64
	if err := tx.Table("xd_photo_assets AS a").
		Joins("JOIN xd_nodes AS n ON n.id = a.primary_node_id").
		Where("a.owner_id = ? AND n.owner_id = ? AND n.deleted_at IS NULL", ownerID, ownerID).
		Pluck("n.id", &activePrimaryIDs).Error; err != nil {
		return nil, err
	}
	active := make(map[uint64]struct{}, len(activePrimaryIDs))
	for _, id := range activePrimaryIDs {
		active[id] = struct{}{}
	}
	byPrimary := make(map[uint64]meta.PhotoAsset, len(existing))
	staleIDs := make([]uint64, 0)
	for _, asset := range existing {
		_, activePrimary := active[asset.PrimaryNodeID]
		_, desired := desiredPrimary[asset.PrimaryNodeID]
		if activePrimary && !desired {
			staleIDs = append(staleIDs, asset.ID)
			continue
		}
		byPrimary[asset.PrimaryNodeID] = asset
	}
	for start := 0; start < len(staleIDs); start += photoAssetNodeBatchSize {
		end := min(start+photoAssetNodeBatchSize, len(staleIDs))
		if err := tx.Where("owner_id = ? AND id IN ?", ownerID, staleIDs[start:end]).
			Delete(&meta.PhotoAsset{}).Error; err != nil {
			return nil, err
		}
	}
	return byPrimary, nil
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
	assetKind := row.MediaKind
	if strings.EqualFold(strings.TrimSpace(row.ContainerKind), "livp") {
		assetKind = meta.PhotoAssetKindLivePhoto
	}
	asset := desiredAsset{
		kind:      assetKind,
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
