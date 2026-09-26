package sourcecollection

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxCollectionNameBytes = 512
	maxCollectionKindBytes = 32
	queryChunkSize         = 1000
	writeChunkSize         = 500
)

type MemberSnapshot struct {
	ItemExternalID string
	Position       int64
}

type Snapshot struct {
	ExternalID     string
	Kind           string
	Name           string
	RemoteRevision string
	Members        []MemberSnapshot
}

type ApplyReport struct {
	CollectionsActive  int64
	CollectionsMissing int64
	Memberships        int64
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
		return report, fmt.Errorf("source collection store is not configured")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" || len(runID) > 36 {
		return report, fmt.Errorf("run id is required")
	}
	if err := validateSnapshots(snapshots); err != nil {
		return report, err
	}

	now := time.Now().UTC()
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			return err
		}
		if run.Status != meta.SyncRunStatusRunning {
			return fmt.Errorf("source collection snapshot requires a running source run")
		}

		itemIDs, err := resolveSourceItems(tx, sourceID, snapshots)
		if err != nil {
			return err
		}

		var existing []meta.SourceCollection
		if err := tx.Where("source_id = ?", sourceID).Find(&existing).Error; err != nil {
			return err
		}
		byExternal := make(map[string]meta.SourceCollection, len(existing))
		for _, collection := range existing {
			byExternal[collection.ExternalID] = collection
		}

		activeCollectionIDs := make([]uint64, 0, len(snapshots))
		for _, snapshot := range snapshots {
			collection, exists := byExternal[snapshot.ExternalID]
			if !exists {
				collection = meta.SourceCollection{
					SourceID: sourceID, ExternalID: snapshot.ExternalID,
					Kind: snapshot.Kind, Name: snapshot.Name,
					State:          meta.SourceCollectionStateActive,
					RemoteRevision: snapshot.RemoteRevision,
					LastSeenRunID:  runID, LastSeenAt: now,
				}
				if err := tx.Create(&collection).Error; err != nil {
					return err
				}
				byExternal[snapshot.ExternalID] = collection
			} else {
				if err := tx.Model(&meta.SourceCollection{}).Where("id = ?", collection.ID).
					Updates(map[string]any{
						"kind": snapshot.Kind, "name": snapshot.Name,
						"state":            meta.SourceCollectionStateActive,
						"remote_revision":  snapshot.RemoteRevision,
						"last_seen_run_id": runID, "last_seen_at": now,
						"updated_at": now,
					}).Error; err != nil {
					return err
				}
			}
			activeCollectionIDs = append(activeCollectionIDs, collection.ID)

			rows := make([]meta.SourceCollectionItem, 0, len(snapshot.Members))
			for _, member := range snapshot.Members {
				rows = append(rows, meta.SourceCollectionItem{
					CollectionID:  collection.ID,
					SourceItemID:  itemIDs[member.ItemExternalID],
					Position:      member.Position,
					LastSeenRunID: runID,
					LastSeenAt:    now,
				})
			}
			for start := 0; start < len(rows); start += writeChunkSize {
				end := start + writeChunkSize
				if end > len(rows) {
					end = len(rows)
				}
				chunk := rows[start:end]
				if err := tx.Clauses(clause.OnConflict{
					Columns: []clause.Column{{Name: "collection_id"}, {Name: "source_item_id"}},
					DoUpdates: clause.Assignments(map[string]any{
						"position":         gorm.Expr("EXCLUDED.position"),
						"last_seen_run_id": runID,
						"last_seen_at":     now,
						"updated_at":       now,
					}),
				}).Create(&chunk).Error; err != nil {
					return err
				}
			}
			if err := tx.Where("collection_id = ? AND last_seen_run_id <> ?", collection.ID, runID).
				Delete(&meta.SourceCollectionItem{}).Error; err != nil {
				return err
			}
			report.Memberships += int64(len(snapshot.Members))
		}

		missingQuery := tx.Model(&meta.SourceCollection{}).
			Where("source_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)", sourceID, runID)
		var missing []meta.SourceCollection
		if err := missingQuery.Find(&missing).Error; err != nil {
			return err
		}
		if len(missing) != 0 {
			missingIDs := make([]uint64, 0, len(missing))
			for _, collection := range missing {
				missingIDs = append(missingIDs, collection.ID)
			}
			if err := tx.Model(&meta.SourceCollection{}).Where("id IN ?", missingIDs).
				Updates(map[string]any{
					"state":      meta.SourceCollectionStateMissing,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Where("collection_id IN ?", missingIDs).
				Delete(&meta.SourceCollectionItem{}).Error; err != nil {
				return err
			}
		}

		report.CollectionsActive = int64(len(activeCollectionIDs))
		report.CollectionsMissing = int64(len(missing))
		return nil
	})
	return report, err
}

