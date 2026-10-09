package api

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestClassifyDuplicateAssetGroupIsFailClosed(t *testing.T) {
	sha := strings.Repeat("a", 64)
	motion := strings.Repeat("b", 64)
	members := []mediaDuplicateMemberRow{
		{AssetID: 10, AssetKind: meta.PhotoAssetKindImage, NodeID: 100, NodeRevision: 2, SHA256: sha},
		{AssetID: 20, AssetKind: meta.PhotoAssetKindImage, NodeID: 200, NodeRevision: 7, SHA256: sha},
	}
	resources := map[uint64][]meta.PhotoResource{
		10: {{AssetID: 10, NodeID: 100, ResourceKind: meta.PhotoResourceKindNode, Role: meta.PhotoResourceRolePrimary, MediaKind: meta.MediaKindImage, SHA256: sha, Size: 10}},
		20: {{AssetID: 20, NodeID: 200, ResourceKind: meta.PhotoResourceKindNode, Role: meta.PhotoResourceRolePrimary, MediaKind: meta.MediaKindImage, SHA256: sha, Size: 10}},
	}
	assertState := func(want string) {
		t.Helper()
		if got, reason := classifyDuplicateAssetGroup(members, resources, nil); got != want || reason == "" {
			t.Fatalf("comparison=%s reason=%q want=%s", got, reason, want)
		}
	}
	assertState(duplicateAssetIdentical) // same bytes across different nodes/revisions

	resources[20] = append(resources[20], meta.PhotoResource{
		AssetID: 20, NodeID: 201, ResourceKind: meta.PhotoResourceKindNode,
		Role: meta.MediaGroupRoleMotion, MediaKind: meta.MediaKindVideo, SHA256: motion, Size: 20,
	})
	assertState(duplicateAssetUnverified) // malformed image with additional motion
	resources[20] = resources[20][:1]

	members[1].AssetKind = meta.PhotoAssetKindLivePhoto
	assertState(duplicateAssetUnverified) // Live Photo lacking required still and motion
	members[1].AssetKind = meta.PhotoAssetKindImage

	resources[20][0].SHA256 = ""
	assertState(duplicateAssetUnverified) // incomplete projection never becomes equal
	resources[20][0].SHA256 = sha

	edit := meta.PhotoEditRecipe{
		AssetID: 20, SourceNodeID: 200, SourceNodeRevision: 7,
		SourceSHA256: sha, CropWidth: 0.8, CropHeight: 1,
	}
	if state, _ := classifyDuplicateAssetGroup(members, resources, map[uint64]meta.PhotoEditRecipe{20: edit}); state != duplicateAssetDifferent {
		t.Fatalf("different edit must not be merged: %s", state)
	}
	sameEdit := edit
	sameEdit.AssetID, sameEdit.SourceNodeID, sameEdit.SourceNodeRevision = 10, 100, 2
	recipes := map[uint64]meta.PhotoEditRecipe{10: sameEdit, 20: edit}
	if state, _ := classifyDuplicateAssetGroup(members, resources, recipes); state != duplicateAssetIdentical {
		t.Fatalf("equivalent transforms on different nodes must match: %s", state)
	}
	edit.SourceNodeRevision = 6 // stale edited source must fail closed
	recipes[20] = edit
	if state, _ := classifyDuplicateAssetGroup(members, resources, recipes); state != duplicateAssetUnverified {
		t.Fatalf("stale edit must be unverified: %s", state)
	}
}

func TestClassifyDuplicateLiveAndRAWDifferentResources(t *testing.T) {
	sha := strings.Repeat("c", 64)
	motionA := strings.Repeat("d", 64)
	motionB := strings.Repeat("e", 64)
	members := []mediaDuplicateMemberRow{
		{AssetID: 1, AssetKind: meta.PhotoAssetKindLivePhoto, NodeID: 1, SHA256: sha, NodeRevision: 1},
		{AssetID: 2, AssetKind: meta.PhotoAssetKindLivePhoto, NodeID: 2, SHA256: sha, NodeRevision: 1},
	}
	resources := map[uint64][]meta.PhotoResource{}
	for i := uint64(1); i <= 2; i++ {
		resources[i] = []meta.PhotoResource{
			{AssetID: i, NodeID: i, ResourceKind: meta.PhotoResourceKindNode, Role: meta.MediaGroupRoleStill, MediaKind: meta.MediaKindImage, SHA256: sha, Size: 10},
			{AssetID: i, NodeID: i + 10, ResourceKind: meta.PhotoResourceKindNode, Role: meta.MediaGroupRoleMotion, MediaKind: meta.MediaKindVideo, SHA256: motionA, Size: 20, Ordinal: 1},
		}
	}
	if state, _ := classifyDuplicateAssetGroup(members, resources, nil); state != duplicateAssetIdentical {
		t.Fatalf("equal Live resources=%s", state)
	}
	resources[2][1].SHA256 = motionB
	if state, _ := classifyDuplicateAssetGroup(members, resources, nil); state != duplicateAssetDifferent {
		t.Fatalf("different Live motion=%s", state)
	}
	for i := range members {
		members[i].AssetKind = meta.PhotoAssetKindRAWPair
		resources[members[i].AssetID][0].Role = meta.MediaGroupRoleRendered
		resources[members[i].AssetID][1].Role = meta.MediaGroupRoleRAW
		resources[members[i].AssetID][1].MediaKind = meta.MediaKindImage
	}
	if state, _ := classifyDuplicateAssetGroup(members, resources, nil); state != duplicateAssetDifferent {
		t.Fatalf("different RAW original=%s", state)
	}
}

func TestDuplicateIncompleteCompositeResourcesFailClosed(t *testing.T) {
	sha := strings.Repeat("f", 64)
	for _, kind := range []string{meta.PhotoAssetKindLivePhoto, meta.PhotoAssetKindRAWPair} {
		primaryRole := meta.MediaGroupRoleStill
		if kind == meta.PhotoAssetKindRAWPair {
			primaryRole = meta.MediaGroupRoleRendered
		}
		members := []mediaDuplicateMemberRow{
			{AssetID: 1, AssetKind: kind, NodeID: 10, SHA256: sha},
			{AssetID: 2, AssetKind: kind, NodeID: 20, SHA256: sha},
		}
		resources := map[uint64][]meta.PhotoResource{
			1: {{AssetID: 1, NodeID: 10, Role: primaryRole, ResourceKind: meta.PhotoResourceKindNode, SHA256: sha, MediaKind: meta.MediaKindImage}},
			2: {{AssetID: 2, NodeID: 20, Role: primaryRole, ResourceKind: meta.PhotoResourceKindNode, SHA256: sha, MediaKind: meta.MediaKindImage}},
		}
		state, _ := classifyDuplicateAssetGroup(members, resources, nil)
		if state != duplicateAssetUnverified {
			t.Errorf("incomplete %s asset classified %s", kind, state)
		}
	}
}
