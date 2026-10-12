package main

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestPlanLocalEvidencePhysicalPagePreservesOrderAndBudgets(t *testing.T) {
	item := func(id uint64, size int64) client.LocalEvidenceCloudDigest {
		return client.LocalEvidenceCloudDigest{EvidenceID: id, Size: size}
	}
	sixteen := make([]client.LocalEvidenceCloudDigest, 20)
	for i := range sixteen {
		sixteen[i] = item(uint64(i+1), 16<<20)
	}
	zeroes := make([]client.LocalEvidenceCloudDigest, 64)
	for i := range zeroes {
		zeroes[i] = item(uint64(i+1), 0)
	}
	tests := []struct {
		name    string
		input   []client.LocalEvidenceCloudDigest
		batches [][]uint64
		bytes   int64
	}{
		{name: "empty"},
		{name: "one legacy-sized object", input: []client.LocalEvidenceCloudDigest{item(1, 64<<20)},
			batches: [][]uint64{{1}}, bytes: 64 << 20},
		{name: "huge original is never falsely sampled", input: []client.LocalEvidenceCloudDigest{
			item(1, 4<<30), item(2, 32<<20), item(3, 32<<20), item(4, 1),
		}, batches: [][]uint64{{2, 3}, {4}}, bytes: 64<<20 + 1},
		{name: "two oversized-for-one-batch still fit distinct batches",
			input:   []client.LocalEvidenceCloudDigest{item(1, 40<<20), item(2, 40<<20)},
			batches: [][]uint64{{1}, {2}}, bytes: 80 << 20},
		{name: "four batches and 256 MiB at most", input: sixteen,
			batches: [][]uint64{{1, 2, 3, 4}, {5, 6, 7, 8},
				{9, 10, 11, 12}, {13, 14, 15, 16}}, bytes: 256 << 20},
		{name: "zero bytes still limited to sixteen files", input: zeroes,
			batches: [][]uint64{{1, 2, 3, 4}, {5, 6, 7, 8},
				{9, 10, 11, 12}, {13, 14, 15, 16}}},
		{name: "all files >64 MiB stay unobserved",
			input: []client.LocalEvidenceCloudDigest{item(1, 65<<20), item(2, 4<<30)}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := planLocalEvidencePhysicalPage(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			var ids [][]uint64
			for _, batch := range plan.Batches {
				group := make([]uint64, 0, len(batch))
				for _, claim := range batch {
					group = append(group, claim.EvidenceID)
				}
				ids = append(ids, group)
			}
			if !reflect.DeepEqual(ids, tc.batches) ||
				plan.SelectedBytes != tc.bytes {
				t.Fatalf("incorrect physical page sampling: groups=%v bytes=%d",
					ids, plan.SelectedBytes)
			}
			if len(plan.Batches) > 4 || plan.SelectedFiles > 16 ||
				plan.SelectedBytes > 256<<20 {
				t.Fatalf("physical page limits violated: %+v", plan)
			}
		})
	}
	for _, bad := range [][]client.LocalEvidenceCloudDigest{
		{item(0, 0)}, {item(4, 0), item(4, 1)},
		{item(5, 0), item(4, 1)}, {item(1, -1)},
	} {
		plan, err := planLocalEvidencePhysicalPage(bad)
		if err == nil || plan.SelectedFiles != 0 || len(plan.Batches) != 0 {
			t.Fatalf("invalid ordered page accepted: %+v", bad)
		}
	}
}

