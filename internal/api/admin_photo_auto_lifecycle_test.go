package api

import "testing"

func TestPhotoAutomaticAdmissionEvidenceDoesNotAssertModelHealth(t *testing.T) {
	all := defaultPhotoAutoKinds()
	mixed := photoAutoKinds{Face: false, PersonCluster: true, Smart: true, Semantic: false}
	paused := photoAutoKinds{Face: false, PersonCluster: false, Smart: false, Semantic: false}
	for _, tc := range []struct {
		name          string
		desired       photoAutoDesired
		effective     *photoAutoRuntime
		face          string
		smart         string
		semantic      string
		wantRevision  uint64
		wantEffective uint64
	}{
		{name: "unmanaged default is not proven", desired: photoAutoDesired{AutoEnabled: true}, effective: &photoAutoRuntime{AutoEnabled: true}, face: "unmanaged", smart: "unmanaged", semantic: "unmanaged"},
		{name: "saved but missing runtime", desired: photoAutoDesired{AutoEnabled: true, Revision: 3, Kinds: &all}, face: "pending", smart: "pending", semantic: "pending", wantRevision: 3},
		{name: "older runtime policy revision", desired: photoAutoDesired{AutoEnabled: true, Revision: 3, Kinds: &all}, effective: &photoAutoRuntime{AutoEnabled: true, Revision: 2, Kinds: &all}, face: "pending", smart: "pending", semantic: "pending", wantRevision: 3, wantEffective: 2},
		{name: "same revision but changed global switch", desired: photoAutoDesired{AutoEnabled: true, Revision: 3, Kinds: &all}, effective: &photoAutoRuntime{AutoEnabled: false, Revision: 3, Kinds: &all}, face: "pending", smart: "pending", semantic: "pending", wantRevision: 3, wantEffective: 3},
		{name: "same revision but changed kind values", desired: photoAutoDesired{AutoEnabled: true, Revision: 3, Kinds: &all}, effective: &photoAutoRuntime{AutoEnabled: true, Revision: 3, Kinds: &mixed}, face: "pending", smart: "pending", semantic: "pending", wantRevision: 3, wantEffective: 3},
		{name: "all automatic tasks admitted", desired: photoAutoDesired{AutoEnabled: true, Revision: 4, Kinds: &all}, effective: &photoAutoRuntime{AutoEnabled: true, Revision: 4, Kinds: &all}, face: "enabled", smart: "enabled", semantic: "enabled", wantRevision: 4, wantEffective: 4},
		{name: "global pause overrides enabled kinds", desired: photoAutoDesired{AutoEnabled: false, Revision: 5, Kinds: &all}, effective: &photoAutoRuntime{AutoEnabled: false, Revision: 5, Kinds: &all}, face: "paused", smart: "paused", semantic: "paused", wantRevision: 5, wantEffective: 5},
		{name: "per-kind pause and partial face grouping", desired: photoAutoDesired{AutoEnabled: true, Revision: 6, Kinds: &mixed}, effective: &photoAutoRuntime{AutoEnabled: true, Revision: 6, Kinds: &mixed}, face: "partial", smart: "enabled", semantic: "paused", wantRevision: 6, wantEffective: 6},
		{name: "all individual groups paused", desired: photoAutoDesired{AutoEnabled: true, Revision: 7, Kinds: &paused}, effective: &photoAutoRuntime{AutoEnabled: true, Revision: 7, Kinds: &paused}, face: "paused", smart: "paused", semantic: "paused", wantRevision: 7, wantEffective: 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proof := photoAutomaticAdmissionFromRuntime(tc.desired, tc.effective)
			if proof.desiredRevision != tc.wantRevision || proof.effectiveRevision != tc.wantEffective {
				t.Fatalf("revisions desired/effective = %d/%d, expected %d/%d",
					proof.desiredRevision, proof.effectiveRevision, tc.wantRevision, tc.wantEffective)
			}
			for id, want := range map[string]string{
				"photo-face": tc.face, "photo-smart": tc.smart, "photo-semantic": tc.semantic,
			} {
				if got := proof.stateForService(id); got != want {
					t.Fatalf("%s automatic admission = %q, want %q", id, got, want)
				}
			}
			if got := proof.stateForService("photo-creative"); got != "not-applicable" {
				t.Fatalf("creative tasks gained imaginary auto scheduler: %q", got)
			}
			if got := proof.stateForService("database"); got != "" {
				t.Fatalf("unrelated service inherited photo policy: %q", got)
			}
		})
	}
}

func TestPhotoAutomaticAdmissionReadFailureDoesNotPretendReady(t *testing.T) {
	s := &Server{}
	proof := s.photoAutomaticAdmissionEvidence(nil)
	for _, id := range []string{"photo-face", "photo-smart", "photo-semantic"} {
		if got := proof.stateForService(id); got != "unknown" {
			t.Fatalf("missing DB marked %s %s", id, got)
		}
	}
	if proof.desiredRevision != 0 || proof.effectiveRevision != 0 {
		t.Fatal("missing DB invented policy revisions")
	}
}
