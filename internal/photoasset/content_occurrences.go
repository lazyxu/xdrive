package photoasset

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type originalLocation struct {
	NodeID uint64 `json:"node_id"`
	Kind   string `json:"kind"`
	Role   string `json:"role"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Offset int64  `json:"offset"`
}

func persistContentOccurrences(tx *gorm.DB, ownerID uint64, desired []desiredAsset, nodeToAsset map[uint64]uint64, now time.Time) error {
	var existing []meta.PhotoAssetOccurrence
	if err := tx.Where("owner_id = ?", ownerID).Find(&existing).Error; err != nil {
		return err
	}
	byNode := make(map[uint64]meta.PhotoAssetOccurrence, len(existing))
	for _, row := range existing {
		byNode[row.PrimaryNodeID] = row
	}
	seen := make(map[uint64]bool)
	var changed []meta.PhotoAssetOccurrence
	for _, asset := range desired {
		for _, origin := range asset.origins {
			assetID := nodeToAsset[origin.primaryID]
			if assetID == 0 {
				return fmt.Errorf("photo source has no content mapping")
			}
			seen[origin.primaryID] = true
			locations := make([]originalLocation, 0, len(origin.resources))
			for _, resource := range origin.resources {
				locations = append(locations, originalLocation{NodeID: resource.nodeID, Kind: resource.kind, Role: resource.role, SHA256: resource.sha256, Size: resource.size, Offset: resource.byteOffset})
			}
			raw, err := json.Marshal(locations)
			if err != nil {
				return err
			}
			old, exists := byNode[origin.primaryID]
			if exists && old.AssetID == assetID && old.ResourcesJSON == string(raw) && old.Active {
				continue
			}
			created := now
			if exists {
				created = old.CreatedAt
			}
			changed = append(changed, meta.PhotoAssetOccurrence{PrimaryNodeID: origin.primaryID, OwnerID: ownerID, AssetID: assetID, ResourcesJSON: string(raw), Active: true, CreatedAt: created, UpdatedAt: now})
		}
	}
	if len(changed) != 0 {
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "primary_node_id"}}, DoUpdates: clause.AssignmentColumns([]string{"owner_id", "asset_id", "resources_json", "active", "updated_at"})}).CreateInBatches(&changed, photoAssetNodeBatchSize).Error; err != nil {
			return err
		}
	}
	var inactive []uint64
	for _, row := range existing {
		if row.Active && !seen[row.PrimaryNodeID] {
			inactive = append(inactive, row.PrimaryNodeID)
		}
	}
	for start := 0; start < len(inactive); start += photoAssetNodeBatchSize {
		if err := tx.Model(&meta.PhotoAssetOccurrence{}).Where("owner_id = ? AND primary_node_id IN ?", ownerID, inactive[start:min(start+photoAssetNodeBatchSize, len(inactive))]).Updates(map[string]any{"active": false, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}
