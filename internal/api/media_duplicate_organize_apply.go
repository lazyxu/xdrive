package api

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errMediaDuplicateOrganizeConflict = errors.New("duplicate organization preview changed; review again")

const (
	mediaDuplicateOrganizeMaxManualAlbums  = 128
	mediaDuplicateOrganizeMaxDurablePeople = 128
)

// An annotation union is never a destructive duplicate cleanup. No original
// Node, Resource, EditRecipe or source-managed collection membership is moved.
type mediaDuplicateOrganizeApplyInput struct {
	KeeperNodeID         uint64   `json:"keeper_node_id"`
	NodeIDs              []uint64 `json:"node_ids"`
	ExpectedPlanRevision string   `json:"expected_plan_revision"`
	Confirm              bool     `json:"confirm"`
}

type mediaDuplicateOrganizeApplyResult struct {
	KeeperNodeID           uint64 `json:"keeper_node_id"`
	MetadataUpdated        bool   `json:"metadata_updated"`
	ManualAlbumsAdded      int    `json:"manual_albums_added"`
	DurablePeopleAdded     int    `json:"durable_people_added"`
	OriginalFilesRetained  bool   `json:"original_files_retained"`
	OriginalEditsRetained  bool   `json:"original_edits_retained"`
	SourceLinksUnchanged   bool   `json:"source_links_unchanged"`
	PhysicalBytesReclaimed int64  `json:"physical_bytes_reclaimed"`
}

func mediaDuplicateOrganizeApplyInputValid(in mediaDuplicateOrganizeApplyInput) bool {
	if !in.Confirm || in.KeeperNodeID == 0 ||
		len(in.NodeIDs) < 2 || len(in.NodeIDs) > mediaDuplicateOrganizePlanMaxMembers ||
		len(in.ExpectedPlanRevision) != 64 {
		return false
	}
	if _, err := hex.DecodeString(in.ExpectedPlanRevision); err != nil {
		return false
	}
	seen := make(map[uint64]struct{}, len(in.NodeIDs))
	for _, id := range in.NodeIDs {
		if id == 0 {
			return false
		}
		if _, exists := seen[id]; exists {
			return false
		}
		seen[id] = struct{}{}
	}
	_, included := seen[in.KeeperNodeID]
	return included
}

// Confirm every backing Node resource still matches the persisted projection.
// A changed Live motion/RAW/sidecar Node must fail closed even if a stale
// PhotoResource digest would otherwise appear equal in the organization plan.
func mediaDuplicateOrganizeResourcesCurrent(
	ctx context.Context, tx *gorm.DB, ownerID uint64, plan mediaDuplicateOrganizePlan,
) (bool, error) {
	expected := make(map[uint64]mediaDuplicateOrganizeResource)
	for _, member := range plan.Members {
		for _, resource := range member.Resources {
			if resource.Kind != meta.PhotoResourceKindNode {
				continue
			}
			if resource.NodeID == 0 || len(resource.SHA256) != 64 {
				return false, nil
			}
			if _, err := hex.DecodeString(resource.SHA256); err != nil {
				return false, nil
			}
			if previous, exists := expected[resource.NodeID]; exists {
				if previous.SHA256 != resource.SHA256 ||
					previous.Size != resource.Size ||
					previous.MediaKind != resource.MediaKind {
					return false, nil
				}
			}
			expected[resource.NodeID] = resource
		}
	}
	if len(expected) == 0 || len(expected) > 4096 {
		return false, nil
	}
	nodeIDs := make([]uint64, 0, len(expected))
	for id := range expected {
		nodeIDs = append(nodeIDs, id)
	}
	type currentNodeResource struct {
		NodeID          uint64
		NodeRevision    uint64
		IndexedRevision uint64
		FileSHA256      string
		IndexSHA256     string
		Size            int64
		MediaKind       string
		MIMEType        string
		IndexState      string
	}
	var rows []currentNodeResource
	if err := tx.WithContext(ctx).
		Table("xd_nodes AS n").
		Select(
			"n.id AS node_id, n.revision AS node_revision, "+
				"mm.node_revision AS indexed_revision, f.sha256 AS file_sha256, "+
				"mm.sha256 AS index_sha256, f.size AS size, "+
				"mm.media_kind, mm.mime_type, mm.index_state",
		).
		Joins("JOIN xd_files AS f ON f.node_id = n.id").
		Joins("JOIN xd_media_metadata AS mm ON mm.node_id = n.id "+
			"AND mm.owner_id = n.owner_id").
		Where("n.owner_id = ? AND n.deleted_at IS NULL AND n.id IN ?", ownerID, nodeIDs).
		Scan(&rows).Error; err != nil {
		return false, err
	}
	if len(rows) != len(expected) {
		return false, nil
	}
	for _, row := range rows {
		resource, ok := expected[row.NodeID]
		if !ok || row.NodeRevision == 0 ||
			row.NodeRevision != row.IndexedRevision ||
			row.IndexState != meta.MediaIndexStateReady ||
			row.Size != resource.Size ||
			row.MediaKind != resource.MediaKind ||
			!strings.EqualFold(row.MIMEType, resource.MIMEType) ||
			!strings.EqualFold(row.FileSHA256, resource.SHA256) ||
			!strings.EqualFold(row.IndexSHA256, resource.SHA256) {
			return false, nil
		}
	}
	return true, nil
}

