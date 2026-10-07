package maintenance

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type MediaIntegrityIssue struct {
	OwnerID      uint64 `json:"owner_id,omitempty"`
	NodeID       uint64 `json:"node_id,omitempty"`
	GroupID      uint64 `json:"group_id,omitempty"`
	AssetID      uint64 `json:"asset_id,omitempty"`
	PersonRowID  uint64 `json:"person_row_id,omitempty"`
	PersonID     string `json:"person_id,omitempty"`
	ClusterID    uint64 `json:"cluster_id,omitempty"`
	FaceID       uint64 `json:"face_id,omitempty"`
	CollectionID uint64 `json:"collection_id,omitempty"`
	Role         string `json:"role,omitempty"`
	StorageKey   string `json:"storage_key,omitempty"`
	Reason       string `json:"reason"`
	Expected     string `json:"expected,omitempty"`
	Actual       string `json:"actual,omitempty"`
}

type MediaVerifyReport struct {
	Metadata                 int                   `json:"metadata"`
	Groups                   int                   `json:"groups"`
	GroupItems               int                   `json:"group_items"`
	DerivedResources         int                   `json:"derived_resources"`
	Thumbnails               int                   `json:"thumbnails"`
	PhotoPeople              int                   `json:"photo_people"`
	PhotoPersonMemberships   int                   `json:"photo_person_memberships"`
	SmartAlbums              int                   `json:"smart_albums"`
	PhotoPersonClusters      int                   `json:"photo_person_clusters"`
	PhotoPersonClusterFaces  int                   `json:"photo_person_cluster_faces"`
	PhotoPersonClusterStates int                   `json:"photo_person_cluster_states"`
	Issues                   []MediaIntegrityIssue `json:"issues"`
}

func (r MediaVerifyReport) OK() bool { return len(r.Issues) == 0 }

// VerifyMedia checks connector-neutral media-index relationships only. It never
// reads provider APIs and never mutates metadata, groups, resources, or files.
func VerifyMedia(db *gorm.DB) (MediaVerifyReport, error) {
	return verifyMedia(db, "")
}

