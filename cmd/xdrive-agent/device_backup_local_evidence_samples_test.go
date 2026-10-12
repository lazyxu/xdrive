package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestSelectLocalEvidencePhysicalSamplesPreservesOrderAndReadBudget(t *testing.T) {
	item := func(id uint64, size int64) client.LocalEvidenceCloudDigest {
		return client.LocalEvidenceCloudDigest{EvidenceID: id, Size: size}
	}
	tests := []struct {
		name  string
		input []client.LocalEvidenceCloudDigest
		ids   []uint64
		bytes int64
	}{
		{name: "empty"},
		{name: "one", input: []client.LocalEvidenceCloudDigest{item(1, 64<<20)},
			ids: []uint64{1}, bytes: 64 << 20},
		{name: "skip large without upgrading it", input: []client.LocalEvidenceCloudDigest{
			item(1, 4<<30), item(2, 32<<20), item(3, 32<<20), item(4, 1),
		}, ids: []uint64{2, 3}, bytes: 64 << 20},
		{name: "four item limit", input: []client.LocalEvidenceCloudDigest{
			item(1, 1), item(2, 2), item(3, 3), item(4, 4), item(5, 5),
		}, ids: []uint64{1, 2, 3, 4}, bytes: 10},
		{name: "skip negative without underflow", input: []client.LocalEvidenceCloudDigest{
			item(1, -1), item(2, 9), item(3, 64<<20),
		}, ids: []uint64{2}, bytes: 9},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			samples, total := selectLocalEvidencePhysicalSamples(tc.input)
			if total != tc.bytes || len(samples) != len(tc.ids) {
				t.Fatalf("wrong sampling budget: ids=%v samples=%+v bytes=%d",
					tc.ids, samples, total)
			}
			for i, id := range tc.ids {
				if samples[i].EvidenceID != id {
					t.Fatalf("sampling reorders native evidence: %v", samples)
				}
			}
			if len(samples) > 4 || total > 64<<20 {
				t.Fatalf("sampling escaped physical budget: %+v, %d", samples, total)
			}
		})
	}
}
