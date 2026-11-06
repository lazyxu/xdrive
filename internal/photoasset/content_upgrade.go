package photoasset

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// prepareContentAssets resolves immutable identities before choosing a source
// locator. Legacy duplicates are folded only with complete equal byte evidence.
func prepareContentAssets(tx *gorm.DB, ownerID uint64, desired []desiredAsset) (map[uint64]meta.PhotoAsset, error) {
	var existing []meta.PhotoAsset
	if err := tx.Where("owner_id = ?", ownerID).Order("id ASC").Find(&existing).Error; err != nil {
		return nil, err
	}
	byKey := make(map[string][]meta.PhotoAsset)
	legacyByPrimary := make(map[uint64]meta.PhotoAsset)
	legacyIDs := make([]uint64, 0)
	for _, asset := range existing {
		if asset.ContentKey != "" {
			byKey[asset.ContentKey] = append(byKey[asset.ContentKey], asset)
		} else {
			legacyByPrimary[asset.PrimaryNodeID] = asset
			legacyIDs = append(legacyIDs, asset.ID)
		}
	}
	legacyResources := make(map[uint64][]meta.PhotoResource)
	legacyIdentities := make(map[uint64]ContentIdentity)
	for start := 0; start < len(legacyIDs); start += photoAssetNodeBatchSize {
		var rows []meta.PhotoResource
		if err := tx.Where("asset_id IN ?", legacyIDs[start:min(start+photoAssetNodeBatchSize, len(legacyIDs))]).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			legacyResources[row.AssetID] = append(legacyResources[row.AssetID], row)
		}
	}
	for _, asset := range existing {
		if asset.ContentKey != "" {
			continue
		}
		var originals []OriginalResource
		for _, resource := range legacyResources[asset.ID] {
			if resource.ResourceKind != meta.PhotoResourceKindNode || resource.Role == meta.PhotoResourceRoleContainer {
				originals = nil
				break // Parent/archive hashes never prove members.
			}
			originals = append(originals, OriginalResource{Role: resource.Role, SHA256: resource.SHA256, Size: resource.Size, Ordinal: resource.Ordinal})
		}
		if identity, err := IdentifyOriginals(asset.Kind, originals); err == nil {
			byKey[identity.Key] = append(byKey[identity.Key], asset)
			legacyIdentities[asset.ID] = identity
		}
	}
	result := make(map[uint64]meta.PhotoAsset)
	used := make(map[uint64]bool)
	for _, want := range desired {
		if want.identity.Key == "" {
			if legacy, ok := legacyByPrimary[want.primaryID]; ok && photoAssetResourceRowsEqual(legacyResources[legacy.ID], want.resources) {
				result[want.primaryID] = legacy
				used[legacy.ID] = true
			}
			continue
		}
		candidates := byKey[want.identity.Key]
		// A legacy container can be promoted only when its persisted source
		// ranges exactly match this newly verified current complete descriptor.
		seen := make(map[uint64]bool)
		for _, candidate := range candidates {
			if identity, ok := legacyIdentities[candidate.ID]; ok && identity.Manifest != want.identity.Manifest {
				return nil, fmt.Errorf("legacy photo manifest disagrees with original evidence")
			}
			seen[candidate.ID] = true
		}
		for _, origin := range want.origins {
			legacy, ok := legacyByPrimary[origin.primaryID]
			if ok && !seen[legacy.ID] && legacy.Kind == want.kind && photoAssetResourceRowsEqual(legacyResources[legacy.ID], origin.resources) {
				candidates = append(candidates, legacy)
				seen[legacy.ID] = true
			}
		}
		if len(candidates) == 0 {
			continue
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			if (candidates[i].ContentKey != "") != (candidates[j].ContentKey != "") {
				return candidates[i].ContentKey != ""
			}
			return candidates[i].ID < candidates[j].ID
		})
		keeper := candidates[0]
		if keeper.ContentKey != "" && keeper.ContentManifest != want.identity.Manifest {
			return nil, fmt.Errorf("existing photo content manifest disagrees with original evidence")
		}
		if keeper.ContentKey == "" {
			if err := tx.Model(&meta.PhotoAsset{}).Where("id = ? AND owner_id = ? AND content_key = ''", keeper.ID, ownerID).
				Updates(map[string]any{"content_key": want.identity.Key, "content_manifest": want.identity.Manifest, "evidence_key": want.identity.Key}).Error; err != nil {
				return nil, err
			}
			keeper.ContentKey, keeper.ContentManifest, keeper.EvidenceKey = want.identity.Key, want.identity.Manifest, want.identity.Key
		}
		for _, duplicate := range candidates[1:] {
			if duplicate.ContentKey != "" {
				return nil, fmt.Errorf("duplicate canonical photo identity")
			}
			if err := mergeLegacyContentAsset(tx, ownerID, keeper, duplicate); err != nil {
				return nil, err
			}
			used[duplicate.ID] = true
		}
		result[want.primaryID] = keeper
		used[keeper.ID] = true
	}
	// An old hash is never reattached to new bytes merely because Node ID is
	// unchanged. Keep hidden annotations for trash/restore; no CAS pin is added.
	if err := tx.Exec(`UPDATE xd_photo_collections pc SET preferred_cover_content_key = pa.content_key
	 FROM xd_photo_assets pa WHERE pc.owner_id = ? AND pa.owner_id = pc.owner_id
	 AND pc.preferred_cover_content_key = '' AND pc.preferred_cover_node_id = pa.primary_node_id AND pa.content_key <> ''`, ownerID).Error; err != nil {
		return nil, err
	}
	for _, asset := range existing {
		if used[asset.ID] || asset.PrimaryNodeID == 0 {
			continue
		}
		var node meta.Node
		err := tx.Where("id = ? AND owner_id = ?", asset.PrimaryNodeID, ownerID).First(&node).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, err
		}
		if err == nil && node.DeletedAt != nil {
			continue
		}
		updates := map[string]any{"primary_node_id": uint64(0)}
		if asset.ContentKey == "" {
			updates["evidence_key"] = fmt.Sprintf("legacy-asset:%d", asset.ID)
		}
		if err := tx.Model(&meta.PhotoAsset{}).Where("id = ? AND owner_id = ?", asset.ID, ownerID).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	return result, nil
}