// VerifyMediaWithStorageRoot performs the same read-only relational checks as
// VerifyMedia and additionally validates referenced xDrive-generated thumbnail
// cache objects. It never creates, rewrites, or deletes storage entries.
func VerifyMediaWithStorageRoot(db *gorm.DB, storageRoot string) (MediaVerifyReport, error) {
	root, err := filepath.Abs(strings.TrimSpace(storageRoot))
	if err != nil {
		return MediaVerifyReport{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return MediaVerifyReport{}, fmt.Errorf("stat media storage root: %w", err)
	}
	if !info.IsDir() {
		return MediaVerifyReport{}, fmt.Errorf("media storage root is not a directory")
	}
	return verifyMedia(db, root)
}

func verifyMedia(db *gorm.DB, storageRoot string) (MediaVerifyReport, error) {
	var report MediaVerifyReport
	if db == nil {
		return report, fmt.Errorf("media verify database is unavailable")
	}

	var metadata []meta.MediaMetadata
	if err := db.Order("node_id ASC").Find(&metadata).Error; err != nil {
		return report, fmt.Errorf("query media metadata: %w", err)
	}
	var groups []meta.MediaGroup
	if err := db.Order("id ASC").Find(&groups).Error; err != nil {
		return report, fmt.Errorf("query media groups: %w", err)
	}
	var items []meta.MediaGroupItem
	if err := db.Order("group_id ASC, ordinal ASC, node_id ASC").Find(&items).Error; err != nil {
		return report, fmt.Errorf("query media group items: %w", err)
	}
	var resources []meta.MediaDerivedResource
	if err := db.Order("node_id ASC, role ASC").Find(&resources).Error; err != nil {
		return report, fmt.Errorf("query media derived resources: %w", err)
	}

	nodeIDs := make(map[uint64]struct{})
	for _, row := range metadata {
		nodeIDs[row.NodeID] = struct{}{}
	}
	for _, item := range items {
		nodeIDs[item.NodeID] = struct{}{}
	}
	for _, resource := range resources {
		nodeIDs[resource.NodeID] = struct{}{}
	}
	ids := make([]uint64, 0, len(nodeIDs))
	for id := range nodeIDs {
		if id != 0 {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	var nodes []meta.Node
	var files []meta.File
	if err := forSourceVerifyIDBatches(ids, func(batch []uint64) error {
		var batchNodes []meta.Node
		if err := db.Where("id IN ?", batch).Find(&batchNodes).Error; err != nil {
			return fmt.Errorf("query media nodes: %w", err)
		}
		nodes = append(nodes, batchNodes...)

		var batchFiles []meta.File
		if err := db.Where("node_id IN ?", batch).Find(&batchFiles).Error; err != nil {
			return fmt.Errorf("query media files: %w", err)
		}
		files = append(files, batchFiles...)
		return nil
	}); err != nil {
		return report, err
	}

	report = verifyMediaState(metadata, groups, items, resources, nodes, files)

	ctx := context.Background()
	if db.Statement != nil && db.Statement.Context != nil {
		ctx = db.Statement.Context
	}
	personStats, personIssues, err := verifyPhotoPersonIntegrity(ctx, db)
	if err != nil {
		return report, err
	}
	report.PhotoPeople = personStats.People
	report.PhotoPersonMemberships = personStats.Memberships
	report.SmartAlbums = personStats.SmartAlbums
	report.PhotoPersonClusters = personStats.PersonClusters
	report.PhotoPersonClusterFaces = personStats.PersonClusterFaces
	report.PhotoPersonClusterStates = personStats.PersonClusterStates
	report.Issues = append(report.Issues, personIssues...)

	ownerIDs := make(map[uint64]struct{})
	for _, row := range metadata {
		if row.OwnerID != 0 {
			ownerIDs[row.OwnerID] = struct{}{}
		}
	}
	for _, group := range groups {
		if group.OwnerID != 0 {
			ownerIDs[group.OwnerID] = struct{}{}
		}
	}
	orderedOwners := make([]uint64, 0, len(ownerIDs))
	for ownerID := range ownerIDs {
		orderedOwners = append(orderedOwners, ownerID)
	}
	sort.Slice(orderedOwners, func(i, j int) bool {
		return orderedOwners[i] < orderedOwners[j]
	})
	for _, ownerID := range orderedOwners {
		stale, staleErr := mediagroup.LocalEvidenceGroupsStale(ctx, db, ownerID)
		if staleErr != nil {
			return report, fmt.Errorf("verify local media relation projection for owner %d: %w", ownerID, staleErr)
		}
		if stale {
			report.Issues = append(report.Issues, MediaIntegrityIssue{
				OwnerID: ownerID,
				Reason:  "local_relation_projection_stale",
			})
		}
	}

	if storageRoot != "" {
		if err := verifyThumbnailStorage(
			ctx,
			storageRoot,
			metadata,
			func(issue MediaIntegrityIssue) {
				report.Issues = append(report.Issues, issue)
			},
		); err != nil {
			return report, err
		}
	}
	sortMediaIntegrityIssues(report.Issues)
	return report, nil
}

func verifyMediaState(
	metadata []meta.MediaMetadata,
	groups []meta.MediaGroup,
	items []meta.MediaGroupItem,
	resources []meta.MediaDerivedResource,
	nodes []meta.Node,
	files []meta.File,
) MediaVerifyReport {
	report := MediaVerifyReport{
		Metadata:         len(metadata),
		Groups:           len(groups),
		GroupItems:       len(items),
		DerivedResources: len(resources),
	}
	for _, row := range metadata {
		if strings.TrimSpace(row.ThumbnailKey) != "" {
			report.Thumbnails++
		}
	}
	add := func(issue MediaIntegrityIssue) {
		report.Issues = append(report.Issues, issue)
	}

	nodeByID := make(map[uint64]meta.Node, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	fileByNodeID := make(map[uint64]meta.File, len(files))
	for _, file := range files {
		fileByNodeID[file.NodeID] = file
	}
	metadataByNodeID := make(map[uint64]meta.MediaMetadata, len(metadata))
	for _, row := range metadata {
		metadataByNodeID[row.NodeID] = row
		verifyMediaMetadataRow(row, nodeByID, fileByNodeID, add)
		verifyThumbnailMetadata(row, add)
	}

	groupByID := make(map[uint64]meta.MediaGroup, len(groups))
	itemsByGroup := make(map[uint64][]meta.MediaGroupItem, len(groups))
	for _, group := range groups {
		groupByID[group.ID] = group
		if group.OwnerID == 0 {
			add(MediaIntegrityIssue{GroupID: group.ID, Reason: "group_owner_missing"})
		}
		if !meta.ValidMediaGroupKind(group.Kind) {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, GroupID: group.ID, Reason: "group_kind_invalid",
				Actual: group.Kind,
			})
		}
		if strings.TrimSpace(group.EvidenceKey) == "" {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, GroupID: group.ID, Reason: "group_evidence_missing",
			})
		}
	}
	for _, item := range items {
		itemsByGroup[item.GroupID] = append(itemsByGroup[item.GroupID], item)
		group, ok := groupByID[item.GroupID]
		if !ok {
			add(MediaIntegrityIssue{
				NodeID: item.NodeID, GroupID: item.GroupID, Role: item.Role,
				Reason: "group_item_group_missing",
			})
			continue
		}
		node, ok := nodeByID[item.NodeID]
		base := MediaIntegrityIssue{
			OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: item.GroupID, Role: item.Role,
		}
		if !ok {
			base.Reason = "group_item_node_missing"
			add(base)
			continue
		}
		if node.OwnerID != group.OwnerID {
			issue := base
			issue.Reason = "group_item_owner_mismatch"
			issue.Expected = strconv.FormatUint(group.OwnerID, 10)
			issue.Actual = strconv.FormatUint(node.OwnerID, 10)
			add(issue)
		}
		if node.DeletedAt != nil {
			issue := base
			issue.Reason = "group_item_node_deleted"
			add(issue)
		}
		if node.Type != meta.NodeTypeFile {
			issue := base
			issue.Reason = "group_item_node_type_mismatch"
			issue.Expected = meta.NodeTypeFile
			issue.Actual = node.Type
			add(issue)
		}
		if item.Ordinal < 0 {
			issue := base
			issue.Reason = "group_item_ordinal_invalid"
			issue.Actual = strconv.Itoa(item.Ordinal)
			add(issue)
		}
		if strings.TrimSpace(item.Role) == "" {
			issue := base
			issue.Reason = "group_item_role_missing"
			add(issue)
		}
	}

	for _, group := range groups {
		groupItems := itemsByGroup[group.ID]
		if len(groupItems) == 0 {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, GroupID: group.ID, Reason: "group_empty",
			})
			continue
		}
		if group.Kind == meta.MediaGroupKindLivePhoto {
			verifyLivePhotoGroup(group, groupItems, metadataByNodeID, add)
		}
	}

	resourcesByNodeID := make(map[uint64][]meta.MediaDerivedResource)
	for _, resource := range resources {
		resourcesByNodeID[resource.NodeID] = append(resourcesByNodeID[resource.NodeID], resource)
		verifyDerivedResource(resource, nodeByID, fileByNodeID, metadataByNodeID, add)
	}
	verifyLIVPContainers(metadata, resourcesByNodeID, add)

	sortMediaIntegrityIssues(report.Issues)
	return report
}

