//go:build linux || windows

package main

import (
	"errors"
	"math"
	"testing"
)

func TestLocalCommonBatchFailedWorkerNeverReturnsConfirmedPartial(t *testing.T) {
	job := &localPushCommonBatchJob{
		result: localBackupCommonBatchSummary{
			SourceID: 42, Revision: 7, State: "partial",
			ConfirmedFiles: 1, ConfirmedBytes: 4096,
			BackupComplete: false, RetirementSafe: false,
		},
		err: errors.New("original SQL Operation readback unavailable"),
	}
	observed := localCommonBatchObservedResult(job)
	if observed.SourceID != 42 || observed.Revision != 7 ||
		observed.State != "uncertain" || observed.Running ||
		observed.UncertainFiles == 0 ||
		observed.BackupComplete || observed.RetirementSafe ||
		observed.CurrentCASVerified {
		t.Fatalf("failed worker disclosed false success: %+v", observed)
	}
	if job.result.State != "partial" || job.result.UncertainFiles != 0 {
		t.Fatal("observer mutation corrupted the original in-memory result")
	}
	job.err = nil
	safe := localCommonBatchObservedResult(job)
	if safe.State != "partial" || safe.UncertainFiles != 0 ||
		safe.ConfirmedFiles != 1 {
		t.Fatalf("previously confirmed partial result lost: %+v", safe)
	}
	none := localCommonBatchObservedResult(nil)
	if none.State != "uncertain" || none.UncertainFiles == 0 {
		t.Fatalf("nil job was interpreted as success: %+v", none)
	}
}

func TestLocalCommonBatchMakesUnsafeInventoryItemsVisible(t *testing.T) {
	// A directory symlink or an OS special file is not an upload candidate,
	// but its omission must be visible alongside ordinary file results.
	out := localBackupCommonBatchSummary{
		SourceID: 42, Revision: 7, State: "partial",
		InspectedFiles: 3, ConfirmedFiles: 2, UnsupportedFiles: 1,
	}
	if err := localCommonBatchRecordSkippedUnsafe(&out, 2); err != nil {
		t.Fatal(err)
	}
	if out.InspectedFiles != 5 || out.UnsupportedFiles != 3 ||
		out.ConfirmedFiles != 2 || out.BackupComplete ||
		out.RetirementSafe || out.CurrentCASVerified {
		t.Fatalf("unsafe entries hidden or falsely certified: %+v", out)
	}
	if err := localCommonBatchRecordSkippedUnsafe(&out, 0); err != nil {
		t.Fatal(err)
	}
	if out.InspectedFiles != 5 || out.UnsupportedFiles != 3 {
		t.Fatalf("zero unsafe entries changed counts: %+v", out)
	}
}

func TestLocalCommonBatchUnsafeInventoryCountsFailClosed(t *testing.T) {
	if err := localCommonBatchRecordSkippedUnsafe(nil, 1); err == nil {
		t.Fatal("nil summary accepted unsafe count")
	}
	for _, tc := range []struct {
		name    string
		out     localBackupCommonBatchSummary
		skipped int64
	}{
		{name: "negative_scan", skipped: -1},
		{name: "negative_inspected", out: localBackupCommonBatchSummary{InspectedFiles: -1}, skipped: 1},
		{name: "negative_unsupported", out: localBackupCommonBatchSummary{UnsupportedFiles: -1}, skipped: 1},
		{name: "overflow_inspected", out: localBackupCommonBatchSummary{InspectedFiles: math.MaxInt64}, skipped: 1},
		{name: "overflow_unsupported", out: localBackupCommonBatchSummary{UnsupportedFiles: math.MaxInt64}, skipped: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.out
			if err := localCommonBatchRecordSkippedUnsafe(&tc.out, tc.skipped); err == nil {
				t.Fatal("invalid inventory count accepted")
			}
			if tc.out != before {
				t.Fatalf("unsafe-count validation partially mutated summary: before=%+v after=%+v", before, tc.out)
			}
		})
	}
}
