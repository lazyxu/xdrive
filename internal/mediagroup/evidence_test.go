package mediagroup

import (
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestBuildRelationSnapshotsComposesRAWPairAndExplicitXMPSidecar(t *testing.T) {
	candidates := []relationCandidate{
		{
			NodeID: 1, Name: "capture.dng",
			MediaKind: meta.MediaKindImage, MIMEType: "image/x-adobe-dng",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{ImageUniqueID: "capture-id"},
		},
		{
			NodeID: 2, Name: "rendered.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence: mediapkg.RelationEvidence{
				ImageUniqueID: "capture-id",
				XMPDocumentID: "xmp.did:rendered",
			},
		},
		{
			NodeID: 3, Name: "edit.xmp",
			MediaKind:  meta.MediaKindOther,
			IndexState: meta.MediaIndexStateUnsupported,
			Evidence: mediapkg.RelationEvidence{
				XMPDerivedFromDocumentID: "xmp.did:rendered",
			},
		},
	}
	got := buildRelationSnapshots(candidates, nil)
	if len(got) != 1 {
		t.Fatalf("relations=%+v", got)
	}
	relation := got[0]
	if relation.Kind != meta.MediaGroupKindRAWPair ||
		len(relation.Members) != 3 {
		t.Fatalf("relation=%+v", relation)
	}
	if relation.Members[0].NodeID != 2 ||
		relation.Members[0].Role != meta.MediaGroupRoleRendered ||
		relation.Members[1].NodeID != 1 ||
		relation.Members[1].Role != meta.MediaGroupRoleRAW ||
		relation.Members[2].NodeID != 3 ||
		relation.Members[2].Role != meta.MediaGroupRoleSidecar {
		t.Fatalf("members=%+v", relation.Members)
	}
}

func TestBuildRelationSnapshotsProjectsAppleBurst(t *testing.T) {
	candidates := []relationCandidate{
		{
			NodeID: 10, Name: "one.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{AppleBurstUUID: "burst-1"},
		},
		{
			NodeID: 11, Name: "two.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{AppleBurstUUID: "burst-1"},
		},
	}
	got := buildRelationSnapshots(candidates, nil)
	if len(got) != 1 || got[0].Kind != meta.MediaGroupKindBurst {
		t.Fatalf("relations=%+v", got)
	}
	if len(got[0].Members) != 2 ||
		got[0].Members[0].Role != meta.MediaGroupRolePrimary ||
		got[0].Members[1].Role != meta.MediaGroupRoleAuxiliary {
		t.Fatalf("members=%+v", got[0].Members)
	}
}

func TestBuildRelationSnapshotsSkipsBurstOverlappingLivePhoto(t *testing.T) {
	candidates := []relationCandidate{
		{
			NodeID: 10, Name: "one.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{AppleBurstUUID: "burst-1"},
		},
		{
			NodeID: 11, Name: "two.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{AppleBurstUUID: "burst-1"},
		},
	}
	got := buildRelationSnapshots(candidates, map[uint64]struct{}{10: {}})
	if len(got) != 0 {
		t.Fatalf("overlapping burst projected: %+v", got)
	}
}

func TestBuildRelationSnapshotsRejectsAmbiguousXMPDerivedFrom(t *testing.T) {
	candidates := []relationCandidate{
		{
			NodeID: 1, Name: "a.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{XMPDocumentID: "same-doc"},
		},
		{
			NodeID: 2, Name: "b.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
			Evidence:   mediapkg.RelationEvidence{XMPDocumentID: "same-doc"},
		},
		{
			NodeID: 3, Name: "edit.xmp",
			MediaKind:  meta.MediaKindOther,
			IndexState: meta.MediaIndexStateUnsupported,
			Evidence:   mediapkg.RelationEvidence{XMPDerivedFromDocumentID: "same-doc"},
		},
	}
	got := buildRelationSnapshots(candidates, nil)
	if len(got) != 0 {
		t.Fatalf("ambiguous sidecar projected: %+v", got)
	}
}

func TestBuildRelationSnapshotsDoesNotPairByNameOrTime(t *testing.T) {
	candidates := []relationCandidate{
		{
			NodeID: 1, Name: "IMG_0001.dng",
			MediaKind: meta.MediaKindImage, MIMEType: "image/x-adobe-dng",
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: 2, Name: "IMG_0001.jpg",
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
		},
	}
	if got := buildRelationSnapshots(candidates, nil); len(got) != 0 {
		t.Fatalf("name-only pair projected: %+v", got)
	}
}

func TestBuildRAWPairsKeepsSidecarWithByteIdenticalCopies(t *testing.T) {
	rawSHA := strings.Repeat("a", 64)
	jpegSHA := strings.Repeat("b", 64)
	imageID := "source-image-id"
	evidence := mediapkg.RelationEvidence{ImageUniqueID: imageID}
	renderedEvidence := mediapkg.RelationEvidence{
		ImageUniqueID: imageID, XMPDocumentID: "xmp.did:original",
	}
	rows := []relationCandidate{
		{
			NodeID: 1, MediaKind: meta.MediaKindImage,
			MIMEType: "image/x-adobe-dng", IndexState: meta.MediaIndexStateReady,
			SHA256: rawSHA, NodeRevision: 1, IndexedRevision: 1,
			Evidence: evidence,
		},
		{
			NodeID: 2, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", IndexState: meta.MediaIndexStateReady,
			SHA256: jpegSHA, NodeRevision: 1, IndexedRevision: 1,
			Evidence: renderedEvidence,
		},
		{
			NodeID: 3, MediaKind: meta.MediaKindImage,
			MIMEType: "image/x-adobe-dng", IndexState: meta.MediaIndexStateReady,
			SHA256: rawSHA, NodeRevision: 1, IndexedRevision: 1,
			Evidence: evidence,
		},
		{
			NodeID: 4, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", IndexState: meta.MediaIndexStateReady,
			SHA256: jpegSHA, NodeRevision: 1, IndexedRevision: 1,
			Evidence: renderedEvidence,
		},
		{
			NodeID: 5, Name: "recipe.xmp", MediaKind: meta.MediaKindOther,
			IndexState: meta.MediaIndexStateUnsupported,
			Evidence: mediapkg.RelationEvidence{
				XMPDerivedFromDocumentID: "xmp.did:original",
			},
		},
	}
	got := buildRelationSnapshots(rows, nil)
	if len(got) != 1 || got[0].Kind != meta.MediaGroupKindRAWPair ||
		len(got[0].Members) != 3 {
		t.Fatalf("RAW duplicate sidecar relationship=%+v", got)
	}
	for index, id := range []uint64{2, 1, 5} {
		if got[0].Members[index].NodeID != id {
			t.Fatalf("member %d=%d expected %d", index, got[0].Members[index].NodeID, id)
		}
	}
	rows[2].SHA256 = strings.Repeat("c", 64)
	if got := buildRelationSnapshots(rows, nil); len(got) != 0 {
		t.Fatalf("distinct RAW bytes must remain ambiguous: %+v", got)
	}
}
