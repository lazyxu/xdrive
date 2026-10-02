package mediagroup

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxEvidenceKeyBytes = 512
	maxRoleBytes        = 32
)

type MemberSnapshot struct {
	NodeID  uint64
	Role    string
	Ordinal int
}

type Snapshot struct {
	Kind        string
	EvidenceKey string
	Members     []MemberSnapshot
}

// ApplyLocalSnapshot atomically replaces one locally-derived media group.
// Callers must supply deterministic evidence from preserved originals. Source
// IDs, provider pair IDs, filenames, and timestamp proximity are intentionally
// absent from this API.
func ApplyLocalSnapshot(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	snapshot Snapshot,
) (meta.MediaGroup, error) {
	var group meta.MediaGroup
	if db == nil || ownerID == 0 {
		return group, fmt.Errorf("media group store is not configured")
	}
	if err := normalizeAndValidate(&snapshot); err != nil {
		return group, err
	}

	nodeIDs := make([]uint64, 0, len(snapshot.Members))
	for _, member := range snapshot.Members {
		nodeIDs = append(nodeIDs, member.NodeID)
	}

	now := time.Now().UTC()
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var nodes []meta.Node
		if err := tx.
			Where("id IN ? AND owner_id = ? AND type = ? AND deleted_at IS NULL", nodeIDs, ownerID, meta.NodeTypeFile).
			Find(&nodes).Error; err != nil {
			return err
		}
		if len(nodes) != len(nodeIDs) {
			return fmt.Errorf("media group members must be active file nodes owned by owner %d", ownerID)
		}

		group = meta.MediaGroup{
			OwnerID: ownerID, Kind: snapshot.Kind, EvidenceKey: snapshot.EvidenceKey,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "owner_id"},
				{Name: "kind"},
				{Name: "evidence_key"},
			},
			DoUpdates: clause.Assignments(map[string]any{"updated_at": now}),
		}).Create(&group).Error; err != nil {
			return err
		}
		if err := tx.
			Where("owner_id = ? AND kind = ? AND evidence_key = ?", ownerID, snapshot.Kind, snapshot.EvidenceKey).
			First(&group).Error; err != nil {
			return err
		}

		if err := tx.Where("group_id = ?", group.ID).Delete(&meta.MediaGroupItem{}).Error; err != nil {
			return err
		}

		members := append([]MemberSnapshot(nil), snapshot.Members...)
		sort.Slice(members, func(i, j int) bool {
			if members[i].Ordinal != members[j].Ordinal {
				return members[i].Ordinal < members[j].Ordinal
			}
			return members[i].NodeID < members[j].NodeID
		})
		rows := make([]meta.MediaGroupItem, 0, len(members))
		for _, member := range members {
			rows = append(rows, meta.MediaGroupItem{
				GroupID: group.ID, NodeID: member.NodeID,
				Role: member.Role, Ordinal: member.Ordinal,
				CreatedAt: now, UpdatedAt: now,
			})
		}
		if len(rows) != 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return group, err
}

func normalizeAndValidate(snapshot *Snapshot) error {
	if snapshot == nil {
		return fmt.Errorf("media group snapshot is required")
	}
	snapshot.Kind = strings.TrimSpace(snapshot.Kind)
	snapshot.EvidenceKey = strings.TrimSpace(snapshot.EvidenceKey)
	if !meta.ValidMediaGroupKind(snapshot.Kind) {
		return fmt.Errorf("invalid media group kind %q", snapshot.Kind)
	}
	if snapshot.EvidenceKey == "" ||
		len([]byte(snapshot.EvidenceKey)) > maxEvidenceKeyBytes ||
		!utf8.ValidString(snapshot.EvidenceKey) ||
		containsControl(snapshot.EvidenceKey) {
		return fmt.Errorf("media group evidence key is invalid")
	}
	if len(snapshot.Members) == 0 {
		return fmt.Errorf("media group must contain at least one member")
	}

	seenNodes := make(map[uint64]struct{}, len(snapshot.Members))
	seenOrdinals := make(map[int]struct{}, len(snapshot.Members))
	for index := range snapshot.Members {
		member := &snapshot.Members[index]
		member.Role = strings.TrimSpace(member.Role)
		if member.NodeID == 0 {
			return fmt.Errorf("media group member node id is required")
		}
		if member.Ordinal < 0 {
			return fmt.Errorf("media group member ordinal must be zero or greater")
		}
		if !validRole(member.Role) {
			return fmt.Errorf("invalid media group member role %q", member.Role)
		}
		if _, duplicate := seenNodes[member.NodeID]; duplicate {
			return fmt.Errorf("duplicate media group member node %d", member.NodeID)
		}
		seenNodes[member.NodeID] = struct{}{}
		if _, duplicate := seenOrdinals[member.Ordinal]; duplicate {
			return fmt.Errorf("duplicate media group member ordinal %d", member.Ordinal)
		}
		seenOrdinals[member.Ordinal] = struct{}{}
	}

	if snapshot.Kind == meta.MediaGroupKindLivePhoto {
		return validateLivePhoto(snapshot.Members)
	}
	return nil
}

func validateLivePhoto(members []MemberSnapshot) error {
	counts := map[string]int{}
	for _, member := range members {
		switch member.Role {
		case meta.MediaGroupRoleStill, meta.MediaGroupRoleMotion, meta.MediaGroupRoleContainer:
			counts[member.Role]++
		default:
			return fmt.Errorf("live photo member role %q is not supported", member.Role)
		}
	}
	if counts[meta.MediaGroupRoleStill] != 1 || counts[meta.MediaGroupRoleMotion] != 1 {
		return fmt.Errorf("live photo requires exactly one still and one motion member")
	}
	if counts[meta.MediaGroupRoleContainer] > 1 {
		return fmt.Errorf("live photo may contain at most one container member")
	}
	if len(members) != 2+counts[meta.MediaGroupRoleContainer] {
		return fmt.Errorf("live photo contains unsupported duplicate roles")
	}
	return nil
}

func validRole(role string) bool {
	if role == "" || len([]byte(role)) > maxRoleBytes {
		return false
	}
	for _, r := range role {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.') {
			return false
		}
	}
	return true
}

func containsControl(value string) bool {
	for _, r := range value {
		if r < 32 || r == 127 {
			return true
		}
	}
	return false
}
