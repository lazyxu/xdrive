package transfer

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func networkTask(t *testing.T, manager *Manager, id string) Task {
	t.Helper()
	_, tasks := manager.Snapshot()
	for _, task := range tasks {
		if task.ID == id {
			return task
		}
	}
	t.Fatalf("task %s not found", id)
	return Task{}
}

func setNetworkRateWindow(manager *Manager, id string) time.Time {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	e := manager.entries[id]
	// Public callbacks can share one Windows clock tick. Give them an explicit
	// non-zero sample window without waiting for the machine clock to advance.
	start := e.task.StartedAt.Add(-time.Second)
	e.lastAt = start
	e.rateStartedAt = start
	return start
}

func TestNetworkProgressPublishesBeforeLogicalChunkProgress(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "upload.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 1000})
	h.NetworkProgress(0)
	h.Baseline(800, 1000)
	baseline := networkTask(t, m, h.ID())
	if baseline.SpeedSource != "client" || baseline.SpeedUpdatedAt != nil || baseline.InstantBytesPerSecond != 0 || baseline.AverageBytesPerSecond != 0 {
		t.Fatalf("reused bytes became network speed: %+v", baseline)
	}
	setNetworkRateWindow(m, h.ID())
	h.NetworkProgress(64)
	active := networkTask(t, m, h.ID())
	if active.BytesDone != 800 || active.BytesTotal != 1000 || active.InstantBytesPerSecond <= 0 || active.AverageBytesPerSecond <= 0 || active.SpeedUpdatedAt == nil {
		t.Fatalf("body reads must publish speed independently of logical bytes: %+v", active)
	}
	h.Progress(900, 1000)
	h.NetworkProgress(64)
	after := networkTask(t, m, h.ID())
	if after.BytesDone != 900 || after.InstantBytesPerSecond != active.InstantBytesPerSecond || after.AverageBytesPerSecond != active.AverageBytesPerSecond || !after.SpeedUpdatedAt.Equal(*active.SpeedUpdatedAt) {
		t.Fatalf("logical progress or unchanged network bytes refreshed speed: before=%+v after=%+v", active, after)
	}
}

func TestNetworkProgressCountsRetransmissionsWithoutClampingToFileSize(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "retry.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	start := time.Now().Add(-10 * time.Second)
	m.mu.Lock()
	m.networkProgressLocked(h.ID(), 0, start)
	m.baselineLocked(h.ID(), 80, 100, start.Add(time.Second/2))
	m.networkProgressLocked(h.ID(), 100, start.Add(time.Second))
	m.progressLocked(h.ID(), 100, 100, start.Add(1500*time.Millisecond))
	m.networkProgressLocked(h.ID(), 150, start.Add(2*time.Second))
	m.mu.Unlock()
	task := networkTask(t, m, h.ID())
	if task.BytesDone != 100 || task.InstantBytesPerSecond != 50 || task.AverageBytesPerSecond != 75 {
		t.Fatalf("rates must use actual retransmitted bytes and their sample interval: %+v", task)
	}
	if task.SpeedUpdatedAt == nil || !task.SpeedUpdatedAt.Equal(start.Add(2*time.Second)) {
		t.Fatalf("speed sample timestamp=%v", task.SpeedUpdatedAt)
	}
}

func TestNetworkProgressCompletionKeepsObservedAverage(t *testing.T) {
	for _, finish := range []string{"complete", "state", "skip", "failed"} {
		t.Run(finish, func(t *testing.T) {
			m := NewManager(10)
			h := m.Start(Spec{FileName: "done.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 1000})
			start := time.Now().Add(-10 * time.Second)
			m.mu.Lock()
			m.networkProgressLocked(h.ID(), 0, start)
			m.baselineLocked(h.ID(), 900, 1000, start.Add(time.Second))
			m.networkProgressLocked(h.ID(), 32, start.Add(2*time.Second))
			m.mu.Unlock()
			switch finish {
			case "complete":
				h.Complete()
			case "state":
				if err := h.Finish(StateCompleted, nil); err != nil {
					t.Fatal(err)
				}
			case "skip":
				h.CompleteSkipped()
			case "failed":
				h.Fail(errors.New("interrupted"))
			}
			task := networkTask(t, m, h.ID())
			if task.CompletedAt == nil {
				t.Fatal("missing completion time")
			}
			wantAverage := 32 / task.CompletedAt.Sub(start).Seconds()
			if task.InstantBytesPerSecond != 0 || math.Abs(task.AverageBytesPerSecond-wantAverage) > 1e-8 {
				t.Fatalf("completion replaced observed bytes with logical completion: task=%+v want_average=%g", task, wantAverage)
			}
			before, _ := m.Snapshot()
			h.NetworkProgress(64)
			after, _ := m.Snapshot()
			if before != after {
				t.Fatal("late body observation changed a terminal task")
			}
		})
	}
}

func TestNetworkProgressInstantReuseHasNoSpeedSample(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "reused.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 1000})
	h.NetworkProgress(0)
	h.Baseline(1000, 1000)
	h.Complete()
	task := networkTask(t, m, h.ID())
	if task.BytesDone != 1000 || task.SpeedSource != "client" || task.SpeedUpdatedAt != nil || task.InstantBytesPerSecond != 0 || task.AverageBytesPerSecond != 0 {
		t.Fatalf("instant reuse must complete without any network sample: %+v", task)
	}
}

func TestNetworkProgressRetryStartsFreshObservation(t *testing.T) {
	m := NewManager(10)
	var h *Handle
	var rateStartedAt time.Time
	h = m.Start(Spec{FileName: "retry.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100, Retry: func(context.Context) error {
		task := networkTask(t, m, h.ID())
		if task.State != StateRetrying || task.SpeedSource != "client" || task.SpeedUpdatedAt != nil || task.InstantBytesPerSecond != 0 || task.AverageBytesPerSecond != 0 {
			t.Errorf("retry kept old network samples: %+v", task)
		}
		h.NetworkProgress(0)
		h.Baseline(80, 100)
		rateStartedAt = setNetworkRateWindow(m, h.ID())
		h.NetworkProgress(8)
		return nil
	}})
	h.NetworkProgress(0)
	h.NetworkProgress(80)
	h.Fail(errors.New("first failure"))
	if err := m.Retry(context.Background(), h.ID()); err != nil {
		t.Fatal(err)
	}
	task := networkTask(t, m, h.ID())
	want := 8 / task.CompletedAt.Sub(rateStartedAt).Seconds()
	if math.Abs(task.AverageBytesPerSecond-want) > 1e-8 || task.SpeedUpdatedAt == nil || task.SpeedUpdatedAt.Before(task.StartedAt) {
		t.Fatalf("retry must use only its own observed bytes: task=%+v want_average=%g", task, want)
	}
}
