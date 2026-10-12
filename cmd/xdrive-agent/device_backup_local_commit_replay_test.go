package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestLocalQuarantineReplayMatchesExactRecoveredIDs(t *testing.T) {
	actual := []uint64{5, 9}
	if !localQuarantineReplayMatches(actual, nil) {
		t.Fatal("existing first-write path must remain unchanged")
	}
	if !localQuarantineReplayMatches(actual, []uint64{5, 9}) {
		t.Fatal("exact recovery batch should be replayable")
	}
	for _, test := range []struct {
		name string
		ids  []uint64
	}{
		{"empty recovery", []uint64{}},
		{"missing candidate", []uint64{5}},
		{"extra candidate", []uint64{5, 9, 12}},
		{"different candidate", []uint64{5, 10}},
		{"unordered", []uint64{9, 5}},
		{"duplicate", []uint64{5, 5}},
		{"zero", []uint64{0, 9}},
		{"oversized", make([]uint64, localQuarantinePageLimit+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if localQuarantineReplayMatches(actual, test.ids) {
				t.Fatal("unsafe or broadened replay candidate set accepted")
			}
		})
	}
	// A legitimate recovered page can contain a single terminal proposal,
	// but it must still match the entire independently rechecked page.
	if !localQuarantineReplayMatches([]uint64{51}, []uint64{51}) {
		t.Fatal("single terminal replay denied")
	}
	if localQuarantineReplayMatches([]uint64{51, 52}, []uint64{51}) {
		t.Fatal("new unquarantined candidate was included in recovery")
	}
}

func TestLocalQuarantineReplayConfirmedRequiresOnlyExactIdempotentCount(t *testing.T) {
	recovered := client.LocalCommitIntentPage{
		SourceID: 42, Revision: 7, EvidenceIDs: []uint64{5, 9},
		HasMore: true, NextAfterID: 9,
	}
	replay := localQuarantinePageSummary{
		SourceID: 42, Revision: 7, Quarantined: 0, Replayed: 2,
	}
	if !localQuarantineReplayConfirmed(recovered, replay) {
		t.Fatal("exact non-authoritative replay rejected")
	}
	for _, mutate := range []struct {
		name string
		edit func(*localQuarantinePageSummary)
	}{
		{"other Source", func(v *localQuarantinePageSummary) { v.SourceID++ }},
		{"new Source revision", func(v *localQuarantinePageSummary) { v.Revision++ }},
		{"created a new intent", func(v *localQuarantinePageSummary) { v.Quarantined = 1 }},
		{"partial replay", func(v *localQuarantinePageSummary) { v.Replayed = 1 }},
		{"extra replay", func(v *localQuarantinePageSummary) { v.Replayed = 3 }},
		{"commit authority", func(v *localQuarantinePageSummary) { v.CommitSupported = true }},
		{"authoritative", func(v *localQuarantinePageSummary) { v.Authoritative = true }},
		{"Mirror inference", func(v *localQuarantinePageSummary) { v.MissingInferenceSafe = true }},
	} {
		t.Run(mutate.name, func(t *testing.T) {
			bad := replay
			mutate.edit(&bad)
			if localQuarantineReplayConfirmed(recovered, bad) {
				t.Fatal("incorrect recovery count or authority reported success")
			}
		})
	}
	recovered.Authoritative = true
	if localQuarantineReplayConfirmed(recovered, replay) {
		t.Fatal("privileged recovered proposal promoted")
	}
	recovered.Authoritative = false
	recovered.EvidenceIDs = []uint64{}
	if localQuarantineReplayConfirmed(recovered, replay) {
		t.Fatal("empty read cannot be a successful Server replay")
	}
}
