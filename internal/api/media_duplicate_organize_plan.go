package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaDuplicateOrganizePlanMaxMembers = 32
	mediaDuplicateOrganizeMaxSourceLinks = 1024
)

// This is a dry-run, read-only projection. It does not authorize any
// replacement, blob dereference, trash transition, or source identity rewrite.
type mediaDuplicateOrganizeMembership struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type mediaDuplicateOrganizePerson struct {
	PersonKey string `json:"person_key"`
	Name      string `json:"name"`
}

type mediaDuplicateOrganizeResource struct {
	Kind       string `json:"kind"`
	Role       string `json:"role"`
	NodeID     uint64 `json:"node_id"`
	Ordinal    int    `json:"ordinal"`
	Name       string `json:"name"`
	MediaKind  string `json:"media_kind"`
	MIMEType   string `json:"mime_type"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
	ByteOffset int64  `json:"byte_offset"`
}

// SourceItem associations are evidence of a *current local link*, not a full
// remote inventory or a guarantee that the item cannot be downloaded again.
type mediaDuplicateOrganizeSourceLink struct {
	SourceID       uint64 `json:"source_id"`
	SourceName     string `json:"source_name"`
	SourceKind     string `json:"source_kind"`
	SourceStatus   string `json:"source_status"`
	Direction      string `json:"direction"`
	SyncMode       string `json:"sync_mode"`
	SourceItemID   uint64 `json:"source_item_id"`
	ResourceNodeID uint64 `json:"resource_node_id"`
	Path           string `json:"path"`
	ItemState      string `json:"item_state"`
	MayReimport    bool   `json:"may_reimport"`
}

type mediaDuplicateOrganizeMember struct {
	NodeID        uint64                             `json:"node_id"`
	AssetID       uint64                             `json:"asset_id"`
	AssetKind     string                             `json:"asset_kind"`
	NodeRevision  uint64                             `json:"node_revision"`
	SHA256        string                             `json:"sha256"`
	Favorite      bool                               `json:"favorite"`
	Description   string                             `json:"description"`
	Tags          []string                           `json:"tags"`
	PeopleLabels  []string                           `json:"people_labels"`
	Collections   []mediaDuplicateOrganizeMembership `json:"collections"`
	People        []mediaDuplicateOrganizePerson     `json:"durable_people"`
	Resources     []mediaDuplicateOrganizeResource   `json:"original_resources"`
	SourceLinks   []mediaDuplicateOrganizeSourceLink `json:"source_links"`
	EditRecipe    *mediaEditRecipeDTO                `json:"edit_recipe,omitempty"`
	HasEditRecipe bool                               `json:"has_edit_recipe"`
}

type mediaDuplicateOrganizePlan struct {
	PlanRevision               string                         `json:"plan_revision"`
	KeeperNodeID               uint64                         `json:"keeper_node_id"`
	Members                    []mediaDuplicateOrganizeMember `json:"members"`
	AssetComparison            string                         `json:"asset_comparison"`
	Reason                     string                         `json:"reason"`
	Descriptions               []string                       `json:"distinct_descriptions"`
	CombinedTags               []string                       `json:"combined_tags"`
	CombinedPeopleLabels       []string                       `json:"combined_people_labels"`
	CombinedFavorites          bool                           `json:"combined_favorite"`
	ManualAlbumCount           int                            `json:"manual_album_count"`
	DurablePersonCount         int                            `json:"durable_person_count"`
	SourceManagedAssets        int                            `json:"source_managed_assets"`
	PotentialReimportAssets    int                            `json:"potential_reimport_assets"`
	ReadyForManualReview       bool                           `json:"ready_for_manual_review"`
	RequiresManualConfirmation bool                           `json:"requires_manual_confirmation"`
	NoMutation                 bool                           `json:"no_mutation"`
	PhysicalReclaimableBytes   int64                          `json:"physical_reclaimable_bytes"`
	SourceWarning              string                         `json:"source_warning"`
}

func decodeMediaOrganizeList(raw string) ([]string, bool) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, true
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, false
	}
	for _, item := range values {
		if strings.TrimSpace(item) == "" {
			return nil, false
		}
	}
	sort.Strings(values)
	return values, true
}

func distinctMediaOrganizeStrings(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

// A Mirror SourceItem can later trash any bound Node resource after a
// confirmed remote disappearance. User annotations cannot be aggregated onto
// that volatile keeper until xDrive has a durable independent keeper policy.
// Check *all* verified resource links, not only the primary still image.
func mediaDuplicateOrganizeKeeperMirrorManaged(plan mediaDuplicateOrganizePlan) bool {
	for _, member := range plan.Members {
		if member.NodeID != plan.KeeperNodeID {
			continue
		}
		for _, link := range member.SourceLinks {
			if link.SyncMode == meta.SourceSyncModeMirror {
				return true
			}
		}
	}
	return false
}

func (s *Server) queryMediaDuplicateOrganizePlan(
	ctx context.Context, ownerID, keeperID uint64, nodeIDs []uint64,
) (mediaDuplicateOrganizePlan, error) {
	var out mediaDuplicateOrganizePlan
	if ownerID == 0 || len(nodeIDs) < 2 || len(nodeIDs) > mediaDuplicateOrganizePlanMaxMembers {
		return out, gorm.ErrRecordNotFound
	}
	seen := make(map[uint64]struct{}, len(nodeIDs))
	for _, id := range nodeIDs {
		if id == 0 {
			return out, gorm.ErrRecordNotFound
		}
		if _, duplicate := seen[id]; duplicate {
			return out, gorm.ErrRecordNotFound
		}
		seen[id] = struct{}{}
	}
	if _, included := seen[keeperID]; !included {
		return out, gorm.ErrRecordNotFound
	}

	type memberRow struct {
		NodeID       uint64
		AssetID      uint64
		AssetKind    string
		SHA256       string
		NodeRevision uint64
		Favorite     bool
		Description  string
		TagsJSON     string
		PeopleJSON   string
	}
	var rows []memberRow
	err := s.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
		Select(
			"pa.id AS asset_id, pa.primary_node_id AS node_id, pa.kind AS asset_kind, "+
				"f.sha256, n.revision AS node_revision, pm.favorite, pm.description, "+
				"pm.tags_json, pm.people_json",
		).
		Joins(
			"JOIN xd_nodes AS n ON n.id = pa.primary_node_id "+
				"AND n.owner_id = pa.owner_id AND n.deleted_at IS NULL",
		).
		Joins("JOIN xd_files AS f ON f.node_id = n.id").
		Joins(
			"JOIN xd_media_metadata AS mm ON mm.node_id = n.id "+
				"AND mm.owner_id = pa.owner_id AND mm.index_state = ? "+
				"AND mm.node_revision = n.revision AND mm.sha256 = f.sha256",
			meta.MediaIndexStateReady,
		).
		Joins("JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Where("pa.owner_id = ? AND pa.primary_node_id IN ?", ownerID, nodeIDs).
		Order("pa.primary_node_id ASC").
		Scan(&rows).Error
	if err != nil {
		return out, err
	}
	if len(rows) != len(nodeIDs) {
		return out, gorm.ErrRecordNotFound
	}
	assetIDs := make([]uint64, 0, len(rows))
	for _, row := range rows {
		assetIDs = append(assetIDs, row.AssetID)
	}
	var resources []meta.PhotoResource
	if err := s.DB.WithContext(ctx).Where("asset_id IN ?", assetIDs).
		Find(&resources).Error; err != nil {
		return out, err
	}
	byResource := make(map[uint64][]meta.PhotoResource)
	for _, res := range resources {
		byResource[res.AssetID] = append(byResource[res.AssetID], res)
	}
	var recipes []meta.PhotoEditRecipe
	if err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND asset_id IN ?", ownerID, assetIDs).
		Find(&recipes).Error; err != nil {
		return out, err
	}
	byRecipe := make(map[uint64]meta.PhotoEditRecipe)
	for _, recipe := range recipes {
		byRecipe[recipe.AssetID] = recipe
	}
	type collectionRow struct {
		AssetID        uint64
		CollectionID   uint64
		CollectionName string
		CollectionKind string
	}
	var collections []collectionRow
	if err := s.DB.WithContext(ctx).
		Table("xd_photo_collection_assets AS pca").
		Select(
			"pca.asset_id, pc.id AS collection_id, pc.name AS collection_name, "+
				"pc.kind AS collection_kind",
		).
		Joins("JOIN xd_photo_collections AS pc ON pc.id = pca.collection_id").
		Where(
			"pc.owner_id = ? AND pc.state = ? AND pca.asset_id IN ?",
			ownerID, meta.PhotoCollectionStateActive, assetIDs,
		).
		Order("pc.id ASC").
		Scan(&collections).Error; err != nil {
		return out, err
	}
	type personRow struct {
		AssetID   uint64
		PersonKey string
		Name      string
	}
	var persons []personRow
	if err := s.DB.WithContext(ctx).
		Table("xd_photo_person_assets AS ppa").
		Select("ppa.asset_id, p.person_key, p.name").
		Joins("JOIN xd_photo_people AS p ON p.id = ppa.person_id").
		Where("p.owner_id = ? AND ppa.asset_id IN ?", ownerID, assetIDs).
		Order("p.person_key ASC").
		Scan(&persons).Error; err != nil {
		return out, err
	}
	collectionsByAsset := make(map[uint64][]mediaDuplicateOrganizeMembership)
	manualAlbums := make(map[uint64]struct{})
	for _, value := range collections {
		collectionsByAsset[value.AssetID] = append(
			collectionsByAsset[value.AssetID],
			mediaDuplicateOrganizeMembership{
				ID: value.CollectionID, Name: value.CollectionName,
				Kind: value.CollectionKind,
			},
		)
		if value.CollectionKind == meta.PhotoCollectionKindManual {
			manualAlbums[value.CollectionID] = struct{}{}
		}
	}
	peopleByAsset := make(map[uint64][]mediaDuplicateOrganizePerson)
	durablePeople := make(map[string]struct{})
	for _, value := range persons {
		peopleByAsset[value.AssetID] = append(
			peopleByAsset[value.AssetID],
			mediaDuplicateOrganizePerson{
				PersonKey: value.PersonKey, Name: value.Name,
			},
		)
		durablePeople[value.PersonKey] = struct{}{}
	}
	// SourceItem can point to the still, motion, RAW, or sidecar Node. Link the
	// *whole* PhotoAsset through its persisted Node resources so secondary
	// source identities cannot disappear from the preview.
	type sourceLinkRow struct {
		AssetID        uint64
		ResourceNodeID uint64
		SourceItemID   uint64
		SourceID       uint64
		SourceName     string
		SourceKind     string
		SourceStatus   string
		Direction      string
		SyncMode       string
		Path           string
		ItemState      string
	}
	var sourceRows []sourceLinkRow
	if err := s.DB.WithContext(ctx).
		Table("xd_photo_resources AS pr").
		Select("pr.asset_id, pr.node_id AS resource_node_id, "+
			"si.id AS source_item_id, si.path, si.state AS item_state, "+
			"src.id AS source_id, src.name AS source_name, "+
			"src.kind AS source_kind, src.status AS source_status, "+
			"src.direction, src.sync_mode").
		Joins("JOIN xd_source_items AS si ON si.node_id = pr.node_id").
		Joins("JOIN xd_sources AS src ON src.id = si.source_id").
		Where("pr.asset_id IN ? AND pr.resource_kind = ? AND src.owner_id = ?",
			assetIDs, meta.PhotoResourceKindNode, ownerID).
		Order("pr.asset_id ASC, si.id ASC, pr.node_id ASC").
		Limit(mediaDuplicateOrganizeMaxSourceLinks + 1).
		Scan(&sourceRows).Error; err != nil {
		return out, err
	}
	if len(sourceRows) > mediaDuplicateOrganizeMaxSourceLinks {
		// Unbounded provenance can never silently look like 'no source'.
		return out, gorm.ErrRecordNotFound
	}
	sourceLinksByAsset := make(map[uint64][]mediaDuplicateOrganizeSourceLink)
	seenSourceItems := make(map[uint64]map[uint64]struct{})
	for _, link := range sourceRows {
		seen := seenSourceItems[link.AssetID]
		if seen == nil {
			seen = make(map[uint64]struct{})
			seenSourceItems[link.AssetID] = seen
		}
		if _, exists := seen[link.SourceItemID]; exists {
			continue
		}
		seen[link.SourceItemID] = struct{}{}
		mayReimport := link.Direction == meta.SourceDirectionPull &&
			link.ItemState != meta.SourceItemStateMissing &&
			link.ItemState != meta.SourceItemStateIgnored
		sourceLinksByAsset[link.AssetID] = append(
			sourceLinksByAsset[link.AssetID],
			mediaDuplicateOrganizeSourceLink{
				SourceID: link.SourceID, SourceName: link.SourceName,
				SourceKind: link.SourceKind, SourceStatus: link.SourceStatus,
				Direction: link.Direction, SyncMode: link.SyncMode,
				SourceItemID:   link.SourceItemID,
				ResourceNodeID: link.ResourceNodeID, Path: link.Path,
				ItemState: link.ItemState, MayReimport: mayReimport,
			},
		)
	}
	var base duplicateAssetIdentity
	status := duplicateAssetIdentical
	reason := "完整资源和当前编辑配方已验证一致；仍须人工确认整理范围"
	descriptionVariants := make(map[string]struct{})
	tagVariants := make(map[string]struct{})
	peopleVariants := make(map[string]struct{})
	out.KeeperNodeID = keeperID
	out.Members = make([]mediaDuplicateOrganizeMember, 0, len(rows))
	out.NoMutation = true
	out.RequiresManualConfirmation = true
	out.PhysicalReclaimableBytes = 0
	out.SourceWarning = "仅展示数据库当前已经关联的同步文件夹来源；未显示来源不代表文件不受远端管理，也不证明删除安全。本操作保留所有原文件、来源和共享 Blob。"
	for index, row := range rows {
		recipe, hasRecipe := byRecipe[row.AssetID]
		verifiedMember := mediaDuplicateMemberRow{
			SHA256: row.SHA256, AssetID: row.AssetID,
			AssetKind: row.AssetKind, NodeID: row.NodeID,
			NodeRevision: row.NodeRevision,
		}
		identity, verified := duplicateAssetIdentityFor(
			verifiedMember, byResource[row.AssetID], recipe, hasRecipe,
		)
		if !verified {
			status = duplicateAssetUnverified
			reason = "存在未验证、缺失或索引已过期的完整资源／编辑配方"
		} else if index == 0 {
			base = identity
		} else if !reflect.DeepEqual(base, identity) && status == duplicateAssetIdentical {
			status = duplicateAssetDifferent
			reason = "至少两份素材的资源或编辑配方不一致"
		}
		tags, tagsValid := decodeMediaOrganizeList(row.TagsJSON)
		labels, labelsValid := decodeMediaOrganizeList(row.PeopleJSON)
		if !tagsValid || !labelsValid {
			status = duplicateAssetUnverified
			reason = "源资产存在无法可靠解析的标签或人物备注"
		}
		for _, value := range tags {
			tagVariants[value] = struct{}{}
		}
		for _, value := range labels {
			peopleVariants[value] = struct{}{}
		}
		if description := strings.TrimSpace(row.Description); description != "" {
			descriptionVariants[description] = struct{}{}
		}
		if row.Favorite {
			out.CombinedFavorites = true
		}
		// Preserve the actual source Node identities and named original
		// resources in the review result, not just the content fingerprint.
		resourceDetails := make([]mediaDuplicateOrganizeResource, 0, len(byResource[row.AssetID]))
		for _, res := range byResource[row.AssetID] {
			resourceDetails = append(resourceDetails, mediaDuplicateOrganizeResource{
				Kind: res.ResourceKind, Role: res.Role,
				NodeID: res.NodeID, Ordinal: res.Ordinal, Name: res.Name,
				MediaKind: res.MediaKind, MIMEType: res.MIMEType,
				Size: res.Size, SHA256: res.SHA256, ByteOffset: res.ByteOffset,
			})
		}
		sort.Slice(resourceDetails, func(i, j int) bool {
			if resourceDetails[i].Ordinal != resourceDetails[j].Ordinal {
				return resourceDetails[i].Ordinal < resourceDetails[j].Ordinal
			}
			if resourceDetails[i].Role != resourceDetails[j].Role {
				return resourceDetails[i].Role < resourceDetails[j].Role
			}
			return resourceDetails[i].NodeID < resourceDetails[j].NodeID
		})
		var editDetails *mediaEditRecipeDTO
		if hasRecipe {
			detail := toMediaEditRecipeDTO(recipe, row.AssetKind, verified)
			editDetails = &detail
		}
		links := sourceLinksByAsset[row.AssetID]
		if len(links) > 0 {
			out.SourceManagedAssets++
			for _, link := range links {
				if link.MayReimport {
					out.PotentialReimportAssets++
					break
				}
			}
		}
		out.Members = append(out.Members, mediaDuplicateOrganizeMember{
			NodeID: row.NodeID, AssetID: row.AssetID,
			AssetKind: row.AssetKind, NodeRevision: row.NodeRevision,
			SHA256: row.SHA256, Favorite: row.Favorite,
			Description: row.Description, Tags: tags, PeopleLabels: labels,
			Collections: collectionsByAsset[row.AssetID],
			People:      peopleByAsset[row.AssetID], Resources: resourceDetails,
			SourceLinks: links, EditRecipe: editDetails, HasEditRecipe: hasRecipe,
		})
	}
	if out.PotentialReimportAssets > 0 {
		out.SourceWarning = "当前关联的 Pull 同步文件夹中有可再次导入的来源记录；未来删除这些 Node 后再次同步可能恢复副本。来源相册及全部原文件保持独立，本次只保全标注，不执行删除。未关联的来源也不代表无远端副本。"
	}
	out.AssetComparison = status
	out.Reason = reason
	out.Descriptions = distinctMediaOrganizeStrings(descriptionVariants)
	out.CombinedTags = distinctMediaOrganizeStrings(tagVariants)
	out.CombinedPeopleLabels = distinctMediaOrganizeStrings(peopleVariants)
	out.ManualAlbumCount = len(manualAlbums)
	out.DurablePersonCount = len(durablePeople)
	out.ReadyForManualReview = status == duplicateAssetIdentical && len(out.Descriptions) <= 1
	if len(out.Descriptions) > 1 && status == duplicateAssetIdentical {
		out.Reason = "多份副本含不同描述，必须逐一保留或人工解决；不能静默覆盖"
	}
	if mediaDuplicateOrganizeKeeperMirrorManaged(out) {
		out.ReadyForManualReview = false
		if status == duplicateAssetIdentical {
			out.Reason = "拟保留副本的原始资源绑定 Mirror 同步文件夹；远端确认删除后此 Node 可能进入回收站，请先选择独立且不受 Mirror 管理的保留文件"
		}
		out.SourceWarning += " 警告：当前 keeper 自身绑定 Mirror 来源，可能在远端消失后的两次完整扫描与宽限期届满后被移入回收站；为避免集中标注随后不可见，本次不能向该 keeper 保全标注。"
	}
	// The confirmation token binds the keeper, selected original Nodes, resource
	// evidence, edits, user annotations and collection/person membership.
	// A concurrent change invalidates it instead of overwriting newer intent.
	snapshot, err := json.Marshal(out)
	if err != nil {
		return mediaDuplicateOrganizePlan{}, err
	}
	digest := sha256.Sum256(snapshot)
	out.PlanRevision = hex.EncodeToString(digest[:])
	return out, nil
}

func (s *Server) mediaDuplicateOrganizePlan(c *gin.Context) {
	raw := c.QueryArray("node_id")
	if len(raw) < 2 || len(raw) > mediaDuplicateOrganizePlanMaxMembers {
		fail(c, http.StatusBadRequest, "node_id must contain 2 to 32 items")
		return
	}
	keeper, err := strconv.ParseUint(strings.TrimSpace(c.Query("keeper_id")), 10, 64)
	if err != nil || keeper == 0 {
		fail(c, http.StatusBadRequest, "keeper_id must be a positive node ID")
		return
	}
	ids := make([]uint64, 0, len(raw))
	seen := make(map[uint64]struct{}, len(raw))
	for _, value := range raw {
		id, parseErr := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
		if parseErr != nil || id == 0 {
			fail(c, http.StatusBadRequest, "node_id must be a positive node ID")
			return
		}
		if _, exists := seen[id]; exists {
			fail(c, http.StatusBadRequest, "node_id values must be distinct")
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if _, included := seen[keeper]; !included {
		fail(c, http.StatusBadRequest, "keeper_id must be one of node_id values")
		return
	}
	plan, err := s.queryMediaDuplicateOrganizePlan(
		c.Request.Context(), userID(c), keeper, ids,
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "one or more media assets are unavailable")
		} else {
			fail(c, http.StatusInternalServerError, "duplicate organization plan failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, plan)
}
