package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLegacyLIVPMetadataRequiresRefresh(t *testing.T) {
	node := meta.Node{Name: "photo.LIVP", Type: meta.NodeTypeFile, Revision: 3}
	legacy := meta.MediaMetadata{NodeID: 1, NodeRevision: 3, SHA256: "abc"}
	if !legacyLIVPMetadata(node, legacy) {
		t.Fatal("legacy livp metadata was not marked stale")
	}

	current := legacy
	current.ContainerKind = "livp"
	current.DerivedResourceVersion = 1
	if legacyLIVPMetadata(node, current) {
		t.Fatal("current livp metadata was marked stale")
	}

	if legacyLIVPMetadata(meta.Node{Name: "photo.jpg", Type: meta.NodeTypeFile}, legacy) {
		t.Fatal("ordinary image metadata was marked as legacy livp")
	}
}
