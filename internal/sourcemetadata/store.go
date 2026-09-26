package sourcemetadata

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	queryChunkSize          = 1000
	writeChunkSize          = 500
	maxOriginalPathBytes    = 4096
	maxOwnerExternalIDBytes = 128
	maxThumbnailURLBytes    = 8192
	maxPairGroupIDBytes     = 512
)

type Snapshot struct {
	ItemExternalID  string
	OriginalPath    string
	OwnerExternalID string
	RemoteCreatedAt *time.Time
	ContentMD5      string
	ThumbnailURL    string
	PairGroupID     string
	PairRole        string
}

type ApplyReport struct {
	Upserted int64
}

func ApplySnapshot(
	ctx context.Context,
	db *gorm.DB,
	sourceID uint64,
	runID string,
	snapshots []Snapshot,
) (ApplyReport, error) {
	var report ApplyReport
	if db == nil || sourceID == 0 {
		return report, fmt.Errorf("source metadata store is not configured")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" || len(runID) > 36 {
		return report, fmt.Errorf("run id is required")
	}
	if err := validateSnapshots(snapshots); err != nil {
		return report, err
	}
	if len(snapshots) == 0 {
		return report, nil
	}

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != meta.SyncRunStatusRunning {
			return fmt.Errorf("source metadata snapshot requires a running source run")
		}

		itemIDs, err := resolveSourceItems(tx, sourceID, snapshots)
		if err != nil {
			return err
		}
		rows := make([]meta.SourceItemMetadata, 0, len(snapshots))
		for _, snapshot := range snapshots {
			rows = append(rows, meta.SourceItemMetadata{
				SourceItemID:    itemIDs[snapshot.ItemExternalID],
				SourceID:        sourceID,
				OriginalPath:    snapshot.OriginalPath,
				OwnerExternalID: snapshot.OwnerExternalID,
				RemoteCreatedAt: snapshot.RemoteCreatedAt,
				ContentMD5:      snapshot.ContentMD5,
				ThumbnailURL:    snapshot.ThumbnailURL,
				PairGroupID:     snapshot.PairGroupID,
				PairRole:        snapshot.PairRole,
			})
		}
		for start := 0; start < len(rows); start += writeChunkSize {
			end := start + writeChunkSize
			if end > len(rows) {
				end = len(rows)
			}
			chunk := rows[start:end]
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "source_item_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"source_id":         gorm.Expr("EXCLUDED.source_id"),
					"original_path":     gorm.Expr("EXCLUDED.original_path"),
					"owner_external_id": gorm.Expr("EXCLUDED.owner_external_id"),
					"remote_created_at": gorm.Expr("EXCLUDED.remote_created_at"),
					"content_md5":       gorm.Expr("EXCLUDED.content_md5"),
					"thumbnail_url":     gorm.Expr("EXCLUDED.thumbnail_url"),
					"pair_group_id":     gorm.Expr("EXCLUDED.pair_group_id"),
					"pair_role":         gorm.Expr("EXCLUDED.pair_role"),
					"updated_at":        time.Now().UTC(),
				}),
			}).Create(&chunk).Error; err != nil {
				return err
			}
		}
		report.Upserted = int64(len(rows))
		return nil
	})
	return report, err
}

func resolveSourceItems(tx *gorm.DB, sourceID uint64, snapshots []Snapshot) (map[string]uint64, error) {
	externalIDs := make([]string, 0, len(snapshots))
	for _, snapshot := range snapshots {
		externalIDs = append(externalIDs, snapshot.ItemExternalID)
	}
	out := make(map[string]uint64, len(externalIDs))
	for start := 0; start < len(externalIDs); start += queryChunkSize {
		end := start + queryChunkSize
		if end > len(externalIDs) {
			end = len(externalIDs)
		}
		var items []meta.SourceItem
		if err := tx.Where("source_id = ? AND external_id IN ?", sourceID, externalIDs[start:end]).
			Find(&items).Error; err != nil {
			return nil, err
		}
		for _, item := range items {
			out[item.ExternalID] = item.ID
		}
	}
	if len(out) != len(externalIDs) {
		for _, externalID := range externalIDs {
			if _, ok := out[externalID]; !ok {
				return nil, fmt.Errorf("source metadata item %q has no SourceItem", externalID)
			}
		}
	}
	return out, nil
}

func validateSnapshots(snapshots []Snapshot) error {
	seen := make(map[string]struct{}, len(snapshots))
	for i := range snapshots {
		snapshot := &snapshots[i]
		snapshot.ItemExternalID = strings.TrimSpace(snapshot.ItemExternalID)
		snapshot.OriginalPath = strings.TrimSpace(snapshot.OriginalPath)
		snapshot.OwnerExternalID = strings.TrimSpace(snapshot.OwnerExternalID)
		snapshot.ContentMD5 = strings.ToLower(strings.TrimSpace(snapshot.ContentMD5))
		snapshot.ThumbnailURL = strings.TrimSpace(snapshot.ThumbnailURL)
		snapshot.PairGroupID = strings.TrimSpace(snapshot.PairGroupID)
		snapshot.PairRole = strings.TrimSpace(snapshot.PairRole)

		if snapshot.ItemExternalID == "" || len([]byte(snapshot.ItemExternalID)) > 512 {
			return fmt.Errorf("metadata snapshot %d has invalid item external id", i)
		}
		if _, duplicate := seen[snapshot.ItemExternalID]; duplicate {
			return fmt.Errorf("duplicate metadata item external id %q", snapshot.ItemExternalID)
		}
		seen[snapshot.ItemExternalID] = struct{}{}

		if len([]byte(snapshot.OriginalPath)) > maxOriginalPathBytes || !utf8.ValidString(snapshot.OriginalPath) {
			return fmt.Errorf("metadata item %q has invalid original path", snapshot.ItemExternalID)
		}
		if strings.IndexByte(snapshot.OriginalPath, 0) >= 0 {
			return fmt.Errorf("metadata item %q original path contains NUL", snapshot.ItemExternalID)
		}
		if len([]byte(snapshot.OwnerExternalID)) > maxOwnerExternalIDBytes || !utf8.ValidString(snapshot.OwnerExternalID) {
			return fmt.Errorf("metadata item %q has invalid owner identity", snapshot.ItemExternalID)
		}
		if snapshot.ContentMD5 != "" {
			if len(snapshot.ContentMD5) != 32 {
				return fmt.Errorf("metadata item %q has invalid md5", snapshot.ItemExternalID)
			}
			if _, err := hex.DecodeString(snapshot.ContentMD5); err != nil {
				return fmt.Errorf("metadata item %q has invalid md5", snapshot.ItemExternalID)
			}
		}
		if len([]byte(snapshot.ThumbnailURL)) > maxThumbnailURLBytes || !utf8.ValidString(snapshot.ThumbnailURL) {
			return fmt.Errorf("metadata item %q has invalid thumbnail URL", snapshot.ItemExternalID)
		}
		if len([]byte(snapshot.PairGroupID)) > maxPairGroupIDBytes || !utf8.ValidString(snapshot.PairGroupID) {
			return fmt.Errorf("metadata item %q has invalid pair group", snapshot.ItemExternalID)
		}
		if !meta.ValidSourceMediaPairRole(snapshot.PairRole) {
			return fmt.Errorf("metadata item %q has invalid pair role", snapshot.ItemExternalID)
		}
		if (snapshot.PairGroupID == "") != (snapshot.PairRole == "") {
			return fmt.Errorf("metadata item %q must set pair group and role together", snapshot.ItemExternalID)
		}
	}
	return nil
}