func TestObserveLocalEvidencePhysicalBatchesAllOrNothing(t *testing.T) {
	items := []client.LocalEvidenceCloudDigest{
		{EvidenceID: 1, Size: 11}, {EvidenceID: 2, Size: 22},
		{EvidenceID: 3, Size: 33}, {EvidenceID: 4, Size: 44},
		{EvidenceID: 5, Size: 55},
	}
	plan, err := planLocalEvidencePhysicalPage(items)
	if err != nil || len(plan.Batches) != 2 {
		t.Fatalf("expected two private batches: %+v %v", plan, err)
	}
	good := func(group []client.LocalEvidenceCloudDigest) client.LocalEvidencePhysicalCAS {
		return client.LocalEvidencePhysicalCAS{
			SourceID: 42, Revision: 7, Checked: len(group),
			CloudMetadataMatched: true, PhysicalCASMatched: true,
		}
	}
	var calls int
	verify := func(_ context.Context, group []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error) {
		calls++
		return good(group), nil
	}
	files, size, err := observeLocalEvidencePhysicalBatches(
		context.Background(), 42, 7, plan.Batches, verify)
	if err != nil || files != 5 || size != 165 || calls != 2 {
		t.Fatalf("genuine two-batch observation failed: files=%d bytes=%d calls=%d err=%v",
			files, size, calls, err)
	}
	calls = 0
	secondFails := func(_ context.Context, group []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error) {
		calls++
		if calls == 2 {
			return client.LocalEvidencePhysicalCAS{}, errors.New("later object corrupt")
		}
		return good(group), nil
	}
	files, size, err = observeLocalEvidencePhysicalBatches(
		context.Background(), 42, 7, plan.Batches, secondFails)
	if err == nil || files != 0 || size != 0 || calls != 2 {
		t.Fatalf("later failure exposed partial success: %d %d %d %v",
			files, size, calls, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	calls = 0
	cancelMidstream := func(_ context.Context, group []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error) {
		calls++
		if calls == 2 {
			cancel()
		}
		return good(group), nil
	}
	files, size, err = observeLocalEvidencePhysicalBatches(
		ctx, 42, 7, plan.Batches, cancelMidstream)
	if !errors.Is(err, context.Canceled) || files != 0 || size != 0 {
		t.Fatalf("cancel promoted a partial physical observation: %d %d %v", files, size, err)
	}
	calls = 0
	unsafe := func(_ context.Context, group []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error) {
		calls++
		r := good(group)
		if calls == 2 {
			r.CommitSupported = true
		}
		return r, nil
	}
	files, size, err = observeLocalEvidencePhysicalBatches(
		context.Background(), 42, 7, plan.Batches, unsafe)
	if err == nil || files != 0 || size != 0 {
		t.Fatalf("unsafe Server authority promoted a physical result: %d %d %v",
			files, size, err)
	}
}

func TestObserveLocalEvidencePhysicalBatchesRejectsMalformedWorkWithoutIO(t *testing.T) {
	var calls int
	check := func(_ context.Context, group []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error) {
		calls++
		return client.LocalEvidencePhysicalCAS{SourceID: 42, Revision: 7,
			Checked: len(group), CloudMetadataMatched: true, PhysicalCASMatched: true}, nil
	}
	item := func(id uint64, size int64) client.LocalEvidenceCloudDigest {
		return client.LocalEvidenceCloudDigest{EvidenceID: id, Size: size}
	}
	bad := [][][]client.LocalEvidenceCloudDigest{
		{{}},
		{{item(1, 1), item(1, 1)}},
		{{item(4, 1)}, {item(3, 1)}},
		{{item(1, 32<<20), item(2, 32<<20+1)}},
		{{item(1, 1), item(2, 1), item(3, 1), item(4, 1), item(5, 1)}},
		{{item(1, 0)}, {item(2, 0)}, {item(3, 0)}, {item(4, 0)}, {item(5, 0)}},
	}
	for _, batch := range bad {
		files, size, err := observeLocalEvidencePhysicalBatches(
			context.Background(), 42, 7, batch, check)
		if err == nil || files != 0 || size != 0 {
			t.Fatalf("invalid physical work accepted: %+v", batch)
		}
	}
	// Earlier valid sub-batches are transient observations; malformed
	// later work is rejected, without a partial return.
	if calls != 0 {
		t.Fatalf("malformed first batch reached Store verifier %d times", calls)
	}
}
