package transfer

import (
	"sync"
	"testing"
)

// Concurrent network callbacks must not lose increments when multiple workers
// report progress against the same transfer handle.
func TestConcurrentAddPreservesEveryIncrement(t *testing.T) {
	const workers = 64
	const incrementsPerWorker = 128
	const total = int64(workers * incrementsPerWorker)

	for round := 0; round < 3; round++ {
		manager := NewManager(10)
		handle := manager.Start(Spec{
			FileName:   "parallel-upload.bin",
			Kind:       KindUpload,
			Direction:  "upload",
			TotalBytes: total,
		})
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(workers)
		for worker := 0; worker < workers; worker++ {
			go func() {
				defer wg.Done()
				<-start
				for n := 0; n < incrementsPerWorker; n++ {
					handle.Add(1)
				}
			}()
		}
		close(start)
		wg.Wait()

		_, tasks := manager.Snapshot()
		if len(tasks) != 1 || tasks[0].BytesDone != total || tasks[0].Percent != 100 {
			t.Fatalf("round %d: concurrent Add lost progress: got %+v, want %d bytes and 100%%", round, tasks, total)
		}
	}
}
