package transfer

import (
	"context"
	"errors"
	"testing"
)

func TestNetworkProgressObserverRejectsPreviousAttempt(t *testing.T) {
	m := NewManager(10)
	var h *Handle
	var previous func(int64)
	h = m.Start(Spec{FileName: "retry.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100, Retry: func(context.Context) error {
		// net/http may close or consume an old body after Do returned an error.
		// Its observer must not become a sample for this new attempt.
		previous(90)
		task := networkTask(t, m, h.ID())
		if task.SpeedUpdatedAt != nil || task.InstantBytesPerSecond != 0 || task.AverageBytesPerSecond != 0 {
			t.Errorf("old body callback was accepted after retry: %+v", task)
		}
		current := h.NetworkProgressObserver()
		current(8)
		active := networkTask(t, m, h.ID())
		previous(100)
		after := networkTask(t, m, h.ID())
		if active.SpeedUpdatedAt == nil || after.SpeedUpdatedAt == nil || !active.SpeedUpdatedAt.Equal(*after.SpeedUpdatedAt) || after.InstantBytesPerSecond != active.InstantBytesPerSecond || after.AverageBytesPerSecond != active.AverageBytesPerSecond {
			t.Errorf("old observer replaced current attempt sample: active=%+v after=%+v", active, after)
		}
		return nil
	}})
	previous = h.NetworkProgressObserver()
	previous(40)
	h.Fail(errors.New("first attempt interrupted"))
	if err := m.Retry(context.Background(), h.ID()); err != nil {
		t.Fatal(err)
	}
}

func TestNetworkProgressObserverStartsFreshCounterOnSameTask(t *testing.T) {
	m := NewManager(10)
	h := m.Start(Spec{FileName: "upload.bin", Kind: KindUpload, Direction: "upload", TotalBytes: 100})
	previous := h.NetworkProgressObserver()
	previous(80)
	current := h.NetworkProgressObserver()
	baseline := networkTask(t, m, h.ID())
	if baseline.SpeedUpdatedAt != nil || baseline.InstantBytesPerSecond != 0 || baseline.AverageBytesPerSecond != 0 {
		t.Fatalf("new observer kept prior counter: %+v", baseline)
	}
	setNetworkRateWindow(m, h.ID())
	previous(100)
	current(8)
	active := networkTask(t, m, h.ID())
	if active.SpeedUpdatedAt == nil || active.InstantBytesPerSecond <= 0 || active.BytesDone != 0 {
		t.Fatalf("new counter did not produce an independent sample: %+v", active)
	}
}
