package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func quarantinedPhysicalTestPages() (client.LocalCommitIntentPage, client.LocalSourceItemEvidencePage) {
	recovered := client.LocalCommitIntentPage{
		SourceID: 42, Revision: 7,
		EvidenceIDs: []uint64{5, 9}, HasMore: false, NextAfterID: 9,
	}
	advisory := client.LocalSourceItemEvidencePage{
		SourceID: 42, Revision: 7,
		Items: []client.LocalSourceItemEvidencePageItem{
			{
				EvidenceID: 5, SourceItemID: 15,
				PreviousPathKey:   strings.Repeat("1", 64),
				CurrentPathKey:    strings.Repeat("2", 64),
				NativeIdentityKey: strings.Repeat("3", 64),
			},
			{
				EvidenceID: 9, SourceItemID: 19,
				PreviousPathKey:   strings.Repeat("4", 64),
				CurrentPathKey:    strings.Repeat("5", 64),
				NativeIdentityKey: strings.Repeat("6", 64),
			},
		},
		HasMore: false, NextAfterID: 9,
	}
	return recovered, advisory
}

func TestLocalQuarantinedPhysicalCandidatesExactOnly(t *testing.T) {
	readback, page := quarantinedPhysicalTestPages()
	ids, candidates, err := localQuarantinedPhysicalCandidates(readback, page, 42, 7, 0)
	if err != nil || len(ids) != 2 || ids[0] != 5 || ids[1] != 9 ||
		len(candidates) != 2 || candidates[1].NativeIdentityKey != page.Items[1].NativeIdentityKey {
		t.Fatalf("exact private quarantine physical page rejected: %v %v %v", ids, candidates, err)
	}
	// A valid empty terminal page is not content-verified. It must never
	// create a synthetic result or dispatch any physical Server read.
	empty := client.LocalCommitIntentPage{
		SourceID: 42, Revision: 7,
		EvidenceIDs: []uint64{}, HasMore: false, NextAfterID: 0,
	}
	ids, candidates, err = localQuarantinedPhysicalCandidates(
		empty, client.LocalSourceItemEvidencePage{}, 42, 7, 11)
	if err != nil || len(ids) != 0 || len(candidates) != 0 {
		t.Fatalf("valid empty readback page rejected: %v %v %v", ids, candidates, err)
	}
	if _, _, err = localQuarantinedPhysicalCandidates(readback, page, 42, 8, 0); err == nil {
		t.Fatal("stale revision passed")
	}
	if _, _, err = localQuarantinedPhysicalCandidates(readback, page, 43, 7, 0); err == nil {
		t.Fatal("foreign Source passed")
	}
	for _, test := range []struct {
		name string
		edit func(*client.LocalCommitIntentPage, *client.LocalSourceItemEvidencePage)
	}{
		{"missing evidence", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items = b.Items[:1]
		}},
		{"new interleaved evidence", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[1].EvidenceID = 7
		}},
		{"wrong cursor", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.NextAfterID = 10
		}},
		{"readback cursor mismatch", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.NextAfterID = 10
		}},
		{"readback unordered", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.EvidenceIDs[1] = 4
		}},
		{"readback duplicate", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.EvidenceIDs[1] = 5
		}},
		{"readback too many", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.EvidenceIDs = []uint64{1, 2, 3, 4, 5}
		}},
		{"partial next page", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.HasMore = true
		}},
		{"advisory partial page", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.HasMore = true
		}},
		{"source mismatch", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.SourceID++
		}},
		{"invalid old key", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[0].PreviousPathKey = strings.Repeat("g", 64)
		}},
		{"same old new", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[0].PreviousPathKey = b.Items[0].CurrentPathKey
		}},
		{"duplicate item", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[1].SourceItemID = b.Items[0].SourceItemID
		}},
		{"duplicate native", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[1].NativeIdentityKey = b.Items[0].NativeIdentityKey
		}},
		{"duplicate destination", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Items[1].CurrentPathKey = b.Items[0].CurrentPathKey
		}},
		{"privileged quarantine", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.CommitSupported = true
		}},
		{"privileged advisory", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.Authoritative = true
		}},
		{"missing inferred", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			b.MissingInferenceSafe = true
		}},
		{"invalid empty", func(a *client.LocalCommitIntentPage, b *client.LocalSourceItemEvidencePage) {
			a.EvidenceIDs = nil
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, b := quarantinedPhysicalTestPages()
			test.edit(&a, &b)
			got, candidates, err := localQuarantinedPhysicalCandidates(a, b, 42, 7, 0)
			if err == nil || len(got) != 0 || len(candidates) != 0 {
				t.Fatalf("unsafe quarantine physical candidates accepted: %s", test.name)
			}
		})
	}
}

func TestLocalQuarantinedPhysicalClaimsWithinBudget(t *testing.T) {
	claim := func(id uint64, size int64) client.LocalEvidenceCloudDigest {
		return client.LocalEvidenceCloudDigest{
			EvidenceID: id, SHA256: strings.Repeat("a", 64), Size: size,
		}
	}
	for _, valid := range [][]client.LocalEvidenceCloudDigest{
		{claim(1, 0)},
		{claim(1, 12), claim(4, 6)},
		{claim(1, 64<<20)},
		{claim(1, 32<<20), claim(4, 32<<20)},
		{claim(1, 1), claim(2, 1), claim(3, 1), claim(4, 1)},
	} {
		if !localQuarantinedPhysicalClaimsWithinBudget(valid) {
			t.Fatalf("valid bounded claim rejected: %+v", valid)
		}
	}
	for _, bad := range [][]client.LocalEvidenceCloudDigest{
		nil, {},
		{claim(0, 1)},
		{claim(4, 1), claim(1, 1)},
		{claim(2, 1), claim(2, 1)},
		{claim(1, -1)},
		{claim(1, 64<<20+1)},
		{claim(1, 32<<20), claim(2, 32<<20+1)},
		{claim(1, 1), claim(2, 1), claim(3, 1), claim(4, 1), claim(5, 1)},
		func() []client.LocalEvidenceCloudDigest {
			bad := claim(1, 1)
			bad.SHA256 = strings.Repeat("A", 64)
			return []client.LocalEvidenceCloudDigest{bad}
		}(),
	} {
		if localQuarantinedPhysicalClaimsWithinBudget(bad) {
			t.Fatalf("unsafe physical content claim accepted: %+v", bad)
		}
	}
}
