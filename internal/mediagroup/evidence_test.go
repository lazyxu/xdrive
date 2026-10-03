package mediagroup

import (
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
