package photoasset

import (
	"encoding/json"
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPhotoContentProjectionSeparatesIdentityAndOccurrences(t *testing.T) {
	sha := strings.Repeat("a", 64)
	nodes := map[uint64]meta.Node{}
	metadata := map[uint64]meta.MediaMetadata{}
	var desired []desiredAsset
	for _, id := range []uint64{10, 20} {
		nodes[id] = meta.Node{ID: id, OwnerID: 1, Revision: id, File: &meta.File{NodeID: id, SHA256: sha, Size: 100}}
		metadata[id] = meta.MediaMetadata{NodeID: id, OwnerID: 1, NodeRevision: id, SHA256: sha, IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage}
		desired = append(desired, desiredAsset{kind: meta.PhotoAssetKindImage, primaryID: id, metadata: metadata[id], resources: []desiredResource{{kind: meta.PhotoResourceKindNode, nodeID: id, sha256: sha, size: 100, role: "primary", mediaKind: meta.MediaKindImage}}})
	}
	grouped, err := groupDesiredContent(desired, nodes, metadata)
	if err != nil || len(grouped) != 1 || grouped[0].identity.Key != "sha256:"+sha || len(grouped[0].origins) != 2 {
		t.Fatalf("same content did not preserve both file occurrences: %+v %v", grouped, err)
	}
	// A newly indexed different original must acquire a different identity.
	changedSHA := strings.Repeat("b", 64)
	nodes[20].File.SHA256 = changedSHA
	newMetadata := metadata[20]
	newMetadata.SHA256 = changedSHA
	metadata[20] = newMetadata
	desired[1].resources[0].sha256 = changedSHA
	grouped, err = groupDesiredContent(desired, nodes, metadata)
	if err != nil || len(grouped) != 2 || grouped[0].identity.Key == grouped[1].identity.Key {
		t.Fatalf("replacement inherited old content identity: %+v %v", grouped, err)
	}
	// A stale index cannot establish a hash identity just because the Node is
	// still present. Preserve its legacy row without merging its annotations.
	metadata[20] = metadata[10]
	grouped, err = groupDesiredContent(desired, nodes, metadata)
	if err != nil || len(grouped) != 2 || grouped[1].identity.Key != "" {
		t.Fatalf("stale metadata acquired content identity: %+v %v", grouped, err)
	}
}

func TestPhotoContentProjectionUsesFullContainerMembers(t *testing.T) {
	parentSHA, stillSHA, motionSHA := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)
	descriptor := mediapkg.LIVPContainerDescriptor{
		Still:  mediapkg.LIVPContainerResourceDescriptor{Name: "still.jpg", Offset: 50, Size: 100, SHA256: stillSHA, MIMEType: "image/jpeg"},
		Motion: mediapkg.LIVPContainerResourceDescriptor{Name: "motion.mov", Offset: 200, Size: 300, SHA256: motionSHA, MIMEType: "video/quicktime"},
	}
	raw, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	node := meta.Node{ID: 1, OwnerID: 2, Revision: 3, File: &meta.File{NodeID: 1, SHA256: parentSHA, Size: 600}}
	row := meta.MediaMetadata{NodeID: 1, OwnerID: 2, NodeRevision: 3, SHA256: parentSHA, MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
		ContainerKind: mediapkg.ContainerKindLIVP, ContainerJSON: string(raw), DerivedResourceVersion: mediapkg.LIVPDerivedResourceVersion}
	asset := desiredAsset{kind: meta.PhotoAssetKindLivePhoto, primaryID: 1, metadata: row, resources: []desiredResource{
		{kind: meta.PhotoResourceKindNode, nodeID: 1, sha256: parentSHA, size: 600, role: "container"},
		{kind: meta.PhotoResourceKindDerived, nodeID: 1, sha256: stillSHA, size: 100, role: "still", byteOffset: 50},
		{kind: meta.PhotoResourceKindDerived, nodeID: 1, sha256: motionSHA, size: 300, role: "motion", byteOffset: 200},
	}}
	want, err := IdentifyOriginals(meta.PhotoAssetKindLivePhoto, []OriginalResource{{Role: "still", SHA256: stillSHA, Size: 100}, {Role: "motion", SHA256: motionSHA, Size: 300}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := desiredContentIdentity(asset, map[uint64]meta.Node{1: node}, map[uint64]meta.MediaMetadata{1: row})
	if err != nil || got != want {
		t.Fatalf("parent archive hash used as original identity: %+v %v", got, err)
	}
	for _, scenario := range []string{"old descriptor", "stale parent", "changed range", "missing member"} {
		t.Run(scenario, func(t *testing.T) {
			changed, changedRow := asset, row
			changed.resources = append([]desiredResource(nil), asset.resources...)
			switch scenario {
			case "old descriptor":
				changedRow.DerivedResourceVersion--
			case "stale parent":
				changedRow.SHA256 = stillSHA
			case "changed range":
				changed.resources[1].byteOffset++
			case "missing member":
				changed.resources = changed.resources[:2]
			}
			if _, err := desiredContentIdentity(changed, map[uint64]meta.Node{1: node}, map[uint64]meta.MediaMetadata{1: changedRow}); err == nil {
				t.Fatal("unverified container acquired content identity")
			}
		})
	}
}
