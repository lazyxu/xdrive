package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestLocalQuarantinePageRejectsForeignStaleAndMalformedCandidates(t *testing.T) {
	row := client.LocalSourceItemEvidencePageItem{
		EvidenceID: 9, SourceItemID: 51,
		PreviousPathKey:   strings.Repeat("1", 64),
		CurrentPathKey:    strings.Repeat("2", 64),
		NativeIdentityKey: strings.Repeat("3", 64),
	}
	page := client.LocalSourceItemEvidencePage{
		SourceID: 42, Revision: 7,
		Items:   []client.LocalSourceItemEvidencePageItem{row},
		HasMore: false, NextAfterID: 9,
	}
	ids, candidates, err := localQuarantineCandidates(page, 42, 7, 5)
	if err != nil || len(ids) != 1 || ids[0] != 9 ||
		len(candidates) != 1 || candidates[0].CurrentPathKey != row.CurrentPathKey {
		t.Fatalf("valid own-device page rejected: ids=%v candidates=%v err=%v", ids, candidates, err)
	}
	empty := client.LocalSourceItemEvidencePage{
		SourceID: 42, Revision: 7, HasMore: false, NextAfterID: 0,
	}
	ids, candidates, err = localQuarantineCandidates(empty, 42, 7, 9)
	if err != nil || len(ids) != 0 || len(candidates) != 0 {
		t.Fatalf("empty terminal page should not start a write: %v", err)
	}
	other := row
	other.EvidenceID = 10
	other.SourceItemID = 52
	other.PreviousPathKey = strings.Repeat("4", 64)
	other.CurrentPathKey = strings.Repeat("5", 64)
	other.NativeIdentityKey = strings.Repeat("6", 64)
	tests := []struct {
		name     string
		page     client.LocalSourceItemEvidencePage
		sourceID uint64
		revision uint64
		afterID  uint64
	}{
		{"foreign Source", page, 43, 7, 5},
		{"stale revision", page, 42, 8, 5},
		{"cursor replay", page, 42, 7, 9},
		{"empty with more", func() client.LocalSourceItemEvidencePage {
			p := empty
			p.HasMore = true
			return p
		}(), 42, 7, 0},
		{"invalid cursor", func() client.LocalSourceItemEvidencePage {
			p := page
			p.NextAfterID = 10
			return p
		}(), 42, 7, 5},
		{"privileged", func() client.LocalSourceItemEvidencePage {
			p := page
			p.Authoritative = true
			return p
		}(), 42, 7, 5},
		{"deletion authority", func() client.LocalSourceItemEvidencePage {
			p := page
			p.MissingInferenceSafe = true
			return p
		}(), 42, 7, 5},
		{"duplicate item", func() client.LocalSourceItemEvidencePage {
			p := page
			next := other
			next.SourceItemID = row.SourceItemID
			p.Items = []client.LocalSourceItemEvidencePageItem{row, next}
			p.NextAfterID = 10
			return p
		}(), 42, 7, 5},
		{"duplicate native", func() client.LocalSourceItemEvidencePage {
			p := page
			next := other
			next.NativeIdentityKey = row.NativeIdentityKey
			p.Items = []client.LocalSourceItemEvidencePageItem{row, next}
			p.NextAfterID = 10
			return p
		}(), 42, 7, 5},
		{"duplicate destination", func() client.LocalSourceItemEvidencePage {
			p := page
			next := other
			next.CurrentPathKey = row.CurrentPathKey
			p.Items = []client.LocalSourceItemEvidencePageItem{row, next}
			p.NextAfterID = 10
			return p
		}(), 42, 7, 5},
		{"old equals new", func() client.LocalSourceItemEvidencePage {
			p := page
			next := row
			next.CurrentPathKey = next.PreviousPathKey
			p.Items = []client.LocalSourceItemEvidencePageItem{next}
			return p
		}(), 42, 7, 5},
		{"wrong digest", func() client.LocalSourceItemEvidencePage {
			p := page
			next := row
			next.NativeIdentityKey = "private absolute path"
			p.Items = []client.LocalSourceItemEvidencePageItem{next}
			return p
		}(), 42, 7, 5},
		{"overflow page", func() client.LocalSourceItemEvidencePage {
			p := page
			p.Items = make([]client.LocalSourceItemEvidencePageItem, 17)
			return p
		}(), 42, 7, 5},
		{"partial has-more page", func() client.LocalSourceItemEvidencePage {
			p := page
			p.HasMore = true
			return p
		}(), 42, 7, 5},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ids, candidates, err := localQuarantineCandidates(
				tc.page, tc.sourceID, tc.revision, tc.afterID)
			if err == nil || len(ids) != 0 || len(candidates) != 0 {
				t.Fatalf("unsafe quarantine page permitted: %s", tc.name)
			}
		})
	}
}