func resolveSourceItems(tx *gorm.DB, sourceID uint64, snapshots []Snapshot) (map[string]uint64, error) {
	needed := make(map[string]struct{})
	for _, snapshot := range snapshots {
		for _, member := range snapshot.Members {
			needed[member.ItemExternalID] = struct{}{}
		}
	}
	if len(needed) == 0 {
		return map[string]uint64{}, nil
	}
	externalIDs := make([]string, 0, len(needed))
	for externalID := range needed {
		externalIDs = append(externalIDs, externalID)
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
				return nil, fmt.Errorf("source collection member %q has no SourceItem", externalID)
			}
		}
	}
	return out, nil
}

func validateSnapshots(snapshots []Snapshot) error {
	seenCollections := make(map[string]struct{}, len(snapshots))
	for i := range snapshots {
		snapshot := &snapshots[i]
		snapshot.ExternalID = strings.TrimSpace(snapshot.ExternalID)
		snapshot.Kind = strings.TrimSpace(snapshot.Kind)
		snapshot.Name = strings.TrimSpace(snapshot.Name)
		snapshot.RemoteRevision = strings.TrimSpace(snapshot.RemoteRevision)
		if snapshot.ExternalID == "" || len([]byte(snapshot.ExternalID)) > 512 {
			return fmt.Errorf("collection %d external id is required and must be at most 512 bytes", i)
		}
		if snapshot.Kind == "" || len(snapshot.Kind) > maxCollectionKindBytes {
			return fmt.Errorf("collection %q has invalid kind", snapshot.ExternalID)
		}
		for _, r := range snapshot.Kind {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.') {
				return fmt.Errorf("collection %q has invalid kind", snapshot.ExternalID)
			}
		}
		if snapshot.Name == "" || len([]byte(snapshot.Name)) > maxCollectionNameBytes || !utf8.ValidString(snapshot.Name) {
			return fmt.Errorf("collection %q has invalid name", snapshot.ExternalID)
		}
		for _, r := range snapshot.Name {
			if r < 32 {
				return fmt.Errorf("collection %q name contains control characters", snapshot.ExternalID)
			}
		}
		if len([]byte(snapshot.RemoteRevision)) > 255 {
			return fmt.Errorf("collection %q remote revision is too long", snapshot.ExternalID)
		}
		if _, duplicate := seenCollections[snapshot.ExternalID]; duplicate {
			return fmt.Errorf("duplicate collection external id %q", snapshot.ExternalID)
		}
		seenCollections[snapshot.ExternalID] = struct{}{}

		seenMembers := make(map[string]struct{}, len(snapshot.Members))
		for j := range snapshot.Members {
			member := &snapshot.Members[j]
			member.ItemExternalID = strings.TrimSpace(member.ItemExternalID)
			if member.ItemExternalID == "" || len([]byte(member.ItemExternalID)) > 512 {
				return fmt.Errorf("collection %q has invalid member external id", snapshot.ExternalID)
			}
			if member.Position < 0 {
				return fmt.Errorf("collection %q has negative member position", snapshot.ExternalID)
			}
			if _, duplicate := seenMembers[member.ItemExternalID]; duplicate {
				return fmt.Errorf("collection %q has duplicate member %q", snapshot.ExternalID, member.ItemExternalID)
			}
			seenMembers[member.ItemExternalID] = struct{}{}
		}
	}
	return nil
}
