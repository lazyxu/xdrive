package maintenance

import (
	"os"
	"path/filepath"
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
	if report.Metadata != 3 || report.Groups != 1 || report.GroupItems != 2 || report.DerivedResources != 2 || report.Thumbnails != 0 {
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

func TestVerifyMediaStateFindsStaleRelationEvidence(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()
	metadata[0].RelationEvidenceVersion = 0
	metadata[1].RelationJSON = "{broken"

	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"metadata_relation_evidence_stale",
		"metadata_relation_evidence_invalid",
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
			RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
			LivePhotoAssetIdentifier: "ABC",
		},
		{
			NodeID: 11, OwnerID: 1, NodeRevision: 3, SHA256: shaMotion,
			MediaKind: meta.MediaKindVideo, IndexState: meta.MediaIndexStateReady,
			RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
			LivePhotoAssetIdentifier: "ABC",
		},
		{
			NodeID: 12, OwnerID: 1, NodeRevision: 4, SHA256: shaLIVP,
			MediaKind: meta.MediaKindImage, MIMEType: mediapkg.LIVPMIMEType,
			ContainerKind:            mediapkg.ContainerKindLIVP,
			LivePhotoAssetIdentifier: "LIVP-1",
			RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
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

func TestVerifyThumbnailMetadataFindsBrokenFields(t *testing.T) {
	row := meta.MediaMetadata{
		NodeID: 1, OwnerID: 2,
		ThumbnailKey:      "../outside.jpg",
		ThumbnailMIMEType: "image/png",
		ThumbnailWidth:    0,
		ThumbnailHeight:   512,
	}
	var issues []MediaIntegrityIssue
	verifyThumbnailMetadata(row, func(issue MediaIntegrityIssue) {
		issues = append(issues, issue)
	})
	reasons := map[string]bool{}
	for _, issue := range issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"thumbnail_key_invalid",
		"thumbnail_mime_invalid",
		"thumbnail_dimensions_invalid",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue %q in %+v", want, issues)
		}
	}

	issues = nil
	row.ThumbnailKey = ""
	row.ThumbnailMIMEType = "image/jpeg"
	row.ThumbnailWidth = 512
	row.ThumbnailHeight = 384
	verifyThumbnailMetadata(row, func(issue MediaIntegrityIssue) {
		issues = append(issues, issue)
	})
	if len(issues) != 1 || issues[0].Reason != "thumbnail_metadata_without_key" {
		t.Fatalf("issues=%+v", issues)
	}
}

func TestVerifyThumbnailStorageChecksPresenceAndJPEGMagic(t *testing.T) {
	root := t.TempDir()
	key := ".xdrive-media/thumbnails/aa/test-512.jpg"
	row := meta.MediaMetadata{
		NodeID: 1, OwnerID: 2,
		ThumbnailKey:      key,
		ThumbnailMIMEType: "image/jpeg",
		ThumbnailWidth:    512,
		ThumbnailHeight:   384,
	}
	check := func() []MediaIntegrityIssue {
		var issues []MediaIntegrityIssue
		verifyThumbnailStorage(root, []meta.MediaMetadata{row}, func(issue MediaIntegrityIssue) {
			issues = append(issues, issue)
		})
		return issues
	}

	issues := check()
	if len(issues) != 1 || issues[0].Reason != "thumbnail_storage_missing" {
		t.Fatalf("missing thumbnail issues=%+v", issues)
	}

	full := filepath.Join(root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, nil, 0o640); err != nil {
		t.Fatal(err)
	}
	issues = check()
	if len(issues) != 1 || issues[0].Reason != "thumbnail_storage_empty" {
		t.Fatalf("empty thumbnail issues=%+v", issues)
	}

	if err := os.WriteFile(full, []byte("not-a-jpeg"), 0o640); err != nil {
		t.Fatal(err)
	}
	issues = check()
	if len(issues) != 1 || issues[0].Reason != "thumbnail_storage_format_invalid" {
		t.Fatalf("invalid thumbnail issues=%+v", issues)
	}

	if err := os.WriteFile(full, []byte{0xff, 0xd8, 0xff, 0xd9}, 0o640); err != nil {
		t.Fatal(err)
	}
	if issues = check(); len(issues) != 0 {
		t.Fatalf("valid thumbnail issues=%+v", issues)
	}
}

func TestVerifyMediaStateRejectsLegacyLivePhotoEvidenceKey(t *testing.T) {
	nodes, files, metadata, groups, items, resources := healthyMediaFixture()
	groups[0].EvidenceKey = "legacy-provider-pair:ABC"

	report := verifyMediaState(metadata, groups, items, resources, nodes, files)
	found := false
	for _, issue := range report.Issues {
		if issue.GroupID == groups[0].ID &&
			issue.Reason == "live_photo_evidence_key_invalid" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("legacy live photo evidence key was not rejected: %+v", report.Issues)
	}
}
