package api

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// An advisory limit, not permission to migrate oversized directories. The
// migration executor must re-prove ownership and writer exclusion under locks.
const maxSourceLegacyPreviewNodes = 5000

type sourceLegacyMigrationNode struct {
	ID           uint64
	OwnerID      uint64
	Name         string
	Type         string
	Revision     uint64
	RelativePath string
	Depth        int
}

type sourceLegacyMigrationPreview struct {
	SourceID            uint64    `json:"source_id"`
	TargetNodeID        *uint64   `json:"target_node_id,omitempty"`
	TargetManaged       bool      `json:"target_managed"`
	ReadOnly            bool      `json:"read_only"`
	CheckedAt           time.Time `json:"checked_at"`
	InspectedNodes      int       `json:"inspected_nodes"`
	VerifiedNodes       int       `json:"verified_nodes"`
	OrdinaryNodes       int       `json:"ordinary_nodes"`
	UnverifiedClaims    int       `json:"unverified_claims"`
	ForeignOwnerNodes   int       `json:"foreign_owner_nodes"`
	DirectRootShares    int64     `json:"direct_root_shares"`
	ActiveRuns          int64     `json:"active_runs"`
	ActiveUploads       int64     `json:"active_uploads"`
	UnfinishedFilesJobs int64     `json:"unfinished_files_jobs"`
	OtherSourceClaims   int64     `json:"other_source_claims"`
	InventoryTruncated  bool      `json:"inventory_truncated"`
	Classification      string    `json:"classification"`
	Blockers            []string  `json:"blockers"`
}