func sortMediaIntegrityIssues(issues []MediaIntegrityIssue) {
	sort.SliceStable(issues, func(i, j int) bool {
		a, b := issues[i], issues[j]
		if a.OwnerID != b.OwnerID {
			return a.OwnerID < b.OwnerID
		}
		if a.CollectionID != b.CollectionID {
			return a.CollectionID < b.CollectionID
		}
		if a.PersonRowID != b.PersonRowID {
			return a.PersonRowID < b.PersonRowID
		}
		if a.ClusterID != b.ClusterID {
			return a.ClusterID < b.ClusterID
		}
		if a.FaceID != b.FaceID {
			return a.FaceID < b.FaceID
		}
		if a.GroupID != b.GroupID {
			return a.GroupID < b.GroupID
		}
		if a.AssetID != b.AssetID {
			return a.AssetID < b.AssetID
		}
		if a.NodeID != b.NodeID {
			return a.NodeID < b.NodeID
		}
		if a.PersonID != b.PersonID {
			return a.PersonID < b.PersonID
		}
		if a.Role != b.Role {
			return a.Role < b.Role
		}
		return a.Reason < b.Reason
	})
}

func verifyMediaMetadataRow(
	row meta.MediaMetadata,
	nodes map[uint64]meta.Node,
	files map[uint64]meta.File,
	add func(MediaIntegrityIssue),
) {
	base := MediaIntegrityIssue{OwnerID: row.OwnerID, NodeID: row.NodeID}
	node, ok := nodes[row.NodeID]
	if !ok {
		base.Reason = "metadata_node_missing"
		add(base)
		return
	}
	if node.OwnerID != row.OwnerID {
		issue := base
		issue.Reason = "metadata_owner_mismatch"
		issue.Expected = strconv.FormatUint(node.OwnerID, 10)
		issue.Actual = strconv.FormatUint(row.OwnerID, 10)
		add(issue)
	}
	if node.DeletedAt != nil {
		issue := base
		issue.Reason = "metadata_node_deleted"
		add(issue)
	}
	if node.Type != meta.NodeTypeFile {
		issue := base
		issue.Reason = "metadata_node_type_mismatch"
		issue.Expected = meta.NodeTypeFile
		issue.Actual = node.Type
		add(issue)
		return
	}
	file, ok := files[row.NodeID]
	if !ok {
		issue := base
		issue.Reason = "metadata_file_missing"
		add(issue)
		return
	}
	if row.NodeRevision != node.Revision {
		issue := base
		issue.Reason = "metadata_revision_stale"
		issue.Expected = strconv.FormatUint(node.Revision, 10)
		issue.Actual = strconv.FormatUint(row.NodeRevision, 10)
		add(issue)
	}
	if !strings.EqualFold(strings.TrimSpace(row.SHA256), strings.TrimSpace(file.SHA256)) {
		issue := base
		issue.Reason = "metadata_sha_stale"
		issue.Expected = strings.ToLower(strings.TrimSpace(file.SHA256))
		issue.Actual = strings.ToLower(strings.TrimSpace(row.SHA256))
		add(issue)
	}
	if !meta.ValidMediaKind(row.MediaKind) {
		issue := base
		issue.Reason = "metadata_kind_invalid"
		issue.Actual = row.MediaKind
		add(issue)
	}
	if !meta.ValidMediaIndexState(row.IndexState) {
		issue := base
		issue.Reason = "metadata_index_state_invalid"
		issue.Actual = row.IndexState
		add(issue)
	}
	if row.RelationEvidenceVersion < mediapkg.RelationEvidenceVersion {
		issue := base
		issue.Reason = "metadata_relation_evidence_stale"
		issue.Expected = strconv.Itoa(mediapkg.RelationEvidenceVersion)
		issue.Actual = strconv.Itoa(row.RelationEvidenceVersion)
		add(issue)
	}
	if strings.TrimSpace(row.RelationJSON) != "" {
		if _, err := mediapkg.DecodeRelationEvidence(row.RelationJSON); err != nil {
			issue := base
			issue.Reason = "metadata_relation_evidence_invalid"
			add(issue)
		}
	}
}

