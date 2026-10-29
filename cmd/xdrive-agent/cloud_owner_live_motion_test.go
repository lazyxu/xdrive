package main

import "testing"

func TestOwnerLiveMotionSelectorRejectsAllExtraScope(t *testing.T) {
	for _, q := range []string{"", "node_id=42", "node_id=42&revision=0",
		"node_id=0&revision=1", "node_id=042&revision=7",
		"node_id=42&revision=07", "node_id=42&revision=7&owner_id=9",
		"node_id=42&node_id=43&revision=7", "node_id=42&revision=7&revision=8",
		"node_id=9007199254740992&revision=7",
		"node_id=42&revision=7%26owner%3D4"} {
		if _, _, ok := ownerLiveMotionSelector(q); ok {
			t.Fatalf("accepted unsafe selector %q", q)
		}
	}
	id, revision, ok := ownerLiveMotionSelector("node_id=42&revision=7")
	if !ok || id != 42 || revision != 7 {
		t.Fatal("exact Owner selector rejected")
	}
}
