package maintenance

import (
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestVerifyMediaStateHealthy(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()
	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	if !report.OK() {
		t.Fatalf("unexpected issues: %+v", report.Issues)
	}
	if report.Metadata != 3 || report.Groups != 1 || report.GroupItems != 2 || report.DerivedResources != 2 {
		t.Fatalf("report=%+v", report)
	}
}

func TestVerifyMediaStateFindsStaleAndBrokenRelationships(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()

	metadata[0].OwnerID = 99
	metadata[0].NodeRevision = 1
	metadata[0].SHA256 = strings.Repeat("f", 64)
	metadata[1].MediaKind = meta.MediaKindImage

	groups[0].EvidenceKey = ""
	items = append(items, meta.MediaGroupItem{
		GroupID: groups[0].ID, NodeID: nodes[0].ID,
		Role: meta.MediaGroupRoleStill, Ordinal: 2,
	})

	resources[0].ByteOffset = 490
	resources[0].ByteSize = 20

	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"metadata_owner_mismatch",
		"metadata_revision_stale",
		"metadata_sha_stale",
		"live_photo_motion_kind_mismatch",
		"group_evidence_missing",
		"live_photo_still_count_invalid",
		"derived_resource_range_invalid",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue %q in %+v", want, report.Issues)
		}
	}
}

func TestVerifyMediaStateDetectsDeletedAndMissingNodes(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()
	now := time.Now().UTC()
	nodes[0].DeletedAt = &now
	items[1].NodeID = 999
	resources[0].NodeID = 998

	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"metadata_node_deleted",
		"group_item_node_missing",
		"derived_resource_node_missing",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue %q in %+v", want, report.Issues)
		}
	}
}

func healthyMediaFixture() (
	[]meta.Node,
	[]meta.File,
	[]meta.MediaMetadata,
	[]meta.MediaGroup,
	[]meta.MediaGroupItem,
	[]meta.MediaDerivedResource,
) {
	shaStill := strings.Repeat("a", 64)
	shaMotion := strings.Repeat("b", 64)
	shaLIVP := strings.Repeat("c", 64)
	nodes := []meta.Node{
		{ID: 10, OwnerID: 1, Type: meta.NodeTypeFile, Revision: 2},
		{ID: 11, OwnerID: 1, Type: meta.NodeTypeFile, Revision: 3},
		{ID: 12, OwnerID: 1, Type: meta.NodeTypeFile, Revision: 4},
	}
	files := []meta.File{
		{NodeID: 10, Size: 100, SHA256: shaStill},
		{NodeID: 11, Size: 200, SHA256: shaMotion},
		{NodeID: 12, Size: 500, SHA256: shaLIVP},
	}
	metadata := []meta.MediaMetadata{
		{
			NodeID: 10, OwnerID: 1, NodeRevision: 2, SHA256: shaStill,
			MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
			LivePhotoAssetIdentifier: "ABC",
		},
		{
			NodeID: 11, OwnerID: 1, NodeRevision: 3, SHA256: shaMotion,
			MediaKind: meta.MediaKindVideo, IndexState: meta.MediaIndexStateReady,
			LivePhotoAssetIdentifier: "ABC",
		},
		{
			NodeID: 12, OwnerID: 1, NodeRevision: 4, SHA256: shaLIVP,
			MediaKind: meta.MediaKindImage, MIMEType: mediapkg.LIVPMIMEType,
			ContainerKind:            mediapkg.ContainerKindLIVP,
			LivePhotoAssetIdentifier: "LIVP-1",
			IndexState:               meta.MediaIndexStateReady,
		},
	}
	groups := []meta.MediaGroup{
		{ID: 7, OwnerID: 1, Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "apple-asset:ABC"},
	}
	items := []meta.MediaGroupItem{
		{GroupID: 7, NodeID: 10, Role: meta.MediaGroupRoleStill, Ordinal: 0},
		{GroupID: 7, NodeID: 11, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
	}
	resources := []meta.MediaDerivedResource{
		{
			NodeID: 12, OwnerID: 1, NodeRevision: 4, SHA256: shaLIVP,
			Role: meta.MediaDerivedResourceRoleStill, MediaKind: meta.MediaKindImage,
			ByteOffset: 10, ByteSize: 50, AssetIdentifier: "LIVP-1",
		},
		{
			NodeID: 12, OwnerID: 1, NodeRevision: 4, SHA256: shaLIVP,
			Role: meta.MediaDerivedResourceRoleMotion, MediaKind: meta.MediaKindVideo,
			ByteOffset: 100, ByteSize: 300, AssetIdentifier: "LIVP-1",
		},
	}
	return nodes, files, metadata, groups, items, resources
}

func TestVerifyMediaStateFindsEvidenceAndLIVPResourceMismatch(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()
	metadata[0].LivePhotoAssetIdentifier = "WRONG"
	resources[0].AssetIdentifier = "WRONG-LIVP"
	resources[1].MediaKind = meta.MediaKindImage

	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"live_photo_asset_identifier_mismatch",
		"derived_resource_asset_identifier_mismatch",
		"derived_resource_motion_kind_mismatch",
		"livp_resource_asset_identifier_mismatch",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue %q in %+v", want, report.Issues)
		}
	}
}