func verifyLivePhotoGroup(
	group meta.MediaGroup,
	items []meta.MediaGroupItem,
	metadata map[uint64]meta.MediaMetadata,
	add func(MediaIntegrityIssue),
) {
	counts := map[string]int{}
	ordinals := map[int]struct{}{}
	expectedAssetIdentifier := ""
	if strings.HasPrefix(group.EvidenceKey, "apple-asset:") {
		expectedAssetIdentifier = strings.TrimSpace(strings.TrimPrefix(group.EvidenceKey, "apple-asset:"))
		if expectedAssetIdentifier == "" {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, GroupID: group.ID,
				Reason: "live_photo_evidence_identifier_missing",
			})
		}
	} else {
		add(MediaIntegrityIssue{
			OwnerID: group.OwnerID, GroupID: group.ID,
			Reason: "live_photo_evidence_key_invalid",
			Actual: group.EvidenceKey,
		})
	}
	for _, item := range items {
		counts[item.Role]++
		if _, duplicate := ordinals[item.Ordinal]; duplicate {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
				Reason: "live_photo_duplicate_ordinal", Actual: strconv.Itoa(item.Ordinal),
			})
		}
		ordinals[item.Ordinal] = struct{}{}

		row, ok := metadata[item.NodeID]
		if !ok {
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
				Reason: "live_photo_metadata_missing",
			})
			continue
		}
		switch item.Role {
		case meta.MediaGroupRoleStill:
			if row.MediaKind != meta.MediaKindImage {
				add(MediaIntegrityIssue{
					OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
					Reason: "live_photo_still_kind_mismatch", Expected: meta.MediaKindImage, Actual: row.MediaKind,
				})
			}
		case meta.MediaGroupRoleMotion:
			if row.MediaKind != meta.MediaKindVideo {
				add(MediaIntegrityIssue{
					OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
					Reason: "live_photo_motion_kind_mismatch", Expected: meta.MediaKindVideo, Actual: row.MediaKind,
				})
			}
		case meta.MediaGroupRoleContainer:
		default:
			add(MediaIntegrityIssue{
				OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
				Reason: "live_photo_role_invalid", Actual: item.Role,
			})
		}
		if expectedAssetIdentifier != "" &&
			(item.Role == meta.MediaGroupRoleStill || item.Role == meta.MediaGroupRoleMotion) {
			actual := strings.TrimSpace(row.LivePhotoAssetIdentifier)
			if actual != expectedAssetIdentifier {
				add(MediaIntegrityIssue{
					OwnerID: group.OwnerID, NodeID: item.NodeID, GroupID: group.ID, Role: item.Role,
					Reason:   "live_photo_asset_identifier_mismatch",
					Expected: expectedAssetIdentifier, Actual: actual,
				})
			}
		}
	}
	if counts[meta.MediaGroupRoleStill] != 1 {
		add(MediaIntegrityIssue{
			OwnerID: group.OwnerID, GroupID: group.ID, Reason: "live_photo_still_count_invalid",
			Expected: "1", Actual: strconv.Itoa(counts[meta.MediaGroupRoleStill]),
		})
	}
	if counts[meta.MediaGroupRoleMotion] != 1 {
		add(MediaIntegrityIssue{
			OwnerID: group.OwnerID, GroupID: group.ID, Reason: "live_photo_motion_count_invalid",
			Expected: "1", Actual: strconv.Itoa(counts[meta.MediaGroupRoleMotion]),
		})
	}
	if counts[meta.MediaGroupRoleContainer] > 1 {
		add(MediaIntegrityIssue{
			OwnerID: group.OwnerID, GroupID: group.ID, Reason: "live_photo_container_count_invalid",
			Expected: "0..1", Actual: strconv.Itoa(counts[meta.MediaGroupRoleContainer]),
		})
	}
}