func mergeLegacyContentAsset(tx *gorm.DB, ownerID uint64, keeper, duplicate meta.PhotoAsset) error {
	if keeper.OwnerID != ownerID || duplicate.OwnerID != ownerID || keeper.ID == duplicate.ID || keeper.ContentKey == "" {
		return fmt.Errorf("invalid photo identity migration scope")
	}
	// Lock user-owned rows before reading their values. A concurrent successful
	// edit must be included; an edit waiting on a removed alias cannot report a
	// successful write to the new content. Parent revisions invalidate old ETags.
	for _, relation := range []struct{ table, parent, column string }{
		{"xd_photo_collection_assets", "xd_photo_collections", "collection_id"},
		{"xd_photo_person_assets", "xd_photo_people", "person_id"},
	} {
		if !tx.Migrator().HasTable(relation.table) {
			continue
		}
		var invalid int64
		if err := tx.Table(relation.table+" AS m").Joins("JOIN "+relation.parent+" p ON p.id = m."+relation.column).
			Where("m.asset_id IN ? AND p.owner_id <> ?", []uint64{keeper.ID, duplicate.ID}, ownerID).Count(&invalid).Error; err != nil {
			return err
		}
		if invalid != 0 {
			return fmt.Errorf("legacy photo membership crosses Owner boundary")
		}
		if err := tx.Exec("SELECT p.id FROM "+relation.parent+" p WHERE p.owner_id = ? AND p.id IN (SELECT "+relation.column+" FROM "+relation.table+" WHERE asset_id IN ?) ORDER BY p.id FOR UPDATE", ownerID, []uint64{keeper.ID, duplicate.ID}).Error; err != nil {
			return err
		}
	}
	var rows []meta.PhotoMetadata
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("asset_id IN ?", []uint64{keeper.ID, duplicate.ID}).Order("asset_id ASC").Find(&rows).Error; err != nil {
		return err
	}
	// Snapshot all human-owned annotations before changing any relation. Derived
	// model/map results can be rebuilt; saved people and albums cannot.
	snapshot := map[string]any{"asset": map[string]any{"id": duplicate.ID, "owner_id": duplicate.OwnerID, "primary_node_id": duplicate.PrimaryNodeID, "kind": duplicate.Kind, "evidence_key": duplicate.EvidenceKey}}
	for _, table := range []string{"xd_photo_metadata", "xd_photo_edit_recipes", "xd_photo_collection_assets", "xd_photo_person_assets"} {
		if !tx.Migrator().HasTable(table) {
			continue
		}
		var rows []map[string]any
		if err := tx.Table(table).Where("asset_id = ?", duplicate.ID).Find(&rows).Error; err != nil {
			return err
		}
		snapshot[table] = rows
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	alias := meta.PhotoAssetIdentityAlias{LegacyAssetID: duplicate.ID, CanonicalAssetID: keeper.ID, OwnerID: ownerID, ContentKey: keeper.ContentKey, SnapshotJSON: string(raw), CreatedAt: time.Now().UTC()}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&alias).Error; err != nil {
		return err
	}
	combined := meta.PhotoMetadata{AssetID: keeper.ID}
	for _, row := range rows {
		if row.AssetID == keeper.ID {
			combined = row
		}
	}
	for _, row := range rows {
		if row.AssetID == keeper.ID {
			continue
		}
		combined.Favorite = combined.Favorite || row.Favorite
		if combined.TagsJSON, err = mergeAnnotationStrings(combined.TagsJSON, row.TagsJSON); err != nil {
			return err
		}
		if combined.PeopleJSON, err = mergeAnnotationStrings(combined.PeopleJSON, row.PeopleJSON); err != nil {
			return err
		}
		if row.Description != "" && row.Description != combined.Description {
			if combined.Description != "" {
				combined.Description += "\n\n"
			}
			combined.Description += row.Description
		}
	}
	if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}}, DoUpdates: clause.AssignmentColumns([]string{"favorite", "tags_json", "people_json", "description"})}).Create(&combined).Error; err != nil {
		return err
	}
	for _, value := range []struct{ table, parent, parentTable string }{{"xd_photo_collection_assets", "collection_id", "xd_photo_collections"}, {"xd_photo_person_assets", "person_id", "xd_photo_people"}} {
		if !tx.Migrator().HasTable(value.table) {
			continue
		}
		if err := tx.Exec("UPDATE "+value.parentTable+" SET revision = revision + 1, updated_at = ? WHERE owner_id = ? AND id IN (SELECT "+value.parent+" FROM "+value.table+" WHERE asset_id = ?)", time.Now().UTC(), ownerID, duplicate.ID).Error; err != nil {
			return err
		}
		// Remove duplicate membership first; preserve each remaining album's
		// original position without copying physical files or merging people.
		if err := tx.Exec("DELETE FROM "+value.table+" old USING "+value.table+" kept WHERE old.asset_id = ? AND kept.asset_id = ? AND old."+value.parent+" = kept."+value.parent, duplicate.ID, keeper.ID).Error; err != nil {
			return err
		}
		if err := tx.Table(value.table).Where("asset_id = ?", duplicate.ID).Update("asset_id", keeper.ID).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.PhotoPerson{}) {
		if err := tx.Model(&meta.PhotoPerson{}).Where("owner_id = ? AND cover_asset_id = ?", ownerID, duplicate.ID).Updates(map[string]any{"cover_asset_id": keeper.ID, "revision": gorm.Expr("revision + 1")}).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.PhotoCreativeGeneration{}) {
		if err := tx.Model(&meta.PhotoCreativeGeneration{}).Where("owner_id = ? AND source_asset_id = ?", ownerID, duplicate.ID).Update("source_asset_id", keeper.ID).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.PhotoEditRecipe{}) {
		if err := tx.Exec(`UPDATE xd_photo_edit_recipes SET asset_id = ? WHERE asset_id = ? AND owner_id = ? AND NOT EXISTS (SELECT 1 FROM xd_photo_edit_recipes WHERE asset_id = ?)`, keeper.ID, duplicate.ID, ownerID, keeper.ID).Error; err != nil {
			return err
		}
	}
	return tx.Where("id = ? AND owner_id = ? AND content_key = ''", duplicate.ID, ownerID).Delete(&meta.PhotoAsset{}).Error
}

func mergeAnnotationStrings(a, b string) (string, error) {
	seen := make(map[string]bool)
	var out []string
	for _, raw := range []string{a, b} {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		var values []string
		if err := json.Unmarshal([]byte(raw), &values); err != nil {
			return "", fmt.Errorf("photo annotation migration requires valid string arrays")
		}
		for _, value := range values {
			if !seen[value] {
				seen[value] = true
				out = append(out, value)
			}
		}
	}
	if out == nil {
		out = []string{}
	}
	raw, err := json.Marshal(out)
	return string(raw), err
}
