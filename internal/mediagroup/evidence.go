package mediagroup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	exifImageUniqueEvidencePrefix = "exif-image-unique:"
	xmpDerivedEvidencePrefix      = "xmp-derived:"
	appleBurstEvidencePrefix      = "apple-burst:"
)

type relationCandidate struct {
	NodeID          uint64
	SHA256          string
	NodeRevision    uint64
	IndexedRevision uint64
	Name            string
	MediaKind       string
	MIMEType        string
	IndexState      string
	RelationJSON    string
	Evidence        mediapkg.RelationEvidence `gorm:"-"`
}

type relationSnapshot struct {
	Snapshot
	usedNodes map[uint64]struct{}
}

// ReconcileLocalEvidenceGroups rebuilds RAW/rendered, explicit XMP sidecar, and
// Apple burst relations only from deterministic metadata parsed from local
// originals. Filenames and timestamps never participate in pairing.
func ReconcileLocalEvidenceGroups(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) error {
	if db == nil || ownerID == 0 {
		return fmt.Errorf("media relation reconciler is not configured")
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		candidates, err := loadRelationCandidates(tx, ownerID)
		if err != nil {
			return err
		}
		blockedNodes, err := loadLivePhotoMemberNodes(tx, ownerID)
		if err != nil {
			return err
		}
		desired := buildRelationSnapshots(candidates, blockedNodes)
		now := time.Now().UTC()

		desiredKeys := map[string]map[string]struct{}{
			meta.MediaGroupKindRAWPair: {},
			meta.MediaGroupKindSidecar: {},
			meta.MediaGroupKindBurst:   {},
		}
		for _, relation := range desired {
			snapshot := relation.Snapshot
			if err := normalizeAndValidate(&snapshot); err != nil {
				return err
			}
			if _, err := applyLocalSnapshotDB(tx, ownerID, snapshot, now); err != nil {
				return err
			}
			desiredKeys[snapshot.Kind][snapshot.EvidenceKey] = struct{}{}
		}

		for _, kind := range []string{
			meta.MediaGroupKindRAWPair,
			meta.MediaGroupKindSidecar,
			meta.MediaGroupKindBurst,
		} {
			keys := desiredKeys[kind]
			query := tx.Where("owner_id = ? AND kind = ?", ownerID, kind)
			if len(keys) == 0 {
				if err := query.Delete(&meta.MediaGroup{}).Error; err != nil {
					return err
				}
				continue
			}
			values := make([]string, 0, len(keys))
			for key := range keys {
				values = append(values, key)
			}
			if err := query.Where("evidence_key NOT IN ?", values).
				Delete(&meta.MediaGroup{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func loadRelationCandidates(tx *gorm.DB, ownerID uint64) ([]relationCandidate, error) {
	var rows []relationCandidate
	if err := tx.Table("xd_media_metadata AS mm").
		Select(
			"mm.node_id, n.name, mm.media_kind, mm.mime_type, mm.index_state, mm.relation_json, "+
				"mm.sha256 AS sha256, n.revision AS node_revision, "+
				"mm.node_revision AS indexed_revision",
		).
		Joins("JOIN xd_nodes AS n ON n.id = mm.node_id AND n.deleted_at IS NULL").
		Where(
			"mm.owner_id = ? AND n.owner_id = ? AND n.type = ? AND "+
				"mm.relation_evidence_version >= ? AND COALESCE(mm.relation_json, '') <> ''",
			ownerID,
			ownerID,
			meta.NodeTypeFile,
			mediapkg.RelationEvidenceVersion,
		).
		Order("mm.node_id ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]relationCandidate, 0, len(rows))
	for _, row := range rows {
		evidence, err := mediapkg.DecodeRelationEvidence(row.RelationJSON)
		if err != nil {
			continue
		}
		row.Evidence = evidence
		out = append(out, row)
	}
	return out, nil
}

func loadLivePhotoMemberNodes(tx *gorm.DB, ownerID uint64) (map[uint64]struct{}, error) {
	type row struct {
		NodeID uint64
	}
	var rows []row
	if err := tx.Table("xd_media_group_items AS mgi").
		Select("mgi.node_id").
		Joins("JOIN xd_media_groups AS mg ON mg.id = mgi.group_id").
		Where("mg.owner_id = ? AND mg.kind = ?", ownerID, meta.MediaGroupKindLivePhoto).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint64]struct{}, len(rows))
	for _, row := range rows {
		out[row.NodeID] = struct{}{}
	}
	return out, nil
}

func buildRelationSnapshots(
	candidates []relationCandidate,
	blockedNodes map[uint64]struct{},
) []relationSnapshot {
	rawPairs, nodeToRawPair := buildRAWPairs(candidates, blockedNodes)
	sidecars, usedNodes := buildSidecars(candidates, rawPairs, nodeToRawPair, blockedNodes)

	out := make([]relationSnapshot, 0, len(rawPairs)+len(sidecars)+8)
	for index := range rawPairs {
		out = append(out, rawPairs[index])
	}
	out = append(out, sidecars...)

	for _, relation := range out {
		for nodeID := range relation.usedNodes {
			usedNodes[nodeID] = struct{}{}
		}
	}
	out = append(out, buildBursts(candidates, usedNodes, blockedNodes)...)
	return out
}

func buildRAWPairs(
	candidates []relationCandidate,
	blockedNodes map[uint64]struct{},
) ([]relationSnapshot, map[uint64]int) {
	buckets := make(map[string][]relationCandidate)
	for _, candidate := range candidates {
		if _, blocked := blockedNodes[candidate.NodeID]; blocked {
			continue
		}
		if candidate.IndexState != meta.MediaIndexStateReady ||
			candidate.MediaKind != meta.MediaKindImage ||
			candidate.Evidence.ImageUniqueID == "" {
			continue
		}
		buckets[candidate.Evidence.ImageUniqueID] = append(
			buckets[candidate.Evidence.ImageUniqueID],
			candidate,
		)
	}

	keys := sortedRelationKeys(buckets)
	out := make([]relationSnapshot, 0, len(keys))
	nodeToPair := make(map[uint64]int)
	for _, key := range keys {
		var raws, rendered []relationCandidate
		for _, candidate := range buckets[key] {
			if strings.EqualFold(strings.TrimSpace(candidate.MIMEType), "image/x-adobe-dng") {
				raws = append(raws, candidate)
			} else {
				rendered = append(rendered, candidate)
			}
		}
		rawCopies := make([]contentCopyCandidate, 0, len(raws))
		renderedCopies := make([]contentCopyCandidate, 0, len(rendered))
		for _, raw := range raws {
			rawCopies = append(rawCopies, contentCopyCandidate{
				NodeID: raw.NodeID, SHA256: raw.SHA256,
				NodeRevision: raw.NodeRevision, IndexedRevision: raw.IndexedRevision,
			})
		}
		for _, image := range rendered {
			renderedCopies = append(renderedCopies, contentCopyCandidate{
				NodeID: image.NodeID, SHA256: image.SHA256,
				NodeRevision: image.NodeRevision, IndexedRevision: image.IndexedRevision,
			})
		}
		rawID, rawOK := contentCopyRepresentative(rawCopies, 0)
		renderedID, renderedOK := contentCopyRepresentative(renderedCopies, 0)
		if !rawOK || !renderedOK {
			continue
		}
		relation := relationSnapshot{
			Snapshot: Snapshot{
				Kind:        meta.MediaGroupKindRAWPair,
				EvidenceKey: relationEvidenceKey(exifImageUniqueEvidencePrefix, key),
				Members: []MemberSnapshot{
					{NodeID: renderedID, Role: meta.MediaGroupRoleRendered, Ordinal: 0},
					{NodeID: rawID, Role: meta.MediaGroupRoleRAW, Ordinal: 1},
				},
			},
			usedNodes: map[uint64]struct{}{
				renderedID: {},
				rawID:      {},
			},
		}
		index := len(out)
		out = append(out, relation)
		// An additional identical file is not a new RAW relationship, but its
		// embedded XMP identity can still refer to this one logical pair.
		for _, image := range rendered {
			nodeToPair[image.NodeID] = index
			relation.usedNodes[image.NodeID] = struct{}{}
		}
		for _, raw := range raws {
			nodeToPair[raw.NodeID] = index
			relation.usedNodes[raw.NodeID] = struct{}{}
		}
		out[index] = relation
	}
	return out, nodeToPair
}

func buildSidecars(
	candidates []relationCandidate,
	rawPairs []relationSnapshot,
	nodeToRawPair map[uint64]int,
	blockedNodes map[uint64]struct{},
) ([]relationSnapshot, map[uint64]struct{}) {
	identityIndex := make(map[string]map[uint64]struct{})
	for _, candidate := range candidates {
		if _, blocked := blockedNodes[candidate.NodeID]; blocked {
			continue
		}
		if candidate.IndexState != meta.MediaIndexStateReady ||
			candidate.MediaKind != meta.MediaKindImage {
			continue
		}
		for _, identity := range []string{
			candidate.Evidence.XMPDocumentID,
			candidate.Evidence.XMPOriginalDocumentID,
		} {
			if identity == "" {
				continue
			}
			if identityIndex[identity] == nil {
				identityIndex[identity] = make(map[uint64]struct{})
			}
			identityIndex[identity][candidate.NodeID] = struct{}{}
		}
	}

	type sidecarMatch struct {
		sidecar relationCandidate
		targets map[uint64]struct{}
		ref     string
	}
	var matches []sidecarMatch
	for _, candidate := range candidates {
		if _, blocked := blockedNodes[candidate.NodeID]; blocked {
			continue
		}
		if !strings.EqualFold(filepath.Ext(candidate.Name), ".xmp") {
			continue
		}
		refs := []string{
			candidate.Evidence.XMPDerivedFromDocumentID,
			candidate.Evidence.XMPDerivedFromOriginalDocumentID,
		}
		targets := make(map[uint64]struct{})
		ref := ""
		for _, candidateRef := range refs {
			if candidateRef == "" {
				continue
			}
			if ref == "" {
				ref = candidateRef
			}
			for nodeID := range identityIndex[candidateRef] {
				targets[nodeID] = struct{}{}
			}
		}
		if ref == "" || len(targets) == 0 {
			continue
		}
		matches = append(matches, sidecarMatch{
			sidecar: candidate,
			targets: targets,
			ref:     ref,
		})
	}

	targetSidecarCount := make(map[uint64]int)
	resolvedTarget := make([]uint64, len(matches))
	resolvedRawPair := make([]int, len(matches))
	for index := range resolvedRawPair {
		resolvedRawPair[index] = -1
	}
	for index, match := range matches {
		var pairIndex = -1
		var target uint64
		ambiguous := false
		for nodeID := range match.targets {
			if rawIndex, ok := nodeToRawPair[nodeID]; ok {
				if pairIndex == -1 {
					pairIndex = rawIndex
				} else if pairIndex != rawIndex {
					ambiguous = true
					break
				}
				continue
			}
			if pairIndex >= 0 {
				ambiguous = true
				break
			}
			if target == 0 {
				target = nodeID
			} else if target != nodeID {
				ambiguous = true
				break
			}
		}
		if ambiguous {
			continue
		}
		if pairIndex >= 0 {
			resolvedRawPair[index] = pairIndex
			continue
		}
		if target != 0 {
			resolvedTarget[index] = target
			targetSidecarCount[target]++
		}
	}

	used := make(map[uint64]struct{})
	var standalone []relationSnapshot
	rawSidecarCount := make(map[int]int)
	for _, rawIndex := range resolvedRawPair {
		if rawIndex >= 0 {
			rawSidecarCount[rawIndex]++
		}
	}
	for index, match := range matches {
		if rawIndex := resolvedRawPair[index]; rawIndex >= 0 {
			if rawSidecarCount[rawIndex] != 1 {
				continue
			}
			relation := &rawPairs[rawIndex]
			relation.Snapshot.Members = append(
				relation.Snapshot.Members,
				MemberSnapshot{
					NodeID:  match.sidecar.NodeID,
					Role:    meta.MediaGroupRoleSidecar,
					Ordinal: len(relation.Snapshot.Members),
				},
			)
			relation.usedNodes[match.sidecar.NodeID] = struct{}{}
			continue
		}
		target := resolvedTarget[index]
		if target == 0 || targetSidecarCount[target] != 1 {
			continue
		}
		relation := relationSnapshot{
			Snapshot: Snapshot{
				Kind:        meta.MediaGroupKindSidecar,
				EvidenceKey: relationEvidenceKey(xmpDerivedEvidencePrefix, match.ref),
				Members: []MemberSnapshot{
					{NodeID: target, Role: meta.MediaGroupRolePrimary, Ordinal: 0},
					{NodeID: match.sidecar.NodeID, Role: meta.MediaGroupRoleSidecar, Ordinal: 1},
				},
			},
			usedNodes: map[uint64]struct{}{
				target:               {},
				match.sidecar.NodeID: {},
			},
		}
		standalone = append(standalone, relation)
	}
	for _, relation := range standalone {
		for nodeID := range relation.usedNodes {
			used[nodeID] = struct{}{}
		}
	}
	return standalone, used
}

func buildBursts(
	candidates []relationCandidate,
	used map[uint64]struct{},
	blockedNodes map[uint64]struct{},
) []relationSnapshot {
	buckets := make(map[string][]uint64)
	for _, candidate := range candidates {
		if _, blocked := blockedNodes[candidate.NodeID]; blocked {
			continue
		}
		if candidate.IndexState != meta.MediaIndexStateReady ||
			candidate.MediaKind != meta.MediaKindImage ||
			candidate.Evidence.AppleBurstUUID == "" {
			continue
		}
		buckets[candidate.Evidence.AppleBurstUUID] = append(
			buckets[candidate.Evidence.AppleBurstUUID],
			candidate.NodeID,
		)
	}
	keys := sortedRelationKeys(buckets)
	out := make([]relationSnapshot, 0, len(keys))
	for _, key := range keys {
		nodeIDs := uniqueSortedNodeIDs(buckets[key])
		if len(nodeIDs) < 2 {
			continue
		}
		conflict := false
		for _, nodeID := range nodeIDs {
			if _, exists := used[nodeID]; exists {
				conflict = true
				break
			}
		}
		if conflict {
			continue
		}
		members := make([]MemberSnapshot, 0, len(nodeIDs))
		usedNodes := make(map[uint64]struct{}, len(nodeIDs))
		for index, nodeID := range nodeIDs {
			role := meta.MediaGroupRoleAuxiliary
			if index == 0 {
				role = meta.MediaGroupRolePrimary
			}
			members = append(members, MemberSnapshot{
				NodeID:  nodeID,
				Role:    role,
				Ordinal: index,
			})
			usedNodes[nodeID] = struct{}{}
		}
		out = append(out, relationSnapshot{
			Snapshot: Snapshot{
				Kind:        meta.MediaGroupKindBurst,
				EvidenceKey: relationEvidenceKey(appleBurstEvidencePrefix, key),
				Members:     members,
			},
			usedNodes: usedNodes,
		})
	}
	return out
}

func relationEvidenceKey(prefix, value string) string {
	value = strings.TrimSpace(value)
	raw := prefix + value
	if len([]byte(raw)) <= maxEvidenceKeyBytes {
		return raw
	}
	sum := sha256.Sum256([]byte(value))
	return prefix + "sha256:" + hex.EncodeToString(sum[:])
}

func sortedRelationKeys[T any](values map[string][]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func uniqueSortedNodeIDs(values []uint64) []uint64 {
	seen := make(map[uint64]struct{}, len(values))
	out := make([]uint64, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