func verifyDerivedResource(
	resource meta.MediaDerivedResource,
	nodes map[uint64]meta.Node,
	files map[uint64]meta.File,
	metadata map[uint64]meta.MediaMetadata,
	add func(MediaIntegrityIssue),
) {
	base := MediaIntegrityIssue{
		OwnerID: resource.OwnerID, NodeID: resource.NodeID, Role: resource.Role,
	}
	node, ok := nodes[resource.NodeID]
	if !ok {
		base.Reason = "derived_resource_node_missing"
		add(base)
		return
	}
	if node.OwnerID != resource.OwnerID {
		issue := base
		issue.Reason = "derived_resource_owner_mismatch"
		issue.Expected = strconv.FormatUint(node.OwnerID, 10)
		issue.Actual = strconv.FormatUint(resource.OwnerID, 10)
		add(issue)
	}
	if node.DeletedAt != nil {
		issue := base
		issue.Reason = "derived_resource_node_deleted"
		add(issue)
	}
	if node.Type != meta.NodeTypeFile {
		issue := base
		issue.Reason = "derived_resource_node_type_mismatch"
		issue.Expected = meta.NodeTypeFile
		issue.Actual = node.Type
		add(issue)
		return
	}
	file, ok := files[resource.NodeID]
	if !ok {
		issue := base
		issue.Reason = "derived_resource_file_missing"
		add(issue)
		return
	}
	if resource.NodeRevision != node.Revision {
		issue := base
		issue.Reason = "derived_resource_revision_stale"
		issue.Expected = strconv.FormatUint(node.Revision, 10)
		issue.Actual = strconv.FormatUint(resource.NodeRevision, 10)
		add(issue)
	}
	if !strings.EqualFold(strings.TrimSpace(resource.SHA256), strings.TrimSpace(file.SHA256)) {
		issue := base
		issue.Reason = "derived_resource_sha_stale"
		issue.Expected = strings.ToLower(strings.TrimSpace(file.SHA256))
		issue.Actual = strings.ToLower(strings.TrimSpace(resource.SHA256))
		add(issue)
	}
	if !meta.ValidMediaDerivedResourceRole(resource.Role) {
		issue := base
		issue.Reason = "derived_resource_role_invalid"
		issue.Actual = resource.Role
		add(issue)
	}
	if !meta.ValidMediaKind(resource.MediaKind) {
		issue := base
		issue.Reason = "derived_resource_kind_invalid"
		issue.Actual = resource.MediaKind
		add(issue)
	}
	switch resource.Role {
	case meta.MediaDerivedResourceRoleStill:
		if resource.MediaKind != meta.MediaKindImage {
			issue := base
			issue.Reason = "derived_resource_still_kind_mismatch"
			issue.Expected = meta.MediaKindImage
			issue.Actual = resource.MediaKind
			add(issue)
		}
	case meta.MediaDerivedResourceRoleMotion:
		if resource.MediaKind != meta.MediaKindVideo {
			issue := base
			issue.Reason = "derived_resource_motion_kind_mismatch"
			issue.Expected = meta.MediaKindVideo
			issue.Actual = resource.MediaKind
			add(issue)
		}
	}
	if parent, ok := metadata[resource.NodeID]; !ok {
		issue := base
		issue.Reason = "derived_resource_metadata_missing"
		add(issue)
	} else {
		if parent.ContainerKind != mediapkg.ContainerKindLIVP {
			issue := base
			issue.Reason = "derived_resource_parent_container_mismatch"
			issue.Expected = mediapkg.ContainerKindLIVP
			issue.Actual = parent.ContainerKind
			add(issue)
		}
		expected := strings.TrimSpace(parent.LivePhotoAssetIdentifier)
		actual := strings.TrimSpace(resource.AssetIdentifier)
		if expected == "" || actual != expected {
			issue := base
			issue.Reason = "derived_resource_asset_identifier_mismatch"
			issue.Expected = expected
			issue.Actual = actual
			add(issue)
		}
	}
	if resource.ByteOffset < 0 || resource.ByteSize <= 0 ||
		resource.ByteOffset > file.Size ||
		resource.ByteSize > file.Size-resource.ByteOffset {
		issue := base
		issue.Reason = "derived_resource_range_invalid"
		issue.Expected = fmt.Sprintf("0..%d", file.Size)
		issue.Actual = fmt.Sprintf("%d+%d", resource.ByteOffset, resource.ByteSize)
		add(issue)
	}
}

