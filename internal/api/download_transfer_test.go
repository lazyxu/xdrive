package api

import (
	"bytes"
	"testing"
	"time"
)

func TestDownloadTransferReadSeekerDoesNotBackpressureWhenStatsQueueIsFull(t *testing.T) {
	tracker := &downloadTransferReadSeeker{
		ReadSeeker: bytes.NewReader([]byte("abcdefgh")),
		events:     make(chan downloadTransferEvent, 1),
		lastReport: time.Now().Add(-time.Second),
	}
	tracker.events <- downloadTransferEvent{delta: 1}

	done := make(chan struct{})
	var (
		n   int
		err error
	)
	go func() {
		n, err = tracker.Read(make([]byte, 4))
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("download read blocked on a full statistics queue")
	}
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Fatalf("read=%d want=4", n)
	}
	if tracker.pending != 4 {
		t.Fatalf("pending=%d want=4 after non-blocking queue miss", tracker.pending)
	}
}

func TestDownloadTransferReadSeekerPublishesIncrementalBytes(t *testing.T) {
	tracker := &downloadTransferReadSeeker{
		ReadSeeker: bytes.NewReader([]byte("abcdefgh")),
		events:     make(chan downloadTransferEvent, 1),
	}
	n, err := tracker.Read(make([]byte, 4))
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Fatalf("read=%d want=4", n)
	}
	select {
	case event := <-tracker.events:
		if event.delta != 4 || event.final != nil {
			t.Fatalf("event=%+v", event)
		}
	default:
		t.Fatal("first progress sample was not published")
	}
}
