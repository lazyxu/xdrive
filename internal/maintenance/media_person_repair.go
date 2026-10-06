package maintenance

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	MediaPhotoIntelligenceGCMinAge    = 24 * time.Hour
	mediaPhotoIntelligenceGCBatchSize = 1000
)

type MediaPersonMembershipRepairAction struct {
	OwnerID     uint64 `json:"owner_id,omitempty"`
	PersonRowID uint64 `json:"person_row_id"`
	PersonID    string `json:"person_id,omitempty"`
	AssetID     uint64 `json:"asset_id"`
	Reason      string `json:"reason"`
	Applied     bool   `json:"applied"`
}

type MediaPersonCoverRepairAction struct {
	OwnerID         uint64   `json:"owner_id"`
	PersonRowID     uint64   `json:"person_row_id"`
	PersonID        string   `json:"person_id,omitempty"`
	PreviousAssetID uint64   `json:"previous_asset_id,omitempty"`
	Reasons         []string `json:"reasons"`
	Applied         bool     `json:"applied"`
}

type MediaPersonClusterRepairAction struct {
	OwnerID         uint64   `json:"owner_id"`
	ClusterIDs      []uint64 `json:"cluster_ids,omitempty"`
	ResetProjection bool     `json:"reset_projection"`
	Reasons         []string `json:"reasons"`
	Applied         bool     `json:"applied"`
}