func verifyLIVPContainers(
	metadata []meta.MediaMetadata,
	resourcesByNodeID map[uint64][]meta.MediaDerivedResource,
	add func(MediaIntegrityIssue),
) {
	for _, row := range metadata {
		if row.ContainerKind != mediapkg.ContainerKindLIVP {
			continue
		}
		base := MediaIntegrityIssue{OwnerID: row.OwnerID, NodeID: row.NodeID}
		if row.MediaKind != meta.MediaKindImage {
			issue := base
			issue.Reason = "livp_parent_kind_mismatch"
			issue.Expected = meta.MediaKindImage
			issue.Actual = row.MediaKind
			add(issue)
		}
		if row.MIMEType != mediapkg.LIVPMIMEType {
			issue := base
			issue.Reason = "livp_parent_mime_mismatch"
			issue.Expected = mediapkg.LIVPMIMEType
			issue.Actual = row.MIMEType
			add(issue)
		}
		assetIdentifier := strings.TrimSpace(row.LivePhotoAssetIdentifier)
		if assetIdentifier == "" {
			issue := base
			issue.Reason = "livp_asset_identifier_missing"
			add(issue)
		}

		resources := resourcesByNodeID[row.NodeID]
		if len(resources) != 2 {
			issue := base
			issue.Reason = "livp_resource_count_invalid"
			issue.Expected = "2"
			issue.Actual = strconv.Itoa(len(resources))
			add(issue)
		}

		roleCounts := map[string]int{}
		for _, resource := range resources {
			roleCounts[resource.Role]++
			actualIdentifier := strings.TrimSpace(resource.AssetIdentifier)
			if assetIdentifier != "" && actualIdentifier != assetIdentifier {
				add(MediaIntegrityIssue{
					OwnerID: row.OwnerID, NodeID: row.NodeID, Role: resource.Role,
					Reason:   "livp_resource_asset_identifier_mismatch",
					Expected: assetIdentifier, Actual: actualIdentifier,
				})
			}
		}
		if roleCounts[meta.MediaDerivedResourceRoleStill] != 1 {
			issue := base
			issue.Reason = "livp_still_resource_count_invalid"
			issue.Expected = "1"
			issue.Actual = strconv.Itoa(roleCounts[meta.MediaDerivedResourceRoleStill])
			add(issue)
		}
		if roleCounts[meta.MediaDerivedResourceRoleMotion] != 1 {
			issue := base
			issue.Reason = "livp_motion_resource_count_invalid"
			issue.Expected = "1"
			issue.Actual = strconv.Itoa(roleCounts[meta.MediaDerivedResourceRoleMotion])
			add(issue)
		}
	}
}

