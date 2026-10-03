package photoasset

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestDesiredFromGroupAllowsAuxiliaryNodeWithoutMediaMetadata(t *testing.T) {
	primary := meta.Node{
		ID: 1, Name: "photo.jpg", Type: meta.NodeTypeFile, OwnerID: 7,
		File: &meta.File{NodeID: 1, Size: 10, SHA256: "primary"},
	}
	sidecar := meta.Node{
		ID: 2, Name: "photo.xmp", Type: meta.NodeTypeFile, OwnerID: 7,
		File: &meta.File{NodeID: 2, Size: 5, SHA256: "sidecar"},
	}
	group := meta.MediaGroup{ID: 9, Kind: meta.MediaGroupKindSidecar}
	items := []meta.MediaGroupItem{
		{GroupID: group.ID, NodeID: primary.ID, Role: meta.MediaGroupRolePrimary, Ordinal: 0},
		{GroupID: group.ID, NodeID: sidecar.ID, Role: meta.MediaGroupRoleSidecar, Ordinal: 1},
	}
	asset, ok := desiredFromGroup(
		group,
		items,
		map[uint64]meta.Node{1: primary, 2: sidecar},
		map[uint64]meta.MediaMetadata{
			1: {NodeID: 1, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg"},
		},
		map[uint64]int{1: 1, 2: 1},
	)
	if !ok {
		t.Fatal("sidecar group with locally preserved auxiliary node was rejected")
	}
	if asset.primaryID != primary.ID || len(asset.resources) != 2 {
		t.Fatalf("asset=%+v", asset)
	}
	if asset.resources[1].role != meta.MediaGroupRoleSidecar ||
		asset.resources[1].mediaKind != meta.MediaKindOther {
		t.Fatalf("sidecar resource=%+v", asset.resources[1])
	}
}

func TestDesiredFromGroupRejectsLivePhotoWithoutMotionMetadata(t *testing.T) {
	still := meta.Node{
		ID: 1, Name: "IMG.HEIC", Type: meta.NodeTypeFile, OwnerID: 7,
		File: &meta.File{NodeID: 1, Size: 10},
	}
	motion := meta.Node{
		ID: 2, Name: "IMG.MOV", Type: meta.NodeTypeFile, OwnerID: 7,
		File: &meta.File{NodeID: 2, Size: 20},
	}
	group := meta.MediaGroup{ID: 10, Kind: meta.MediaGroupKindLivePhoto}
	_, ok := desiredFromGroup(
		group,
		[]meta.MediaGroupItem{
			{GroupID: group.ID, NodeID: still.ID, Role: meta.MediaGroupRoleStill, Ordinal: 0},
			{GroupID: group.ID, NodeID: motion.ID, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
		},
		map[uint64]meta.Node{1: still, 2: motion},
		map[uint64]meta.MediaMetadata{
			1: {NodeID: 1, MediaKind: meta.MediaKindImage, MIMEType: "image/heic"},
		},
		map[uint64]int{1: 1, 2: 1},
	)
	if ok {
		t.Fatal("live photo without validated motion metadata was accepted")
	}
}
