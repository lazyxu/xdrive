package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestManagerProgressAndCompletion(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "demo.bin", Path: "docs/demo.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	h.Progress(25, 100)
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].BytesDone != 25 || tasks[0].Percent != 25 || tasks[0].State != StateRunning {
		t.Fatalf("unexpected progress task: %+v", tasks)
	}
	time.Sleep(time.Millisecond)
	h.Progress(75, 100)
	_, tasks = m.Snapshot()
	if tasks[0].InstantBytesPerSecond <= 0 || tasks[0].AverageBytesPerSecond <= 0 {
		t.Fatalf("speeds were not populated: %+v", tasks[0])
	}
	h.Complete()
	_, tasks = m.Snapshot()
	if tasks[0].State != StateCompleted || tasks[0].BytesDone != 100 || tasks[0].Percent != 100 || tasks[0].CompletedAt == nil {
		t.Fatalf("unexpected completed task: %+v", tasks[0])
	}
}

func TestManagerWaitAndFailure(t *testing.T) {
	m := NewManager(10)
	revision, _ := m.Snapshot()
	type result struct {
		revision uint64
		changed  bool
	}
	done := make(chan result, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		next, _, changed := m.Wait(ctx, revision)
		done <- result{revision: next, changed: changed}
	}()
	h := m.Start(Spec{FileName: "bad.bin", Kind: KindDownload, Direction: "download", TotalBytes: 20})
	h.Progress(5, 20)
	h.Fail(errors.New("network down"))
	got := <-done
	if !got.changed || got.revision <= revision {
		t.Fatalf("wait did not observe a revision change: %+v", got)
	}
	_, tasks := m.Snapshot()
	if tasks[0].State != StateFailed || tasks[0].Error != "network down" || tasks[0].BytesDone != 5 {
		t.Fatalf("unexpected failed task: %+v", tasks[0])
	}
}

func TestManagerBaselineExcludesResumedBytesFromRate(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "resume.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	h.Baseline(80, 100)
	_, tasks := m.Snapshot()
	if len(tasks) != 1 || tasks[0].BytesDone != 80 || tasks[0].Percent != 80 {
		t.Fatalf("unexpected baseline task: %+v", tasks)
	}
	if tasks[0].InstantBytesPerSecond != 0 || tasks[0].AverageBytesPerSecond != 0 {
		t.Fatalf("resumed bytes inflated transfer rate: %+v", tasks[0])
	}
	time.Sleep(time.Millisecond)
	h.Progress(90, 100)
	_, tasks = m.Snapshot()
	if tasks[0].InstantBytesPerSecond <= 0 || tasks[0].AverageBytesPerSecond <= 0 {
		t.Fatalf("new bytes did not contribute to rate: %+v", tasks[0])
	}
}

func TestManagerRetry(t *testing.T) {
	m := NewManager(10)
	attempts := 0
	h := m.Start(Spec{
		FileName:   "retry.bin",
		Kind:       KindUpload,
		Direction:  "upload",
		TotalBytes: 10,
		Retry: func(context.Context) error {
			attempts++
			return nil
		},
	})
	h.Fail(errors.New("first failure"))
	if err := m.Retry(context.Background(), h.ID()); err != nil {
		t.Fatal(err)
	}
	_, tasks := m.Snapshot()
	if attempts != 1 || tasks[0].State != StateCompleted || tasks[0].RetryCount != 1 || tasks[0].Percent != 100 {
		t.Fatalf("unexpected retry result: attempts=%d task=%+v", attempts, tasks[0])
	}
}

func TestManagerRejectsNonRetryable(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "nope", Kind: KindHydration, Direction: "download"})
	h.Fail(errors.New("failed"))
	if err := m.Retry(context.Background(), h.ID()); err == nil {
		t.Fatal("expected non-retryable transfer to be rejected")
	}
}

func TestManagerTrimsCompletedHistory(t *testing.T) {
	m := NewManager(2)
	for _, name := range []string{"a", "b", "c"} {
		h := m.Start(Spec{FileName: name, Kind: KindUpload, Direction: "upload", TotalBytes: 1})
		h.Complete()
	}
	_, tasks := m.Snapshot()
	if len(tasks) != 2 || tasks[0].FileName != "c" || tasks[1].FileName != "b" {
		t.Fatalf("unexpected retained history: %+v", tasks)
	}
}
