package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/background"
)

func TestPhotoAutoKindsStrictValidationAndLegacyDefaults(t *testing.T) {
	defaultKinds, err := parsePhotoAutoKinds("")
	if err != nil || defaultKinds != nil ||
		effectivePhotoAutoKinds(defaultKinds) != defaultPhotoAutoKinds() {
		t.Fatalf("legacy defaults changed: %+v err=%v", defaultKinds, err)
	}
	for _, raw := range []string{
		"null", "[]", "{}", `{"face":true,"smart":true,"semantic":true}`,
		`{"face":null,"smart":true,"semantic":true,"person_cluster":true}`,
		`{"face":true,"smart":true,"semantic":true,"person_cluster":true,"unexpected":false}`,
		`{"face":"true","smart":true,"semantic":true,"person_cluster":true}`,
	} {
		if kinds, err := parsePhotoAutoKinds(raw); err == nil {
			t.Fatalf("corrupt kind policy accepted (%q): %+v", raw, kinds)
		}
	}
	kinds, err := parsePhotoAutoKinds(
		`{"face":false,"smart":true,"semantic":false,"person_cluster":true}`,
	)
	if err != nil || kinds == nil || kinds.Face || !kinds.Smart ||
		kinds.Semantic || !kinds.PersonCluster {
		t.Fatalf("valid kind policy was rejected: %+v (%v)", kinds, err)
	}
}

func TestPhotoAutoKindsControlOnlyAutomaticTaskAdmissions(t *testing.T) {
	s := &Server{}
	kinds := photoAutoKinds{Face: false, Smart: true, Semantic: false, PersonCluster: true}
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: true, Kinds: &kinds, Revision: 1})
	for _, item := range []struct {
		kind    photoIntelligenceTaskKind
		allowed bool
	}{
		{photoIntelligenceFace, false},
		{photoIntelligenceSmartSearch, true},
		{photoIntelligenceSemanticSearch, false},
		{photoIntelligencePersonCluster, true},
	} {
		for _, trigger := range []background.Trigger{
			background.TriggerSystemEvent,
			background.TriggerReconcile,
			background.TriggerSchedule,
		} {
			if got := s.photoAutoAllows(item.kind, trigger); got != item.allowed {
				t.Fatalf("%s/%s admission=%v want=%v", item.kind, trigger, got, item.allowed)
			}
		}
		for _, trigger := range []background.Trigger{
			background.TriggerUserAction, background.TriggerAdminAction,
		} {
			if !s.photoAutoAllows(item.kind, trigger) {
				t.Fatalf("manual %s/%s must remain enabled", item.kind, trigger)
			}
		}
	}
	if !s.photoAutoAllows(photoIntelligencePlace, background.TriggerReconcile) {
		t.Fatal("GeoNames place-label scheduling must remain independent")
	}
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: false, Kinds: &kinds, Revision: 2})
	if s.photoAutoAllows(photoIntelligenceSmartSearch, background.TriggerReconcile) {
		t.Fatal("global pause must still override enabled individual kinds")
	}
	s.setPhotoAutoRuntime(photoAutoDesired{AutoEnabled: true, Kinds: &kinds, Revision: 1})
	if s.photoAutoAllows(photoIntelligenceFace, background.TriggerReconcile) {
		t.Fatal("stale revision restored a paused automatic kind")
	}
}
