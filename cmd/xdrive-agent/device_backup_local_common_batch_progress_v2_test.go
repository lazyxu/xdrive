package main

import (
	"sync"
	"testing"
)

func TestLocalCommonBatchLiveProgressSnapshotIsPrivateAndMonotone(t *testing.T) {
	j := &localPushCommonBatchJob{progress: localBackupCommonBatchSummary{
		SourceID: 42, State: "running", Running: true,
	}}
	const writers = 4
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for count := int64(0); count < 128; count++ {
				j.setProgress(localBackupCommonBatchSummary{
					SourceID: 42, Revision: 7, State: "running", Running: true,
					InspectedFiles: count,
					ConfirmedFiles: count,
					BackupComplete: false, RetirementSafe: false,
				})
				x := j.currentProgress()
				if x.SourceID != 42 || x.State != "running" ||
					!x.Running || x.BackupComplete || x.RetirementSafe ||
					x.ConfirmedFiles > x.InspectedFiles {
					t.Errorf("torn/unsafe cross-goroutine snapshot: %+v (writer %d)", x, n)
					return
				}
			}
		}(i)
	}
	wg.Wait()
}
