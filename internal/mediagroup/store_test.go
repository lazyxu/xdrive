package mediagroup

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestNormalizeAndValidateLivePhoto(t *testing.T) {
	snapshot := Snapshot{
		Kind:        " live_photo ",
		EvidenceKey: " apple-asset:ABC ",
		Members: []MemberSnapshot{
			{NodeID: 11, Role: " still ", Ordinal: 0},
			{NodeID: 12, Role: "motion", Ordinal: 1},
			{NodeID: 13, Role: "container", Ordinal: 2},
		},
	}
	if err := normalizeAndValidate(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Kind != meta.MediaGroupKindLivePhoto || snapshot.EvidenceKey != "apple-asset:ABC" {
		t.Fatalf("snapshot not normalized: %+v", snapshot)
	}
	if snapshot.Members[0].Role != meta.MediaGroupRoleStill {
		t.Fatalf("member role=%q", snapshot.Members[0].Role)
	}
}

func TestNormalizeAndValidateRejectsHeuristicOrBrokenLivePhotoShape(t *testing.T) {
	tests := []Snapshot{
		{
			Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "",
			Members: []MemberSnapshot{
				{NodeID: 1, Role: meta.MediaGroupRoleStill, Ordinal: 0},
				{NodeID: 2, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
			},
		},
		{
			Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "apple-asset:x",
			Members: []MemberSnapshot{
				{NodeID: 1, Role: meta.MediaGroupRoleStill, Ordinal: 0},
			},
		},
		{
			Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "apple-asset:x",
			Members: []MemberSnapshot{
				{NodeID: 1, Role: meta.MediaGroupRoleStill, Ordinal: 0},
				{NodeID: 2, Role: meta.MediaGroupRoleMotion, Ordinal: 0},
			},
		},
		{
			Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "apple-asset:x",
			Members: []MemberSnapshot{
				{NodeID: 1, Role: "provider_live_type", Ordinal: 0},
				{NodeID: 2, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
			},
		},
	}
	for index := range tests {
		if err := normalizeAndValidate(&tests[index]); err == nil {
			t.Fatalf("case %d unexpectedly accepted", index)
		}
	}
}
