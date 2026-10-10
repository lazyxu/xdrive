package transfer

import (
	"encoding/json"
	"testing"
)

func TestTransferCloudLocationSnapshotAndJSON(t *testing.T) {
	m := NewManager(5)
	parent := m.Start(Spec{
		FileName:      "local-photo.jpg",
		Path:          "/my/local/photo.jpg",
		Kind:          KindUpload,
		Direction:     "upload",
		CloudParentID: 42,
	})
	if parent == nil {
		t.Fatal("no transfer handle")
	}
	_, items := m.Snapshot()
	if len(items) != 1 || items[0].CloudParentID != 42 || items[0].CloudNodeID != 0 {
		t.Fatalf("upload cloud location must be a numeric cloud parent, got %+v", items)
	}
	encoded, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["cloud_parent_id"] != float64(42) {
		t.Fatalf("upload parent id not in IPC JSON: %s", encoded)
	}
	if _, ok := decoded["cloud_node_id"]; ok {
		t.Fatalf("unknown node id should be omitted: %s", encoded)
	}

	node := m.Start(Spec{
		FileName:    "movie.mov",
		Kind:        KindDownload,
		Direction:   "download",
		CloudNodeID: 73,
	})
	if node == nil {
		t.Fatal("no download transfer handle")
	}
	_, items = m.Snapshot()
	found := false
	for _, item := range items {
		if item.ID == node.ID() {
			found = item.CloudNodeID == 73 && item.CloudParentID == 0
		}
	}
	if !found {
		t.Fatalf("download node ID missing in transfer snapshot: %+v", items)
	}
}