const mediaThumbnailStoragePrefix = mediapkg.ThumbnailStoragePrefix

func verifyThumbnailMetadata(
	row meta.MediaMetadata,
	add func(MediaIntegrityIssue),
) {
	key := strings.TrimSpace(row.ThumbnailKey)
	base := MediaIntegrityIssue{OwnerID: row.OwnerID, NodeID: row.NodeID, StorageKey: key}
	if key == "" {
		if strings.TrimSpace(row.ThumbnailMIMEType) != "" ||
			row.ThumbnailWidth != 0 ||
			row.ThumbnailHeight != 0 {
			base.Reason = "thumbnail_metadata_without_key"
			add(base)
		}
		return
	}

	clean, err := cleanStorageKey(key)
	if err != nil || !strings.HasPrefix(clean, mediaThumbnailStoragePrefix) {
		issue := base
		issue.Reason = "thumbnail_key_invalid"
		issue.Expected = mediaThumbnailStoragePrefix + "..."
		issue.Actual = key
		add(issue)
	}
	if !strings.EqualFold(strings.TrimSpace(row.ThumbnailMIMEType), "image/jpeg") {
		issue := base
		issue.Reason = "thumbnail_mime_invalid"
		issue.Expected = "image/jpeg"
		issue.Actual = strings.TrimSpace(row.ThumbnailMIMEType)
		add(issue)
	}
	if row.ThumbnailWidth <= 0 || row.ThumbnailHeight <= 0 {
		issue := base
		issue.Reason = "thumbnail_dimensions_invalid"
		issue.Expected = "positive width and height"
		issue.Actual = fmt.Sprintf("%dx%d", row.ThumbnailWidth, row.ThumbnailHeight)
		add(issue)
	}
}

func verifyThumbnailStorage(
	ctx context.Context,
	root string,
	metadata []meta.MediaMetadata,
	add func(MediaIntegrityIssue),
) error {
	for _, row := range metadata {
		if err := ctx.Err(); err != nil {
			return err
		}
		rawKey := strings.TrimSpace(row.ThumbnailKey)
		if rawKey == "" {
			continue
		}
		key, err := cleanStorageKey(rawKey)
		if err != nil || !strings.HasPrefix(key, mediaThumbnailStoragePrefix) {
			continue
		}
		base := MediaIntegrityIssue{
			OwnerID: row.OwnerID, NodeID: row.NodeID, StorageKey: key,
		}
		full := filepath.Join(root, filepath.FromSlash(key))
		info, statErr := os.Lstat(full)
		if statErr != nil {
			issue := base
			if os.IsNotExist(statErr) {
				issue.Reason = "thumbnail_storage_missing"
			} else {
				issue.Reason = "thumbnail_storage_unreadable"
				issue.Actual = statErr.Error()
			}
			add(issue)
			continue
		}
		if !info.Mode().IsRegular() {
			issue := base
			issue.Reason = "thumbnail_storage_not_regular"
			issue.Actual = info.Mode().String()
			add(issue)
			continue
		}
		if info.Size() <= 0 {
			issue := base
			issue.Reason = "thumbnail_storage_empty"
			issue.Actual = strconv.FormatInt(info.Size(), 10)
			add(issue)
			continue
		}

		file, openErr := os.Open(full)
		if openErr != nil {
			issue := base
			issue.Reason = "thumbnail_storage_unreadable"
			issue.Actual = openErr.Error()
			add(issue)
			continue
		}
		var header [3]byte
		_, readErr := io.ReadFull(file, header[:])
		closeErr := file.Close()
		if readErr != nil {
			issue := base
			issue.Reason = "thumbnail_storage_unreadable"
			issue.Actual = readErr.Error()
			add(issue)
			continue
		}
		if closeErr != nil {
			issue := base
			issue.Reason = "thumbnail_storage_unreadable"
			issue.Actual = closeErr.Error()
			add(issue)
			continue
		}
		if header != [3]byte{0xff, 0xd8, 0xff} {
			issue := base
			issue.Reason = "thumbnail_storage_format_invalid"
			issue.Expected = "jpeg"
			issue.Actual = fmt.Sprintf("%02x%02x%02x", header[0], header[1], header[2])
			add(issue)
		}
	}
	return nil
}
