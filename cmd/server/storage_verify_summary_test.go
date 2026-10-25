package main

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/maintenance"
)

func TestStorageSummaryOnlyActionableAndBounded(t *testing.T) {
	report := maintenance.VerifyReport{
		Missing: []maintenance.MissingBlob{
			{StorageKey: "1/docs/a", Reason: "open /data/1/docs/a: permission denied"},
			{StorageKey: "1/docs/b", Reason: "not_found"},
			{StorageKey: "1/docs/c", Reason: "not_found"},
			{StorageKey: "1/docs/d", Reason: "not_found"},
			{StorageKey: "1/docs/e", Reason: "not_found"},
			{StorageKey: "1/docs/f", Reason: "not_found"},
		},
		SharedRefs: []maintenance.DuplicateReference{{StorageKey: ".xdrive-blobs/sha256/aa/hash", References: 2}},
	}
	sum := summarizeStorageVerify(report)
	if sum.Mode != "" || sum.HashedBytes != 0 {
		t.Fatalf("unexpected summary mode/bytes: %+v", sum)
	}
	if sum.OK || sum.Counts.Missing != 6 || sum.Counts.DuplicateReferences != 0 ||
		sum.MissingReasons["permission_denied"] != 1 || sum.MissingReasons["not_found"] != 5 ||
		len(sum.MissingSamples) != 5 {
		t.Fatalf("unexpected summary: %+v", sum)
	}
	for k := range sum.MissingReasons {
		if strings.Contains(k, "/data/") {
			t.Fatalf("per-file reason leaked into reason grouping: %q", k)
		}
	}
	fastLabel := summarizeStorageVerify(maintenance.VerifyReport{Mode: maintenance.VerifyModeFast})
	if fastLabel.Mode != maintenance.VerifyModeFast || fastLabel.HashedFiles != 0 || fastLabel.HashedBytes != 0 {
		t.Fatalf("fast summary must make its level and zero hash work explicit: %+v", fastLabel)
	}
	if !(summarizeStorageVerify(maintenance.VerifyReport{}).OK) {
		t.Fatal("consistent report not marked OK")
	}
}