func (s *Server) applyMediaDuplicateOrganizeMetadata(
	ctx context.Context, ownerID uint64, in mediaDuplicateOrganizeApplyInput,
) (mediaDuplicateOrganizeApplyResult, error) {
	var out mediaDuplicateOrganizeApplyResult
	if s.DB == nil || ownerID == 0 || !mediaDuplicateOrganizeApplyInputValid(in) {
		return out, errMediaDuplicateOrganizeConflict
	}

	// Serializable isolation protects a reviewed snapshot from concurrent
	// annotation, album, identity or sync revisions. Do not retry a changed
	// plan silently: the user must see and approve a fresh preview.
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		plan, err := (&Server{DB: tx}).queryMediaDuplicateOrganizePlan(
			ctx, ownerID, in.KeeperNodeID, in.NodeIDs,
		)
		if err != nil {
			return err
		}
		if plan.AssetComparison != duplicateAssetIdentical ||
			!plan.ReadyForManualReview || !strings.EqualFold(
			plan.PlanRevision, in.ExpectedPlanRevision,
		) {
			return errMediaDuplicateOrganizeConflict
		}
		fresh, err := mediaDuplicateOrganizeResourcesCurrent(ctx, tx, ownerID, plan)
		if err != nil {
			return err
		}
		if !fresh {
			return errMediaDuplicateOrganizeConflict
		}

		tagsJSON, err := encodeMediaTags(plan.CombinedTags)
		if err != nil {
			return fmt.Errorf("%w: tags cannot be merged without loss", errMediaDuplicateOrganizeConflict)
		}
		peopleJSON, err := encodeMediaPeople(plan.CombinedPeopleLabels)
		if err != nil {
			return fmt.Errorf("%w: people notes cannot be merged without loss", errMediaDuplicateOrganizeConflict)
		}
		description := ""
		if len(plan.Descriptions) > 1 {
			return errMediaDuplicateOrganizeConflict
		}
		if len(plan.Descriptions) == 1 {
			description, err = normalizeMediaDescription(plan.Descriptions[0])
			if err != nil {
				return fmt.Errorf("%w: description cannot be preserved safely", errMediaDuplicateOrganizeConflict)
			}
		}

		var keeper mediaDuplicateOrganizeMember
		foundKeeper := false
		manualAlbums := make(map[uint64]struct{})
		personKeys := make(map[string]struct{})
		keeperManual := make(map[uint64]struct{})
		keeperPeople := make(map[string]struct{})
		for _, member := range plan.Members {
			if member.NodeID == in.KeeperNodeID {
				keeper = member
				foundKeeper = true
			}
			for _, collection := range member.Collections {
				if collection.Kind != meta.PhotoCollectionKindManual {
					// Folder and provider-owned source albums are derived from
					// the original paths/sync identities and must not be copied.
					continue
				}
				manualAlbums[collection.ID] = struct{}{}
				if member.NodeID == in.KeeperNodeID {
					keeperManual[collection.ID] = struct{}{}
				}
			}
			for _, person := range member.People {
				personKeys[person.PersonKey] = struct{}{}
				if member.NodeID == in.KeeperNodeID {
					keeperPeople[person.PersonKey] = struct{}{}
				}
			}
		}
		if !foundKeeper || len(manualAlbums) > mediaDuplicateOrganizeMaxManualAlbums ||
			len(personKeys) > mediaDuplicateOrganizeMaxDurablePeople {
			return errMediaDuplicateOrganizeConflict
		}

		var keeperMetadata meta.PhotoMetadata
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ?", keeper.AssetID).
			First(&keeperMetadata).Error; err != nil {
			return err
		}
		// Source metadata remains untouched. Only user-owned annotation
		// columns are changed, and only when the resulting union is distinct.
		updates := map[string]any{}
		if keeperMetadata.Favorite != plan.CombinedFavorites {
			updates["favorite"] = plan.CombinedFavorites
		}
		if keeperMetadata.Description != description {
			updates["description"] = description
		}
		if keeperMetadata.TagsJSON != tagsJSON {
			updates["tags_json"] = tagsJSON
		}
		if keeperMetadata.PeopleJSON != peopleJSON {
			updates["people_json"] = peopleJSON
		}
		now := time.Now().UTC()
		if len(updates) != 0 {
			updates["updated_at"] = now
			result := tx.Model(&meta.PhotoMetadata{}).
				Where("asset_id = ?", keeper.AssetID).
				Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errMediaDuplicateOrganizeConflict
			}
			out.MetadataUpdated = true
		}

		albumIDs := make([]uint64, 0, len(manualAlbums))
		for id := range manualAlbums {
			albumIDs = append(albumIDs, id)
		}
		sort.Slice(albumIDs, func(i, j int) bool { return albumIDs[i] < albumIDs[j] })
		for _, id := range albumIDs {
			if _, already := keeperManual[id]; already {
				continue
			}
			var album meta.PhotoCollection
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ? AND kind = ? AND state = ?",
					id, ownerID, meta.PhotoCollectionKindManual,
					meta.PhotoCollectionStateActive).
				First(&album).Error; err != nil {
				return fmt.Errorf("%w: manual album changed", errMediaDuplicateOrganizeConflict)
			}
			var existing int64
			if err := tx.Model(&meta.PhotoCollectionAsset{}).
				Where("collection_id = ? AND asset_id = ?", id, keeper.AssetID).
				Count(&existing).Error; err != nil {
				return err
			}
			if existing != 0 {
				continue
			}
			var position int64
			if err := tx.Model(&meta.PhotoCollectionAsset{}).
				Where("collection_id = ?", id).
				Select("COALESCE(MAX(position), -1)").
				Scan(&position).Error; err != nil {
				return err
			}
			membership := meta.PhotoCollectionAsset{
				CollectionID: id, AssetID: keeper.AssetID, Position: position + 1,
				CreatedAt: now, UpdatedAt: now,
			}
			if err := tx.Create(&membership).Error; err != nil {
				return err
			}
			result := tx.Model(&meta.PhotoCollection{}).
				Where("id = ? AND owner_id = ? AND revision = ?",
					id, ownerID, album.Revision).
				Updates(map[string]any{
					"revision": gorm.Expr("revision + 1"), "updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errMediaDuplicateOrganizeConflict
			}
			out.ManualAlbumsAdded++
		}

		keys := make([]string, 0, len(personKeys))
		for key := range personKeys {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if _, already := keeperPeople[key]; already {
				continue
			}
			var person meta.PhotoPerson
			if err := tx.Where("owner_id = ? AND person_key = ?", ownerID, key).
				First(&person).Error; err != nil {
				return fmt.Errorf("%w: persistent person identity changed", errMediaDuplicateOrganizeConflict)
			}
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.PhotoPersonAsset{
					PersonID: person.ID, AssetID: keeper.AssetID,
					CreatedAt: now, UpdatedAt: now,
				})
			if result.Error != nil {
				return result.Error
			}
			out.DurablePeopleAdded += int(result.RowsAffected)
		}

		out.KeeperNodeID = in.KeeperNodeID
		out.OriginalFilesRetained = true
		out.OriginalEditsRetained = true
		out.SourceLinksUnchanged = true
		out.PhysicalBytesReclaimed = 0

		// Persist one transactionally consistent audit record. Do not include
		// user descriptions or tags in audit metadata.
		id := ownerID
		event := auditpkg.Event{
			ActorUserID: &id, Action: "media.duplicate.organize_metadata",
			TargetType: "photo_asset", TargetID: fmt.Sprint(keeper.AssetID),
			Result: auditpkg.ResultSuccess,
			Metadata: map[string]any{
				"keeper_node_id": in.KeeperNodeID, "node_ids": in.NodeIDs,
				"expected_plan_revision":  in.ExpectedPlanRevision,
				"metadata_updated":        out.MetadataUpdated,
				"manual_albums_added":     out.ManualAlbumsAdded,
				"durable_people_added":    out.DurablePeopleAdded,
				"original_files_retained": true, "physical_bytes_reclaimed": 0,
			},
		}
		return recordAuditTx(tx, event)
	}, &sql.TxOptions{Isolation: sql.LevelSerializable})
	return out, err
}

func (s *Server) applyMediaDuplicateOrganize(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var in mediaDuplicateOrganizeApplyInput
	if c.ShouldBindJSON(&in) != nil || !mediaDuplicateOrganizeApplyInputValid(in) {
		fail(c, http.StatusBadRequest, "explicit keeper, 2–32 distinct media IDs, current plan revision and confirmation are required")
		return
	}
	out, err := s.applyMediaDuplicateOrganizeMetadata(c.Request.Context(), userID(c), in)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "one or more original media assets are unavailable")
		} else if errors.Is(err, errMediaDuplicateOrganizeConflict) ||
			strings.Contains(err.Error(), "SQLSTATE 40001") {
			fail(c, http.StatusConflict, "organization preview changed or cannot be preserved; review again")
		} else {
			fail(c, http.StatusInternalServerError, "duplicate metadata organization failed")
		}
		return
	}
	c.JSON(http.StatusOK, out)
}
