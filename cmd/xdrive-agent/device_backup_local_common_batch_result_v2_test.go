//go:build linux || windows

package main

import (
	"errors"
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
