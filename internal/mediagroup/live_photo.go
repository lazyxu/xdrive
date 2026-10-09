package mediagroup

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	appleAssetEvidencePrefix    = "apple-asset:"
	maxAppleAssetIdentifierByte = 128
)

// ReconcileAppleLivePhoto projects one Live Photo relationship entirely from
// local MediaMetadata. A proven set of byte-identical original copies may
// retain one canonical still/motion pair per embedded Apple identifier;
// different-content ambiguity remains fail-closed.
func ReconcileAppleLivePhoto(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	identifier string,
) (bool, error) {
	if db == nil || ownerID == 0 {
		return false, fmt.Errorf("live photo reconciler is not configured")
	}
	identifier = normalizeAppleAssetIdentifier(identifier)
	if identifier == "" {
		return false, nil
	}
	evidenceKey := appleAssetEvidencePrefix + identifier
	projected := false

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		type candidate struct {
			NodeID          uint64
			MediaKind       string
			SHA256          string
			NodeRevision    uint64
			IndexedRevision uint64
		}
		var candidates []candidate
		if err := tx.
			Table("xd_media_metadata AS mm").
			Select("mm.node_id, mm.media_kind, mm.sha256 AS sha256, "+
				"n.revision AS node_revision, mm.node_revision AS indexed_revision").
			Joins("JOIN xd_nodes AS n ON n.id = mm.node_id AND n.deleted_at IS NULL").
			Where(
				"mm.owner_id = ? AND n.owner_id = ? AND n.type = ? AND mm.container_kind = '' AND mm.live_photo_asset_identifier = ? AND mm.index_state = ? AND mm.media_kind IN ?",
				ownerID,
				ownerID,
				meta.NodeTypeFile,
				identifier,
				meta.MediaIndexStateReady,
				[]string{meta.MediaKindImage, meta.MediaKindVideo},
			).
			Order("mm.node_id ASC").
			Scan(&candidates).Error; err != nil {
			return err
		}

		var stills, motions []contentCopyCandidate
		for _, candidate := range candidates {
			copy := contentCopyCandidate{
				NodeID: candidate.NodeID, SHA256: candidate.SHA256,
				NodeRevision:    candidate.NodeRevision,
				IndexedRevision: candidate.IndexedRevision,
			}
			switch candidate.MediaKind {
			case meta.MediaKindImage:
				stills = append(stills, copy)
			case meta.MediaKindVideo:
				motions = append(motions, copy)
			}
		}

		stillID, stillOK := contentCopyRepresentative(stills, 0)
		motionID, motionOK := contentCopyRepresentative(motions, 0)
		if !stillOK || !motionOK {
			return tx.
				Where(
					"owner_id = ? AND kind = ? AND evidence_key = ?",
					ownerID,
					meta.MediaGroupKindLivePhoto,
					evidenceKey,
				).
				Delete(&meta.MediaGroup{}).Error
		}

		snapshot := Snapshot{
			Kind:        meta.MediaGroupKindLivePhoto,
			EvidenceKey: evidenceKey,
			Members: []MemberSnapshot{
				{NodeID: stillID, Role: meta.MediaGroupRoleStill, Ordinal: 0},
				{NodeID: motionID, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
			},
		}
		if err := normalizeAndValidate(&snapshot); err != nil {
			return err
		}
		if _, err := applyLocalSnapshotDB(tx, ownerID, snapshot, time.Now().UTC()); err != nil {
			return err
		}
		projected = true
		return nil
	})
	return projected, err
}

func normalizeAppleAssetIdentifier(value string) string {
	value = strings.TrimFunc(value, func(r rune) bool {
		return r == 0 || unicode.IsSpace(r)
	})
	if value == "" || len([]byte(value)) > maxAppleAssetIdentifierByte || !utf8.ValidString(value) {
		return ""
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return ""
		}
	}
	return value
}