// This endpoint is a read-only migration *preview*, not a token or permission
// to relocate nodes. Actual migration must independently validate SourceItem,
// Share, revisions, Source overlaps and live writers in its own transaction.
// Local-folder metadata cannot be read with only an Owner JWT.
func (s *Server) previewLegacySourceMigration(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), id)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if denyLocalSourceDetailRead(c, source) {
		return
	}
	preview := sourceLegacyMigrationPreview{
		SourceID: source.ID, TargetNodeID: source.TargetNodeID,
		TargetManaged: source.TargetManaged, ReadOnly: true,
		CheckedAt: time.Now().UTC(), Classification: "requires_review",
		Blockers: make([]string, 0),
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var live meta.Source
		if err := tx.Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
			Take(&live).Error; err != nil {
			return err
		}
		// Snapshot a consistent Source binding and revision with the Node
		// inventory. A concurrently changed Source must be re-previewed.
		if live.Revision != source.Revision || live.Status != source.Status ||
			(live.TargetNodeID == nil) != (source.TargetNodeID == nil) {
			return errRevisionConflict
		}
		if live.TargetNodeID != nil && *live.TargetNodeID != *source.TargetNodeID {
			return errRevisionConflict
		}
		source = live
		if source.TargetNodeID == nil {
			preview.Classification = "no_target"
			preview.Blockers = append(preview.Blockers, "source_target_unbound")
			return nil
		}
		var target meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID).Take(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				preview.Blockers = append(preview.Blockers, "target_missing")
				return nil
			}
			return err
		}
		if target.Type != meta.NodeTypeDir {
			preview.Blockers = append(preview.Blockers, "target_not_directory")
			return nil
		}

		// Do not filter recursive children by OwnerID: malformed legacy
		// cross-owner edges must be reported, never silently skipped.
		var nodes []sourceLegacyMigrationNode
		if err := tx.Raw(`
WITH RECURSIVE tree AS (
 SELECT id, parent_id, owner_id, name, type, revision,
  ''::text AS relative_path, 0 AS depth, ARRAY[id]::bigint[] AS visited
 FROM xd_nodes WHERE id = ? AND deleted_at IS NULL
 UNION ALL
 SELECT n.id, n.parent_id, n.owner_id, n.name, n.type, n.revision,
  CASE WHEN tree.depth = 0 THEN n.name
   ELSE tree.relative_path || '/' || n.name END,
  tree.depth + 1, tree.visited || n.id
 FROM xd_nodes n JOIN tree ON n.parent_id = tree.id
 WHERE n.deleted_at IS NULL AND tree.depth < 128
  AND NOT n.id = ANY(tree.visited)
)
SELECT id, owner_id, name, type, revision, relative_path, depth
FROM tree ORDER BY depth, id LIMIT ?`, target.ID, maxSourceLegacyPreviewNodes+2).Scan(&nodes).Error; err != nil {
			return err
		}
		if len(nodes) > maxSourceLegacyPreviewNodes+1 {
			preview.InventoryTruncated = true
		}
		if len(nodes) == 0 {
			preview.Blockers = append(preview.Blockers, "target_missing")
			return nil
		}
		preview.InspectedNodes = len(nodes) - 1
		if preview.InspectedNodes > maxSourceLegacyPreviewNodes {
			preview.InspectedNodes = maxSourceLegacyPreviewNodes
		}
		if preview.InventoryTruncated {
			preview.Blockers = append(preview.Blockers, "inventory_limit_exceeded")
		}
		var sourceItems []meta.SourceItem
		if err := tx.Where("source_id = ?", source.ID).
			Limit(maxSourceLegacyPreviewNodes+2).Find(&sourceItems).Error; err != nil {
			return err
		}
		if len(sourceItems) > maxSourceLegacyPreviewNodes+1 {
			preview.Blockers = append(preview.Blockers, "source_item_limit_exceeded")
		}
		byID := make(map[uint64][]meta.SourceItem, len(sourceItems))
		visited := make(map[uint64]bool, len(nodes))
		for _, item := range sourceItems {
			if item.NodeID != nil {
				byID[*item.NodeID] = append(byID[*item.NodeID], item)
			}
		}
		for _, node := range nodes {
			visited[node.ID] = true
			if node.ID == target.ID {
				continue
			}
			if node.OwnerID != source.OwnerID {
				preview.ForeignOwnerNodes++
				continue
			}
			if node.Depth >= 128 {
				preview.Blockers = append(preview.Blockers, "nested_depth_limit")
			}
			claims := byID[node.ID]
			if len(claims) == 0 {
				preview.OrdinaryNodes++
				continue
			}
			kind := meta.SourceItemKindFile
			if node.Type == meta.NodeTypeDir {
				kind = meta.SourceItemKindDirectory
			}
			if len(claims) != 1 || claims[0].State != meta.SourceItemStateSynced ||
				claims[0].Kind != kind || claims[0].Path != node.RelativePath ||
				claims[0].NodeRevision != node.Revision {
				preview.UnverifiedClaims++
				continue
			}
			preview.VerifiedNodes++
		}
		for _, item := range sourceItems {
			if item.State == meta.SourceItemStateSynced &&
				(item.NodeID == nil || !visited[*item.NodeID]) {
				preview.Blockers = append(preview.Blockers, "synced_source_item_outside_inventory")
				break
			}
		}
		if preview.ForeignOwnerNodes != 0 {
			preview.Blockers = append(preview.Blockers, "foreign_owner_descendants")
		}
		if preview.UnverifiedClaims != 0 {
			preview.Blockers = append(preview.Blockers, "source_item_provenance_mismatch")
		}
		if err := tx.Model(&meta.Share{}).
			Where("owner_id = ? AND node_id = ?", source.OwnerID, target.ID).
			Count(&preview.DirectRootShares).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
			Count(&preview.ActiveRuns).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.UploadSession{}).
			Where("owner_id = ? AND status = ? AND expires_at > ?",
				source.OwnerID, meta.UploadStatusActive, preview.CheckedAt).
			Count(&preview.ActiveUploads).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.FileOperation{}).
			Where("owner_id = ? AND status IN ?", source.OwnerID, []string{
				meta.FileOperationStatusQueued, meta.FileOperationStatusRunning,
				meta.FileOperationStatusCancelRequested,
			}).Count(&preview.UnfinishedFilesJobs).Error; err != nil {
			return err
		}
		if preview.ActiveRuns != 0 {
			preview.Blockers = append(preview.Blockers, "active_sync_run")
		}
		if preview.ActiveUploads != 0 {
			preview.Blockers = append(preview.Blockers, "active_upload")
		}
		if preview.UnfinishedFilesJobs != 0 {
			preview.Blockers = append(preview.Blockers, "unfinished_files_operation")
		}
		var otherSource []meta.Source
		if err := tx.Where("owner_id = ? AND id <> ? AND target_node_id IS NOT NULL",
			source.OwnerID, source.ID).Find(&otherSource).Error; err != nil {
			return err
		}
		// Exact target conflicts are reportable without guessing an
		// ancestor/descendant relationship from string paths.
		for _, other := range otherSource {
			if other.TargetNodeID != nil && *other.TargetNodeID == target.ID {
				preview.OtherSourceClaims++
			}
		}
		if preview.OtherSourceClaims != 0 {
			preview.Blockers = append(preview.Blockers, "target_bound_to_other_source")
		}
		if source.TargetManaged {
			preview.Classification = "already_managed"
		} else if len(preview.Blockers) > 0 {
			preview.Classification = "blocked"
		} else if preview.OrdinaryNodes == 0 {
			preview.Classification = "apparently_exclusive"
		} else if preview.VerifiedNodes != 0 {
			preview.Classification = "mixed_requires_review"
		} else {
			preview.Classification = "unproven"
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if errors.Is(err, errRevisionConflict) {
		fail(c, http.StatusConflict, "source changed during migration preview; reload and retry")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "legacy migration preview failed")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, preview)
}
