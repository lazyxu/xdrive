package api

import (
	"strings"
	"testing"
)

func TestValidLocalCommitIntentPageRequestRejectsUnsafeShapes(t *testing.T) {
	good := localCommitIntentPageRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Limit:                  localCommitIntentMaxItems,
	}
	if !validLocalCommitIntentPageRequest(good) {
		t.Fatal("valid owning-Agent quarantine page rejected")
	}
	for _, modify := range []func(*localCommitIntentPageRequest){
		func(v *localCommitIntentPageRequest) { v.Limit = 0 },
		func(v *localCommitIntentPageRequest) { v.Limit = localCommitIntentMaxItems + 1 },
		func(v *localCommitIntentPageRequest) { v.PreviousSnapshotSHA256 = "bad" },
		func(v *localCommitIntentPageRequest) { v.CurrentSnapshotSHA256 = strings.Repeat("g", 64) },
		func(v *localCommitIntentPageRequest) { v.CurrentSnapshotSHA256 = strings.Repeat("A", 64) },
		func(v *localCommitIntentPageRequest) { v.CurrentSnapshotSHA256 = v.PreviousSnapshotSHA256 },
	} {
		invalid := good
		modify(&invalid)
		if validLocalCommitIntentPageRequest(invalid) {
			t.Fatalf("unsafe private quarantine query accepted: %+v", invalid)
		}
	}
}
