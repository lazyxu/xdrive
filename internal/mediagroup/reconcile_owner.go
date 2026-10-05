package mediagroup

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type ownerLivePhotoIdentifierRow struct {
	Identifier string
}

// ReconcileOwnerLocalGroups rebuilds the connector-neutral relationship layer
// for one owner exclusively from xDrive-local MediaMetadata evidence.
//
// The routine intentionally does not infer relationships from filenames,
// timestamps, provider pair IDs, or Source paths. It first removes structurally
// invalid derived groups owned by the user, then reconciles every known Apple
// Live Photo identifier and finally rebuilds RAW/rendered, XMP sidecar and burst
// groups from deterministic local evidence.
func ReconcileOwnerLocalGroups(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) error {
	if db == nil || ownerID == 0 {
		return fmt.Errorf("media relation reconciler is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var existing []meta.MediaGroup
	if err := db.WithContext(ctx).
		Where("owner_id = ?", ownerID).
		Order("id ASC").
		Find(&existing).Error; err != nil {
		return fmt.Errorf("query owner media groups: %w", err)
	}

	identifiers := make(map[string]struct{})
	invalidGroupIDs := make([]uint64, 0)
	for _, group := range existing {
		evidence := strings.TrimSpace(group.EvidenceKey)
		if !meta.ValidMediaGroupKind(group.Kind) || evidence == "" {
			invalidGroupIDs = append(invalidGroupIDs, group.ID)
			continue
		}
		if group.Kind != meta.MediaGroupKindLivePhoto {
			continue
		}
		if !strings.HasPrefix(evidence, appleAssetEvidencePrefix) {
			invalidGroupIDs = append(invalidGroupIDs, group.ID)
			continue
		}
		identifier := normalizeAppleAssetIdentifier(
			strings.TrimPrefix(evidence, appleAssetEvidencePrefix),
		)
		if identifier == "" {
			invalidGroupIDs = append(invalidGroupIDs, group.ID)
			continue
		}
		identifiers[identifier] = struct{}{}
	}
	if len(invalidGroupIDs) != 0 {
		if err := db.WithContext(ctx).
			Where("id IN ? AND owner_id = ?", invalidGroupIDs, ownerID).
			Delete(&meta.MediaGroup{}).Error; err != nil {
			return fmt.Errorf("delete invalid media groups: %w", err)
		}
	}

	var rows []ownerLivePhotoIdentifierRow
	if err := db.WithContext(ctx).
		Table("xd_media_metadata AS mm").
		Select("DISTINCT mm.live_photo_asset_identifier AS identifier").
		Joins("JOIN xd_nodes AS n ON n.id = mm.node_id AND n.deleted_at IS NULL").
		Where(
			"mm.owner_id = ? AND n.owner_id = ? AND n.type = ? AND "+
				"mm.container_kind = '' AND mm.index_state = ? AND "+
				"mm.media_kind IN ? AND COALESCE(mm.live_photo_asset_identifier, '') <> ''",
			ownerID,
			ownerID,
			meta.NodeTypeFile,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Order("identifier ASC").
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("query owner live photo identifiers: %w", err)
	}
	for _, row := range rows {
		if identifier := normalizeAppleAssetIdentifier(row.Identifier); identifier != "" {
			identifiers[identifier] = struct{}{}
		}
	}

	values := make([]string, 0, len(identifiers))
	for identifier := range identifiers {
		values = append(values, identifier)
	}
	sort.Strings(values)
	for _, identifier := range values {
		if _, err := ReconcileAppleLivePhoto(ctx, db, ownerID, identifier); err != nil {
			return fmt.Errorf("reconcile Apple Live Photo %q: %w", identifier, err)
		}
	}
	if err := ReconcileLocalEvidenceGroups(ctx, db, ownerID); err != nil {
		return fmt.Errorf("reconcile local media evidence groups: %w", err)
	}
	return nil
}

func LocalEvidenceGroupsStale(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) (bool, error) {
	if db == nil || ownerID == 0 {
		return false, fmt.Errorf("media relation verifier is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	candidates, err := loadRelationCandidates(db.WithContext(ctx), ownerID)
	if err != nil {
		return false, err
	}
	blockedNodes, err := loadLivePhotoMemberNodes(db.WithContext(ctx), ownerID)
	if err != nil {
		return false, err
	}
	relations := buildRelationSnapshots(candidates, blockedNodes)
	desired := make(map[string]Snapshot, len(relations))
	for _, relation := range relations {
		snapshot := relation.Snapshot
		if err := normalizeAndValidate(&snapshot); err != nil {
			return false, fmt.Errorf("validate desired media relation: %w", err)
		}
		sort.Slice(snapshot.Members, func(i, j int) bool {
			if snapshot.Members[i].Ordinal != snapshot.Members[j].Ordinal {
				return snapshot.Members[i].Ordinal < snapshot.Members[j].Ordinal
			}
			return snapshot.Members[i].NodeID < snapshot.Members[j].NodeID
		})
		desired[localGroupSnapshotKey(snapshot.Kind, snapshot.EvidenceKey)] = snapshot
	}

	kinds := []string{
		meta.MediaGroupKindRAWPair,
		meta.MediaGroupKindSidecar,
		meta.MediaGroupKindBurst,
	}
	var groups []meta.MediaGroup
	if err := db.WithContext(ctx).
		Where("owner_id = ? AND kind IN ?", ownerID, kinds).
		Order("id ASC").
		Find(&groups).Error; err != nil {
		return false, fmt.Errorf("query local media groups: %w", err)
	}
	if len(groups) != len(desired) {
		return true, nil
	}
	if len(groups) == 0 {
		return false, nil
	}

	groupIDs := make([]uint64, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.ID)
	}
	var items []meta.MediaGroupItem
	if err := db.WithContext(ctx).
		Where("group_id IN ?", groupIDs).
		Order("group_id ASC, ordinal ASC, node_id ASC").
		Find(&items).Error; err != nil {
		return false, fmt.Errorf("query local media group items: %w", err)
	}
	itemsByGroup := make(map[uint64][]meta.MediaGroupItem, len(groups))
	for _, item := range items {
		itemsByGroup[item.GroupID] = append(itemsByGroup[item.GroupID], item)
	}

	for _, group := range groups {
		want, ok := desired[localGroupSnapshotKey(group.Kind, group.EvidenceKey)]
		if !ok {
			return true, nil
		}
		got := itemsByGroup[group.ID]
		if len(got) != len(want.Members) {
			return true, nil
		}
		for index := range want.Members {
			if got[index].NodeID != want.Members[index].NodeID ||
				got[index].Role != want.Members[index].Role ||
				got[index].Ordinal != want.Members[index].Ordinal {
				return true, nil
			}
		}
	}
	return false, nil
}

func localGroupSnapshotKey(kind, evidence string) string {
	return strings.TrimSpace(kind) + "\x00" + strings.TrimSpace(evidence)
}