type MediaPhotoIntelligenceGCAction struct {
	OwnerID       uint64    `json:"owner_id"`
	ClusterID     uint64    `json:"cluster_id"`
	ClusterKey    string    `json:"cluster_key,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
	Reason        string    `json:"reason"`
	Applied       bool      `json:"applied"`
	SkippedReason string    `json:"skipped_reason,omitempty"`
}

type MediaPhotoIntelligenceGCReport struct {
	DryRun            bool                             `json:"dry_run"`
	MinAgeSeconds     int64                            `json:"min_age_seconds"`
	ScannedClusters   int64                            `json:"scanned_clusters"`
	CandidateClusters int64                            `json:"candidate_clusters"`
	DeletedClusters   int64                            `json:"deleted_clusters"`
	Actions           []MediaPhotoIntelligenceGCAction `json:"actions,omitempty"`
}

func planMediaPhotoPersonRepairs(
	issues []MediaIntegrityIssue,
) (
	[]MediaPersonMembershipRepairAction,
	[]MediaPersonCoverRepairAction,
	[]MediaPersonClusterRepairAction,
	[]MediaIntegrityIssue,
) {
	membershipReasons := map[string]struct{}{
		"person_membership_person_missing": {},
		"person_membership_asset_missing":  {},
		"person_membership_owner_mismatch": {},
	}
	coverReasons := map[string]struct{}{
		"person_cover_asset_missing":  {},
		"person_cover_owner_mismatch": {},
		"person_cover_not_member":     {},
	}
	clusterResetReasons := map[string]struct{}{
		"person_cluster_key_invalid":             {},
		"person_cluster_state_missing":           {},
		"person_cluster_version_mismatch":        {},
		"person_cluster_face_missing":            {},
		"person_cluster_face_asset_missing":      {},
		"person_cluster_face_owner_mismatch":     {},
		"person_cluster_face_confidence_invalid": {},
		"person_cluster_state_invalid":           {},
		"person_cluster_state_analyzer_stale":    {},
		"person_cluster_state_ready_incomplete":  {},
	}

	type pendingCover struct {
		action  MediaPersonCoverRepairAction
		reasons map[string]struct{}
	}
	type pendingCluster struct {
		action     MediaPersonClusterRepairAction
		reasons    map[string]struct{}
		clusterIDs map[uint64]struct{}
	}

	var membershipActions []MediaPersonMembershipRepairAction
	covers := make(map[uint64]*pendingCover)
	clusters := make(map[uint64]*pendingCluster)
	var skipped []MediaIntegrityIssue

	for _, issue := range issues {
		if _, ok := membershipReasons[issue.Reason]; ok &&
			issue.PersonRowID != 0 && issue.AssetID != 0 {
			membershipActions = append(membershipActions, MediaPersonMembershipRepairAction{
				OwnerID: issue.OwnerID, PersonRowID: issue.PersonRowID,
				PersonID: issue.PersonID, AssetID: issue.AssetID, Reason: issue.Reason,
			})
			continue
		}
		if _, ok := coverReasons[issue.Reason]; ok && issue.PersonRowID != 0 {
			pending := covers[issue.PersonRowID]
			if pending == nil {
				pending = &pendingCover{
					action: MediaPersonCoverRepairAction{
						OwnerID: issue.OwnerID, PersonRowID: issue.PersonRowID,
						PersonID: issue.PersonID, PreviousAssetID: issue.AssetID,
					},
					reasons: make(map[string]struct{}),
				}
				covers[issue.PersonRowID] = pending
			}
			pending.reasons[issue.Reason] = struct{}{}
			continue
		}
		if issue.Reason == "person_cluster_empty" &&
			issue.OwnerID != 0 && issue.ClusterID != 0 {
			pending := clusters[issue.OwnerID]
			if pending == nil {
				pending = &pendingCluster{
					action:  MediaPersonClusterRepairAction{OwnerID: issue.OwnerID},
					reasons: make(map[string]struct{}), clusterIDs: make(map[uint64]struct{}),
				}
				clusters[issue.OwnerID] = pending
			}
			pending.reasons[issue.Reason] = struct{}{}
			pending.clusterIDs[issue.ClusterID] = struct{}{}
			continue
		}
		if _, ok := clusterResetReasons[issue.Reason]; ok && issue.OwnerID != 0 {
			pending := clusters[issue.OwnerID]
			if pending == nil {
				pending = &pendingCluster{
					action:  MediaPersonClusterRepairAction{OwnerID: issue.OwnerID},
					reasons: make(map[string]struct{}), clusterIDs: make(map[uint64]struct{}),
				}
				clusters[issue.OwnerID] = pending
			}
			pending.action.ResetProjection = true
			pending.reasons[issue.Reason] = struct{}{}
			continue
		}
		skipped = append(skipped, issue)
	}

	sort.Slice(membershipActions, func(i, j int) bool {
		if membershipActions[i].PersonRowID != membershipActions[j].PersonRowID {
			return membershipActions[i].PersonRowID < membershipActions[j].PersonRowID
		}
		return membershipActions[i].AssetID < membershipActions[j].AssetID
	})

	coverActions := make([]MediaPersonCoverRepairAction, 0, len(covers))
	for _, pending := range covers {
		for reason := range pending.reasons {
			pending.action.Reasons = append(pending.action.Reasons, reason)
		}
		sort.Strings(pending.action.Reasons)
		coverActions = append(coverActions, pending.action)
	}
	sort.Slice(coverActions, func(i, j int) bool {
		return coverActions[i].PersonRowID < coverActions[j].PersonRowID
	})

	clusterActions := make([]MediaPersonClusterRepairAction, 0, len(clusters))
	for _, pending := range clusters {
		for reason := range pending.reasons {
			pending.action.Reasons = append(pending.action.Reasons, reason)
		}
		sort.Strings(pending.action.Reasons)
		if !pending.action.ResetProjection {
			for clusterID := range pending.clusterIDs {
				pending.action.ClusterIDs = append(pending.action.ClusterIDs, clusterID)
			}
			sort.Slice(pending.action.ClusterIDs, func(i, j int) bool {
				return pending.action.ClusterIDs[i] < pending.action.ClusterIDs[j]
			})
		}
		clusterActions = append(clusterActions, pending.action)
	}
	sort.Slice(clusterActions, func(i, j int) bool {
		return clusterActions[i].OwnerID < clusterActions[j].OwnerID
	})

	return membershipActions, coverActions, clusterActions, skipped
}

func applyMediaPersonMembershipRepair(
	ctx context.Context,
	db *gorm.DB,
	action *MediaPersonMembershipRepairAction,
) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var membership meta.PhotoPersonAsset
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("person_id = ? AND asset_id = ?", action.PersonRowID, action.AssetID).
			First(&membership).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}

		var person meta.PhotoPerson
		personErr := tx.Where("id = ?", action.PersonRowID).First(&person).Error
		var asset meta.PhotoAsset
		assetErr := tx.Where("id = ?", action.AssetID).First(&asset).Error
		invalid := personErr == gorm.ErrRecordNotFound || assetErr == gorm.ErrRecordNotFound
		if personErr != nil && personErr != gorm.ErrRecordNotFound {
			return personErr
		}
		if assetErr != nil && assetErr != gorm.ErrRecordNotFound {
			return assetErr
		}
		if personErr == nil && assetErr == nil && person.OwnerID != asset.OwnerID {
			invalid = true
		}
		if !invalid {
			return nil
		}

		result := tx.Where(
			"person_id = ? AND asset_id = ?",
			action.PersonRowID,
			action.AssetID,
		).Delete(&meta.PhotoPersonAsset{})
		if result.Error != nil {
			return result.Error
		}
		action.Applied = result.RowsAffected > 0
		return nil
	})
}

func applyMediaPersonCoverRepair(
	ctx context.Context,
	db *gorm.DB,
	action *MediaPersonCoverRepairAction,
) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var person meta.PhotoPerson
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", action.PersonRowID).First(&person).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil
			}
			return err
		}
		if person.CoverAssetID == nil || *person.CoverAssetID == 0 {
			return nil
		}

		assetID := *person.CoverAssetID
		invalid := false
		var asset meta.PhotoAsset
		err := tx.Where("id = ?", assetID).First(&asset).Error
		if err == gorm.ErrRecordNotFound {
			invalid = true
		} else if err != nil {
			return err
		} else if asset.OwnerID != person.OwnerID {
			invalid = true
		}
		if !invalid {
			var count int64
			if err := tx.Model(&meta.PhotoPersonAsset{}).
				Where("person_id = ? AND asset_id = ?", person.ID, assetID).
				Count(&count).Error; err != nil {
				return err
			}
			invalid = count == 0
		}
		if !invalid {
			return nil
		}

		now := time.Now().UTC()
		result := tx.Model(&meta.PhotoPerson{}).
			Where("id = ? AND revision = ?", person.ID, person.Revision).
			Updates(map[string]any{
				"cover_asset_id": nil,
				"revision":       gorm.Expr("revision + 1"),
				"updated_at":     now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			action.PreviousAssetID = assetID
			action.Applied = true
		}
		return nil
	})
}

func applyMediaPersonClusterRepair(
	ctx context.Context,
	db *gorm.DB,
	action *MediaPersonClusterRepairAction,
) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if action.ResetProjection {
			clusters := tx.Where("owner_id = ?", action.OwnerID).
				Delete(&meta.PhotoPersonCluster{})
			if clusters.Error != nil {
				return clusters.Error
			}
			state := tx.Where("owner_id = ?", action.OwnerID).
				Delete(&meta.PhotoPersonClusterState{})
			if state.Error != nil {
				return state.Error
			}
			action.Applied = clusters.RowsAffected > 0 || state.RowsAffected > 0
			return nil
		}

		for start := 0; start < len(action.ClusterIDs); start += mediaPhotoIntelligenceGCBatchSize {
			end := start + mediaPhotoIntelligenceGCBatchSize
			if end > len(action.ClusterIDs) {
				end = len(action.ClusterIDs)
			}
			var rows []meta.PhotoPersonCluster
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where(
					"owner_id = ? AND id IN ?",
					action.OwnerID,
					action.ClusterIDs[start:end],
				).Find(&rows).Error; err != nil {
				return err
			}
			for _, cluster := range rows {
				var count int64
				if err := tx.Model(&meta.PhotoPersonClusterFace{}).
					Where("cluster_id = ?", cluster.ID).
					Count(&count).Error; err != nil {
					return err
				}
				if count != 0 {
					continue
				}
				result := tx.Where("id = ?", cluster.ID).
					Delete(&meta.PhotoPersonCluster{})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected > 0 {
					action.Applied = true
				}
			}
		}
		return nil
	})
}

func GarbageCollectPhotoIntelligence(
	ctx context.Context,
	db *gorm.DB,
	dryRun bool,
) (MediaPhotoIntelligenceGCReport, error) {
	report := MediaPhotoIntelligenceGCReport{
		DryRun:        dryRun,
		MinAgeSeconds: int64(MediaPhotoIntelligenceGCMinAge / time.Second),
	}
	if db == nil {
		return report, fmt.Errorf("photo intelligence GC database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var clusters []meta.PhotoPersonCluster
	if err := db.WithContext(ctx).
		Order("owner_id ASC, id ASC").
		Find(&clusters).Error; err != nil {
		return report, fmt.Errorf("query person clusters for GC: %w", err)
	}
	var states []meta.PhotoPersonClusterState
	if err := db.WithContext(ctx).Find(&states).Error; err != nil {
		return report, fmt.Errorf("query person cluster states for GC: %w", err)
	}
	stateByOwner := make(map[uint64]meta.PhotoPersonClusterState, len(states))
	for _, state := range states {
		stateByOwner[state.OwnerID] = state
	}
	var counts []struct {
		ClusterID uint64
		Count     int64
	}
	if err := db.WithContext(ctx).
		Model(&meta.PhotoPersonClusterFace{}).
		Select("cluster_id, COUNT(*) AS count").
		Group("cluster_id").
		Scan(&counts).Error; err != nil {
		return report, fmt.Errorf("query person cluster membership counts for GC: %w", err)
	}
	countByCluster := make(map[uint64]int64, len(counts))
	for _, row := range counts {
		countByCluster[row.ClusterID] = row.Count
	}

	report.ScannedClusters = int64(len(clusters))
	cutoff := time.Now().UTC().Add(-MediaPhotoIntelligenceGCMinAge)
	for _, cluster := range clusters {
		if cluster.UpdatedAt.After(cutoff) {
			continue
		}
		reason := mediaPhotoIntelligenceGCReason(
			cluster,
			countByCluster[cluster.ID],
			stateByOwner,
		)
		if reason == "" {
			continue
		}
		report.Actions = append(report.Actions, MediaPhotoIntelligenceGCAction{
			OwnerID: cluster.OwnerID, ClusterID: cluster.ID, ClusterKey: cluster.ClusterKey,
			UpdatedAt: cluster.UpdatedAt.UTC(), Reason: reason,
		})
	}
	report.CandidateClusters = int64(len(report.Actions))
	if dryRun || len(report.Actions) == 0 {
		return report, nil
	}

	for index := range report.Actions {
		action := &report.Actions[index]
		if err := applyMediaPhotoIntelligenceGCAction(
			ctx,
			db,
			cutoff,
			action,
		); err != nil {
			return report, err
		}
		if action.Applied {
			report.DeletedClusters++
		}
	}
	return report, nil
}

func mediaPhotoIntelligenceGCReason(
	cluster meta.PhotoPersonCluster,
	membershipCount int64,
	states map[uint64]meta.PhotoPersonClusterState,
) string {
	if membershipCount == 0 {
		return "empty_cluster"
	}
	state, ok := states[cluster.OwnerID]
	if !ok {
		return "state_missing"
	}
	if state.State != meta.PhotoAnalysisStateReady {
		return "state_not_ready"
	}
	if state.AnalyzerVersion != photointelligence.PersonClusterAnalyzerVersion() {
		return "state_analyzer_stale"
	}
	if cluster.AnalyzerVersion != state.AnalyzerVersion ||
		cluster.EmbeddingVersion != state.EmbeddingVersion {
		return "version_mismatch"
	}
	return ""
}

func applyMediaPhotoIntelligenceGCAction(
	ctx context.Context,
	db *gorm.DB,
	cutoff time.Time,
	action *MediaPhotoIntelligenceGCAction,
) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cluster meta.PhotoPersonCluster
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND owner_id = ?",
				action.ClusterID,
				action.OwnerID,
			).First(&cluster).Error
		if err == gorm.ErrRecordNotFound {
			action.SkippedReason = "already_deleted"
			return nil
		}
		if err != nil {
			return err
		}
		if cluster.UpdatedAt.After(cutoff) {
			action.SkippedReason = "became_recent"
			return nil
		}

		var count int64
		if err := tx.Model(&meta.PhotoPersonClusterFace{}).
			Where("cluster_id = ?", cluster.ID).
			Count(&count).Error; err != nil {
			return err
		}
		states := make(map[uint64]meta.PhotoPersonClusterState, 1)
		var state meta.PhotoPersonClusterState
		err = tx.Where("owner_id = ?", cluster.OwnerID).First(&state).Error
		if err == nil {
			states[state.OwnerID] = state
		} else if err != gorm.ErrRecordNotFound {
			return err
		}
		reason := mediaPhotoIntelligenceGCReason(cluster, count, states)
		if reason == "" {
			action.SkippedReason = "became_authoritative"
			return nil
		}
		action.Reason = reason

		result := tx.Where("id = ?", cluster.ID).
			Delete(&meta.PhotoPersonCluster{})
		if result.Error != nil {
			return result.Error
		}
		action.Applied = result.RowsAffected > 0
		return nil
	})
}