func TestSubmitLocalQuarantineBatchRejectsUnsafeCallsAndContextCancellation(t *testing.T) {
	ids := []uint64{5, 9}
	var calls int
	safe := func(_ context.Context, batch []uint64) (client.LocalCommitIntentResult, error) {
		calls++
		return client.LocalCommitIntentResult{
			SourceID: 42, Revision: 7, Quarantined: 1, Replayed: 1,
		}, nil
	}
	for _, input := range [][]uint64{
		nil, {}, {0}, {9, 5}, {5, 5}, make([]uint64, 17),
	} {
		if _, err := submitLocalQuarantineBatch(
			context.Background(), 42, 7, input, safe); err == nil {
			t.Fatalf("unsafe batch accepted: %v", input)
		}
	}
	if calls != 0 {
		t.Fatalf("malformed work dispatched %d times", calls)
	}
	out, err := submitLocalQuarantineBatch(context.Background(), 42, 7, ids, safe)
	if err != nil || out.Quarantined != 1 || out.Replayed != 1 ||
		out.Authoritative || out.CommitSupported || out.MissingInferenceSafe ||
		calls != 1 {
		t.Fatalf("safe quarantine callback invalid: %+v %v", out, err)
	}
	for _, violate := range []func(*client.LocalCommitIntentResult){
		func(r *client.LocalCommitIntentResult) { r.SourceID++ },
		func(r *client.LocalCommitIntentResult) { r.Revision++ },
		func(r *client.LocalCommitIntentResult) { r.Quarantined = 3 },
		func(r *client.LocalCommitIntentResult) { r.Replayed = 0 },
		func(r *client.LocalCommitIntentResult) { r.CommitSupported = true },
		func(r *client.LocalCommitIntentResult) { r.Authoritative = true },
		func(r *client.LocalCommitIntentResult) { r.MissingInferenceSafe = true },
	} {
		write := func(ctx context.Context, batch []uint64) (client.LocalCommitIntentResult, error) {
			r, err := safe(ctx, batch)
			violate(&r)
			return r, err
		}
		if _, err := submitLocalQuarantineBatch(
			context.Background(), 42, 7, ids, write); err == nil {
			t.Fatal("unsafe or mismatched private quarantine response accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls = 0
	if _, err := submitLocalQuarantineBatch(ctx, 42, 7, ids, safe); !errors.Is(err, context.Canceled) || calls != 0 {
		t.Fatalf("already cancelled work reached Server: err=%v calls=%d", err, calls)
	}
	ctx, cancel = context.WithCancel(context.Background())
	writeThenCancel := func(_ context.Context, selected []uint64) (client.LocalCommitIntentResult, error) {
		r, _ := safe(context.Background(), selected)
		cancel()
		return r, nil
	}
	if _, err := submitLocalQuarantineBatch(ctx, 42, 7, ids, writeThenCancel); !errors.Is(err, context.Canceled) {
		t.Fatalf("late cancellation was reported as durable success: %v", err)
	}
	cancel()
}
