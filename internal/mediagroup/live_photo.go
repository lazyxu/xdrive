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
// local MediaMetadata. Exactly one active image and one active video must share
// the same embedded Apple content identifier; ambiguity fails closed by
// removing the derived group.
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
			NodeID    uint64
			MediaKind string
		}
		var candidates []candidate
		if err := tx.
			Table("xd_media_metadata AS mm").
			Select("mm.node_id, mm.media_kind").
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

		var stills, motions []uint64
		for _, candidate := range candidates {
			switch candidate.MediaKind {
			case meta.MediaKindImage:
				stills = append(stills, candidate.NodeID)
			case meta.MediaKindVideo:
				motions = append(motions, candidate.NodeID)
			}
		}

		if len(stills) != 1 || len(motions) != 1 {
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
				{NodeID: stills[0], Role: meta.MediaGroupRoleStill, Ordinal: 0},
				{NodeID: motions[0], Role: meta.MediaGroupRoleMotion, Ordinal: 1},
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
