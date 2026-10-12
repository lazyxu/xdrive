package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestValidateLocalQuarantineRecoveryPageFailsClosed(t *testing.T) {
	good := client.LocalCommitIntentPage{
		SourceID: 42, Revision: 7,
		EvidenceIDs: []uint64{5, 9}, NextAfterID: 9,
	}
	if err := validateLocalQuarantineRecoveryPage(good, 42, 7, 0); err != nil {
		t.Fatalf("valid private recovered proposal IDs rejected: %v", err)
	}
	tests := []struct {
		name                        string
		change                      func(*client.LocalCommitIntentPage)
		sourceID, revision, afterID uint64
	}{
		{"foreign Source", nil, 43, 7, 0},
		{"stale revision", nil, 42, 8, 0},
		{"cursor replay", nil, 42, 7, 9},
		{"missing list", func(v *client.LocalCommitIntentPage) { v.EvidenceIDs = nil }, 42, 7, 0},
		{"duplicate", func(v *client.LocalCommitIntentPage) { v.EvidenceIDs = []uint64{5, 5} }, 42, 7, 0},
		{"unordered", func(v *client.LocalCommitIntentPage) { v.EvidenceIDs = []uint64{9, 5} }, 42, 7, 0},
		{"invalid cursor", func(v *client.LocalCommitIntentPage) { v.NextAfterID = 10 }, 42, 7, 0},
		{"privileged", func(v *client.LocalCommitIntentPage) { v.Authoritative = true }, 42, 7, 0},
		{"commit authority", func(v *client.LocalCommitIntentPage) { v.CommitSupported = true }, 42, 7, 0},
		{"missing inference", func(v *client.LocalCommitIntentPage) { v.MissingInferenceSafe = true }, 42, 7, 0},
		{"incomplete more page", func(v *client.LocalCommitIntentPage) { v.HasMore = true }, 42, 7, 0},
		{"overflow", func(v *client.LocalCommitIntentPage) { v.EvidenceIDs = make([]uint64, localQuarantinePageLimit+1) }, 42, 7, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			page := good
			if tc.change != nil {
				tc.change(&page)
			}
			if err := validateLocalQuarantineRecoveryPage(page, tc.sourceID, tc.revision, tc.afterID); err == nil {
				t.Fatal("unsafe recovered quarantine page accepted")
			}
		})
	}
	empty := client.LocalCommitIntentPage{SourceID: 42, Revision: 7, EvidenceIDs: []uint64{}}
	if err := validateLocalQuarantineRecoveryPage(empty, 42, 7, 9); err != nil {
		t.Fatal("valid empty terminal page rejected", err)
	}
	empty.HasMore = true
	if err := validateLocalQuarantineRecoveryPage(empty, 42, 7, 9); err == nil {
		t.Fatal("empty page falsely claims more")
	}
}
