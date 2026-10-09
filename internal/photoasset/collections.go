package photoasset

import (
	"sort"
	"strconv"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type desiredCollection struct {
	key     string
	kind    string
	name    string
	state   string
	members map[uint64]int64
}

func reconcileCollectionsDB(
	tx *gorm.DB,
	ownerID uint64,
	nodeToAsset map[uint64]uint64,
) (int, int, error) {
	desired := make(map[string]*desiredCollection)

	var assets []meta.PhotoAsset
	if err := tx.Where("owner_id = ?", ownerID).Find(&assets).Error; err != nil {
		return 0, 0, err
	}
	primaryIDs := make([]uint64, 0, len(assets))
	assetByPrimary := make(map[uint64]uint64, len(assets))
	for _, asset := range assets {
		primaryIDs = append(primaryIDs, asset.PrimaryNodeID)
		assetByPrimary[asset.PrimaryNodeID] = asset.ID
	}
	if len(primaryIDs) != 0 {
		// Avoid expanding all 100k primary IDs into a single PostgreSQL
		// statement (65,535 extended-protocol bind parameter limit).
		primaryNodes := make([]meta.Node, 0, len(primaryIDs))
		for start := 0; start < len(primaryIDs); start += photoAssetNodeBatchSize {
			end := min(start+photoAssetNodeBatchSize, len(primaryIDs))
			var rows []meta.Node
			if err := tx.Where(
				"id IN ? AND owner_id = ? AND deleted_at IS NULL",
				primaryIDs[start:end],
				ownerID,
			).Find(&rows).Error; err != nil {
				return 0, 0, err
			}
			primaryNodes = append(primaryNodes, rows...)
		}
		// Most photo assets belong to the same few directories. Do not
		// produce a 100k duplicate-ID parent-directory query.
		parentIDs := make([]uint64, 0)
		parentSeen := make(map[uint64]struct{})
		for _, node := range primaryNodes {
			if node.ParentID == nil {
				continue
			}
			id := *node.ParentID
			if _, seen := parentSeen[id]; seen {
				continue
			}
			parentSeen[id] = struct{}{}
			parentIDs = append(parentIDs, id)
		}
		parents := make(map[uint64]meta.Node, len(parentIDs))
		for start := 0; start < len(parentIDs); start += photoAssetNodeBatchSize {
			end := min(start+photoAssetNodeBatchSize, len(parentIDs))
			var rows []meta.Node
			if err := tx.Where(
				"id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				parentIDs[start:end],
				ownerID,
				meta.NodeTypeDir,
			).Find(&rows).Error; err != nil {
				return 0, 0, err
			}
			for _, row := range rows {
				parents[row.ID] = row
			}
		}
		for _, node := range primaryNodes {
			if node.ParentID == nil {
				continue
			}
			parent, ok := parents[*node.ParentID]
			if !ok {
				continue
			}
			key := "folder:" + strconv.FormatUint(parent.ID, 10)
			collection := desired[key]
			if collection == nil {
				collection = &desiredCollection{
					key:     key,
					kind:    meta.PhotoCollectionKindFolder,
					name:    parent.Name,
					state:   meta.PhotoCollectionStateActive,
					members: map[uint64]int64{},
				}
				desired[key] = collection
			}
			collection.members[assetByPrimary[node.ID]] = int64(node.ID)
		}
	}

	type sourceCollectionRow struct {
		ID    uint64
		Name  string
		State string
	}
	var sourceCollections []sourceCollectionRow
	if err := tx.Table("xd_source_collections AS sc").
		Select("sc.id, sc.name, sc.state").
		Joins("JOIN xd_sources AS src ON src.id = sc.source_id").
		Where("src.owner_id = ? AND sc.kind = ?", ownerID, "album").
		Order("sc.id ASC").
		Scan(&sourceCollections).Error; err != nil {
		return 0, 0, err
	}
	for _, row := range sourceCollections {
		state := meta.PhotoCollectionStateActive
		if row.State == meta.SourceCollectionStateMissing {
			state = meta.PhotoCollectionStateMissing
		}
		key := "source:" + strconv.FormatUint(row.ID, 10)
		desired[key] = &desiredCollection{
			key:     key,
			kind:    meta.PhotoCollectionKindSource,
			name:    row.Name,
			state:   state,
			members: map[uint64]int64{},
		}
	}
	if len(sourceCollections) != 0 {
		ids := make([]uint64, 0, len(sourceCollections))
		for _, row := range sourceCollections {
			ids = append(ids, row.ID)
		}
		type memberRow struct {
			CollectionID uint64
			NodeID       *uint64
			Position     int64
		}
		var rows []memberRow
		if err := tx.Table("xd_source_collection_items AS ci").
			Select("ci.collection_id, si.node_id, ci.position").
			Joins("JOIN xd_source_items AS si ON si.id = ci.source_item_id").
			Where("ci.collection_id IN ? AND si.node_id IS NOT NULL", ids).
			Order("ci.collection_id ASC, ci.position ASC").
			Scan(&rows).Error; err != nil {
			return 0, 0, err
		}
		for _, row := range rows {
			if row.NodeID == nil {
				continue
			}
			assetID, ok := nodeToAsset[*row.NodeID]
			if !ok {
				continue
			}
			key := "source:" + strconv.FormatUint(row.CollectionID, 10)
			collection := desired[key]
			if collection == nil || collection.state != meta.PhotoCollectionStateActive {
				continue
			}
			if previous, exists := collection.members[assetID]; !exists || row.Position < previous {
				collection.members[assetID] = row.Position
			}
		}
	}

	keys := make([]string, 0, len(desired))
	for key := range desired {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		if err := deleteDerivedCollections(tx, ownerID); err != nil {
			return 0, 0, err
		}
		return 0, 0, nil
	}
	if err := tx.Where(
		"owner_id = ? AND kind IN ? AND external_key NOT IN ?",
		ownerID,
		[]string{meta.PhotoCollectionKindFolder, meta.PhotoCollectionKindSource},
		keys,
	).Delete(&meta.PhotoCollection{}).Error; err != nil {
		return 0, 0, err
	}

	now := time.Now().UTC()
	memberships := 0
	for _, key := range keys {
		want := desired[key]
		var collection meta.PhotoCollection
		err := tx.Where(
			"owner_id = ? AND external_key = ?",
			ownerID,
			key,
		).First(&collection).Error
		switch {
		case err == nil:
			if err := tx.Model(&meta.PhotoCollection{}).
				Where("id = ?", collection.ID).
				Updates(map[string]any{
					"kind":       want.kind,
					"name":       want.name,
					"state":      want.state,
					"updated_at": now,
				}).Error; err != nil {
				return 0, 0, err
			}
		case err == gorm.ErrRecordNotFound:
			collection = meta.PhotoCollection{
				OwnerID:     ownerID,
				ExternalKey: want.key,
				Kind:        want.kind,
				Name:        want.name,
				State:       want.state,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			if err := tx.Create(&collection).Error; err != nil {
				return 0, 0, err
			}
		default:
			return 0, 0, err
		}

		// Keep unchanged membership rows (including their CreatedAt) stable.
		// Recreating 100k rows both wastes work and exceeds PostgreSQL's
		// extended-protocol bind limit in a single GORM Create().
		rows := make([]meta.PhotoCollectionAsset, 0, len(want.members))
		if want.state == meta.PhotoCollectionStateActive {
			type orderedMember struct {
				assetID  uint64
				position int64
			}
			ordered := make([]orderedMember, 0, len(want.members))
			for assetID, position := range want.members {
				ordered = append(ordered, orderedMember{
					assetID:  assetID,
					position: position,
				})
			}
			sort.Slice(ordered, func(i, j int) bool {
				if ordered[i].position != ordered[j].position {
					return ordered[i].position < ordered[j].position
				}
				return ordered[i].assetID < ordered[j].assetID
			})
			for ordinal, member := range ordered {
				rows = append(rows, meta.PhotoCollectionAsset{
					CollectionID: collection.ID,
					AssetID:      member.assetID,
					Position:     int64(ordinal),
					CreatedAt:    now,
					UpdatedAt:    now,
				})
			}
		}
		var existingMembers []meta.PhotoCollectionAsset
		if err := tx.Where("collection_id = ?", collection.ID).
			Find(&existingMembers).Error; err != nil {
			return 0, 0, err
		}
		unchanged := len(existingMembers) == len(rows)
		if unchanged {
			existingPositions := make(map[uint64]int64, len(existingMembers))
			for _, entry := range existingMembers {
				existingPositions[entry.AssetID] = entry.Position
			}
			for _, wanted := range rows {
				position, exists := existingPositions[wanted.AssetID]
				if !exists || position != wanted.Position {
					unchanged = false
					break
				}
			}
		}
		if !unchanged {
			if err := tx.Where("collection_id = ?", collection.ID).
				Delete(&meta.PhotoCollectionAsset{}).Error; err != nil {
				return 0, 0, err
			}
			if len(rows) != 0 {
				if err := tx.CreateInBatches(&rows, 1024).Error; err != nil {
					return 0, 0, err
				}
			}
		}
		memberships += len(rows)
	}
	return len(desired), memberships, nil
}

func deleteDerivedCollections(tx *gorm.DB, ownerID uint64) error {
	return tx.Where(
		"owner_id = ? AND kind IN ?",
		ownerID,
		[]string{meta.PhotoCollectionKindFolder, meta.PhotoCollectionKindSource},
	).Delete(&meta.PhotoCollection{}).Error
}
